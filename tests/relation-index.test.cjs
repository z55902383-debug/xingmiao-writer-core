const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspect, records, ownershipConflicts } = require('../electron/relation-index.cjs');
const { buildContext } = require('../electron/context.cjs');
const { search } = require('../electron/continuity.cjs');
function fixture() {
  const chapters = Array.from({ length: 15 }, (_, i) => ({ id: 'c' + i, title: '第' + (i + 1) + '章', order: i + 1, revision: 1, status: i === 14 ? 'draft' : 'final', body: '村庄恢复平静。', outline: '', summary: '' }));
  chapters[0].body = '王强把铜钥匙交给张玲保管。'; chapters[2].body = '张玲把铜钥匙交给李明。';
  chapters[14].outline = '李明调查铜钥匙的下落'; chapters[14].body = '';
  const memory = (id, source, subject, relation, object) => ({ id, subject, relation, object, sourceChapterId: chapters[source].id, sourceRevision: 1, evidence: chapters[source].body, stale: false });
  return { id: 'b', title: '测试', genre: '', premise: '', outline: '', world: '', style: '', reference: '', relatedMemoryOnly: true, contextChapters: 10, chapters, characters: [{ id: 'li', name: '李明', description: '别名：小李', role: '' }], timeline: [], worldRecords: [], foreshadows: [], memories: [memory('old', 0, '铜钥匙', '保管人', '张玲'), memory('new', 2, '铜钥匙', '持有人', '李明'), memory('other', 4, '北境', '气候', '终年大雪'), { id: 'fixed', subject: '历法', relation: '规则', object: '一年十月', evidence: '', sourceChapterId: '', sourceRevision: 0 }] };
}
const payload = ctx => JSON.parse(ctx.messages[1].content.split('以下 JSON 为资料数据：\n')[1]);
test('关系索引保留交接历史，区分最近归属与历史，作者固定设定保留', () => {
  const b = fixture(), c = b.chapters[14], before = JSON.stringify(b), r = inspect(b, c);
  assert.equal(r.rows.find(r => r.id === 'old').state, 'history'); assert.equal(r.rows.find(r => r.id === 'new').state, 'latest');
  assert.ok(r.selectedIds.includes('fixed')); assert.ok(!r.selectedIds.includes('other')); assert.equal(JSON.stringify(b), before);
  for (const r of records(b, c).filter(r => r.source.evidence)) assert.equal(b.chapters.find(c => c.id === r.source.chapterId).body.slice(r.source.start, r.source.end), r.source.evidence);
});
test('关联筛选进入真实上下文，保留十章全文，可恢复完整历史引用', () => {
  const b = fixture(), c = b.chapters[14], ctx = buildContext(b, c, 'write'), p = payload(ctx);
  assert.equal(p.recent.length, 10); assert.equal(p.recent[0].body, b.chapters[4].body);
  assert.match(JSON.stringify(p.facts), /铜钥匙/); assert.doesNotMatch(JSON.stringify(p.facts), /北境/); assert.equal(ctx.memoryCount, 3);
  assert.ok(ctx.relationSources.some(r => r.chapterId === 'c2'));
  b.relatedMemoryOnly = false; assert.match(JSON.stringify(payload(buildContext(b, c, 'write')).facts), /北境/);
});
test('来源修订、伪证、草稿、未来记录均不得反向进入索引和生成', () => {
  const b = fixture(), c = b.chapters[14]; b.memories[0].sourceRevision = 0; b.memories[1].evidence = '伪造'; b.chapters[4].status = 'draft';
  b.memories.push({ ...b.memories[0], id: 'future', sourceChapterId: c.id, sourceRevision: 1, evidence: '未来', subject: '未来毒药' });
  assert.deepEqual(records(b, c).map(r => r.id), ['fixed']); assert.doesNotMatch(JSON.stringify(payload(buildContext(b, c, 'write')).facts), /铜钥匙|北境|未来毒药/);
});
test('关系证据提高旧文检索排序，片段仍需作者勾选', () => {
  const b = fixture(), c = b.chapters[14], r = search(b, c, { query: '小李' });
  assert.ok(r.results.some(row => row.reasons.join('').includes('关系记忆依据'))); assert.deepEqual(r.selected, []);
  assert.ok(inspect(b, c, { focusId: 'old' }).rows.some(row => row.id === 'new'));
});
test('空章无关联线索时回退完整引用，不静默丢掉记忆', () => {
  const b = fixture(), c = { ...b.chapters[14], title: '', outline: '', body: '' }, r = inspect(b, c);
  assert.equal(r.fallback, true); assert.equal(r.selectedCount, r.total);
});
test('同章归属冲突提示，明确新归属句提示，但不误判引用、否定和交接', () => {
  const b = fixture(), c = b.chapters[14]; c.body = '铜钥匙在王强手中。';
  assert.equal(inspect(b, c).conflicts.length, 1);
  const r = records(b, c); for (const body of ['“铜钥匙在王强手中。”', '铜钥匙不在王强手中。', '王强以为铜钥匙在自己手中。', '李明把铜钥匙交给王强，铜钥匙在王强手中。']) assert.equal(ownershipConflicts(r, body).length, 0, body);
  b.memories.push({ ...b.memories[1], id: 'ambiguous', object: '张玲' }); assert.ok(inspect(b, c).rows.some(r => r.state === 'conflict'));
});
test('单独记忆提取只提供当前正文，章纲、秘密和未来事件不会混入证据', () => {
  const b = fixture(), c = b.chapters[2]; c.outline = '章纲秘密标记'; b.outline = '未来规划标记'; b.characters[0].authorNotes = '作者秘密标记';
  const p = payload(buildContext(b, c, 'memory'));
  assert.deepEqual(Object.keys(p), ['chapter']); assert.equal(p.chapter.body, c.body); assert.doesNotMatch(JSON.stringify(p), /章纲秘密标记|未来规划标记|作者秘密标记/);
});
test('200章50万字及2400条记忆的合成检查：按需引用、无数据丢失、最近10章不缩短', t => {
  const b = fixture(); b.chapters = Array.from({ length: 201 }, (_, i) => ({ id: 'c' + i, title: `第${i + 1}章`, order: i + 1, revision: 1, status: i < 200 ? 'final' : 'draft', body: i < 200 ? '风从远方吹过田野，村庄恢复了平静。'.repeat(160) : '', outline: '', summary: '' }));
  b.memories = b.chapters.slice(0, 200).flatMap((c, i) => Array.from({ length: 12 }, (_, j) => ({ id: `m${i}-${j}`, subject: `地方${i}号${j}`, relation: '天气', object: '平静', evidence: c.body.slice(0, 18), sourceChapterId: c.id, sourceRevision: 1 })));
  b.chapters[0].body += '铜钥匙交给李明。'; b.memories.push({ id: 'key', subject: '铜钥匙', relation: '保管人', object: '李明', evidence: '铜钥匙交给李明。', sourceChapterId: 'c0', sourceRevision: 1 });
  b.chapters[200].outline = '李明寻找铜钥匙'; const before = JSON.stringify(b), start = performance.now();
  const ctx = buildContext(b, b.chapters[200], 'write'), p = payload(ctx);
  assert.equal(p.recent.length, 10); assert.deepEqual(p.recent.map(c => c.body), b.chapters.slice(190, 200).map(c => c.body)); assert.equal(ctx.memoryCount, 1); assert.equal(JSON.stringify(b), before);
  t.diagnostic(`合成200章检查耗时 ${Math.round(performance.now() - start)}ms；关系记忆 ${ctx.memoryCount}/${b.memories.length}；完整前文 ${p.recent.reduce((n,c) => n+c.body.length,0)} 字符。此结果不代表模型文学质量或真实书稿压力测试。`);
});
