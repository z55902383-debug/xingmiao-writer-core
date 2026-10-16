const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { Store } = require('../electron/store.cjs');
const { buildContext } = require('../electron/context.cjs');
const { contextSignature } = require('../electron/timeline.cjs');
const imitation = require('../electron/imitation.cjs');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'xm-imitation-')), db = new Store(join(dir, 'library.sqlite'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  let b = db.createBook({ title: '独立对标', premise: '独自寻找失踪的师傅', writingMode: 'imitate', creationMode: 'short' });
  db.updateChapter(b.chapters[0].id, { body: '主角踏进山门。', outline: '寻找师傅的线索' }, b.chapters[0].revision);
  db.importImitationSources(b.id, ['A','B','C'].map(title => ({ title, name: title + '.txt', body: 'PRIVATE-STORY-' + title })));
  for (const row of db.book(b.id).imitationProfiles) db.saveImitationProfile(b.id, { ...row, body: 'STORY-' + row.title + '-骨架与人物关系' });
  db.saveWritingProfile(b.id, { kind: 'style', title: '文风', body: 'VOICE-短句白描', source: 'PRIVATE-VOICE', sourceName: '' });
  b = db.book(b.id); const ids = b.imitationProfiles.map(row => row.id);
  db.selectImitationProfiles(b.id, { ids, weights: { [ids[0]]: 70, [ids[1]]: 30, [ids[2]]: 0 } });
  b = db.selectWritingProfiles(b.id, { styleIds: [b.writingProfiles[0].id], requirementIds: [], styleWeights: { [b.writingProfiles[0].id]: 100 } });
  return { db, b, ids };
}
test('故事对标与风格独立配比，零权重、原文不入创作，记忆不注入对标', t => {
  const { b } = fixture(t);
  for (const kind of ['write','bookOutline','characters','worldBuild','timelinePlan','polish','check']) {
    const ctx = buildContext(b, b.chapters[0], kind), sent = JSON.stringify(ctx.messages);
    assert.deepEqual(ctx.imitationReferences.map(row => row.weight), [70,30]);
    assert.equal(ctx.writingReferences[0].weight, 100);
    assert.match(sent, /STORY-A/); assert.match(sent, /VOICE-短句/);
    assert.doesNotMatch(sent, /STORY-C|PRIVATE-/);
    assert.match(sent, /故事骨架、人物目标与关系/);
    assert.equal(ctx.referenceSections.find(row => row.key === 'imitationReferences').count, 2);
  }
  assert.deepEqual(buildContext(b,{...b.chapters[0],status:'final'},'memory').imitationReferences, []);
});
test('旧模式字段不再限制故事对标，取消勾选停用且保留档案，跨书选择拒绝', t => {
  const { db, b } = fixture(t), original = db.updateBook(b.id, { writingMode: 'original' });
  const ctx = buildContext(original,original.chapters[0],'write');
  assert.equal(ctx.imitationReferences.length,2); assert.equal(ctx.writingReferences.length,1);
  assert.deepEqual(original.imitationSelection,b.imitationSelection);
  assert.equal(imitation.references(db.updateBook(b.id,{writingMode:'imitate'})).length,2);
  const cleared = db.selectImitationProfiles(b.id,{ids:[],weights:{}});
  assert.deepEqual(buildContext(cleared,cleared.chapters[0],'write').imitationReferences,[]);
  assert.equal(cleared.imitationProfiles.length,3);
  const other = db.createBook({title:'另一书'});
  assert.throws(() => db.selectImitationProfiles(other.id,b.imitationSelection),/重新选择/);
});
test('分析输入隔离，采用只更新对标，原文更新后拒绝陈旧结果', t => {
  const { db, b, ids } = fixture(t);
  const ctx = buildContext(b,b.chapters[0],'style','', [{id:'bad',body:'UNRELATED-SKILL'}], {imitationProfileId:ids[0]});
  const sent = JSON.stringify(ctx.messages);
  assert.match(sent,/PRIVATE-STORY-A/); assert.match(sent,/主要人物目标/);
  assert.doesNotMatch(sent,/PRIVATE-STORY-B|VOICE-|UNRELATED-SKILL/);
  assert.deepEqual(ctx.skills,[]); assert.deepEqual(ctx.writingReferences,[]);
  const job = { id:'im-analysis', bookId:b.id, chapterId:b.chapters[0].id, kind:'style', status:'done', output:'NEW-STORY', adopted:false, imitationProfileSnapshot:ctx.imitationProfileSnapshot };
  db.putJob(job); let next = db.adopt(job.id,'replace');
  assert.equal(next.imitationProfiles[0].body,'NEW-STORY'); assert.deepEqual(next.writingProfiles,b.writingProfiles);
  assert.equal(next.chapters[0].body,b.chapters[0].body);
  const updated = next.imitationProfiles[0]; db.putJob({...job,id:'stale',imitationProfileSnapshot:updated});
  db.saveImitationProfile(b.id,{...updated,source:'changed'});
  assert.throws(() => db.adopt('stale','replace'),/已修改/); assert.equal(db.job('stale').adopted,false);
  const style = buildContext(b,b.chapters[0],'style','',[],{writingProfileId:b.writingProfiles[0].id});
  assert.doesNotMatch(JSON.stringify(style.messages),/PRIVATE-STORY/);
});
test('删除重新分配故事比例，恢复不自动选中，风格不变', t => {
  const { db, b, ids } = fixture(t); const row=b.imitationProfiles[1];
  let next=db.deleteImitationProfile(b.id,row.id,row.revision);
  assert.deepEqual(next.imitationSelection.weights,{[ids[0]]:100,[ids[2]]:0});
  next=db.restoreImitationProfile(b.id,row.id); assert.ok(!next.imitationSelection.ids.includes(row.id));
  assert.deepEqual(next.writingSelection,b.writingSelection);
  next=db.saveImitationProfile(b.id,{...next.imitationProfiles[0],body:''});
  assert.deepEqual(next.imitationSelection.weights,{[ids[2]]:100});
});
test('非法批次及比例原子拒绝，未分析不能选择', t => {
  const { db,b,ids }=fixture(t);
  for(const weights of [{[ids[0]]:100}, {[ids[0]]:70,[ids[1]]:31,[ids[2]]:0}, {[ids[0]]:70.5,[ids[1]]:29.5,[ids[2]]:0}]) assert.throws(()=>db.selectImitationProfiles(b.id,{ids,weights}),/占比/);
  assert.deepEqual(db.book(b.id).imitationSelection,b.imitationSelection);
  assert.throws(()=>db.importImitationSources(b.id,[{title:'正常',name:'a',body:'正文'},{title:'',body:''}]),/名称/);
  assert.equal(db.book(b.id).imitationProfiles.length,3);
  const next=db.importImitationSources(b.id,[{title:'待分析',name:'a',body:'正文'}]), id=next.imitationProfiles.at(-1).id;
  assert.throws(()=>db.selectImitationProfiles(b.id,{ids:[id],weights:{[id]:100}}),/先分析/);
});
test('故事比例改变签名，旧模式不影响；备份恢复保留两个领域', t => {
  const {db,b,ids}=fixture(t), hash=contextSignature(b,b.chapters[0]);
  const next=db.selectImitationProfiles(b.id,{ids,weights:{[ids[0]]:20,[ids[1]]:80,[ids[2]]:0}});
  assert.notEqual(contextSignature(next,next.chapters[0]),hash);
  const a=db.updateBook(b.id,{writingMode:'original'}); assert.equal(contextSignature(a,a.chapters[0]),contextSignature(next,next.chapters[0]));
  const c=db.selectImitationProfiles(b.id,b.imitationSelection); assert.equal(contextSignature(c,c.chapters[0]),hash);
  const restored=require('../electron/writing-profiles.cjs').restoreFields(db.backup().books[0]);
  assert.deepEqual(restored.imitationSelection,b.imitationSelection);
  assert.equal(restored.imitationProfiles[0].source,'PRIVATE-STORY-A'); assert.equal(restored.writingProfiles[0].source,'PRIVATE-VOICE');
  assert.throws(()=>imitation.restoreFields({...b,imitationProfiles:[b.imitationProfiles[0],b.imitationProfiles[0]]}),/重复/);
});

test('旧单篇风格分析也只读原文，排除书内故事、对标和Skill', t => {
  const { b } = fixture(t);
  const book = { ...b, reference: 'LEGACY-SOURCE', premise: 'UNRELATED-PREMISE', world: 'UNRELATED-WORLD', style: '' };
  const ctx = buildContext(book, { ...b.chapters[0], body: 'UNRELATED-PROSE' }, 'style', '只提炼节奏', [{ id: 'bad', body: 'UNRELATED-SKILL', enabled: true, tasks: ['style'] }]);
  assert.match(JSON.stringify(ctx.messages), /LEGACY-SOURCE/);
  assert.doesNotMatch(JSON.stringify(ctx.messages), /UNRELATED-|PRIVATE-STORY|VOICE-/);
  assert.equal(ctx.writingProfileSnapshot, undefined);
  assert.deepEqual(ctx.skills, []);
  assert.ok(ctx.referenceSections.some(row => row.key === 'instruction'));
});

test('故事对标变更会在旧正文候选恢复说明中列出，删除后也可追溯', t => {
  const { db, b, ids } = fixture(t), chapter = b.chapters[0];
  const recovery = require('../electron/candidate-recovery.cjs');
  db.putJob({ id: 'old-prose', bookId: b.id, chapterId: chapter.id, baseRevision: chapter.revision, kind: 'write', status: 'done', output: '新正文', adopted: false, contextSignature: contextSignature(b, chapter), adoptionBasis: recovery.basis(b, chapter) });
  db.selectImitationProfiles(b.id, { ids, weights: { [ids[0]]: 20, [ids[1]]: 80, [ids[2]]: 0 } });
  let preview = recovery.prepare(db, 'old-prose');
  assert.equal(preview.conflict, true); assert.ok(preview.changes.some(row => row.label === '仿写故事对标' && row.before.includes('70') && row.after.includes('80')));
  for (const row of b.imitationProfiles) db.deleteImitationProfile(b.id, row.id, row.revision);
  preview = recovery.prepare(db, 'old-prose');
  assert.ok(preview.changes.some(row => row.label === '仿写故事对标' && row.after === '[]'));
});

test('恢复故事对标保留历史时间，并为恢复记录建立新保存时间', t => {
  const { db, b } = fixture(t);
  db.saveImitationProfile(b.id, { ...b.imitationProfiles[0], body: '修订档案' });
  const source = db.book(b.id), restored = imitation.restoreFields(source);
  assert.ok(restored.imitationProfiles[0].createdAt && restored.imitationProfiles[0].updatedAt);
  assert.equal(restored.imitationProfiles[0].history[0].savedAt, source.imitationProfiles[0].history[0].savedAt);
});
