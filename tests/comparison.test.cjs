const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Store } = require('../electron/store.cjs');
const compare = require('../electron/comparison.cjs');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'xm-comparison-')), store = new Store(join(dir, 'test.sqlite'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const b = store.createBook({ title: '对照测试' });
  const c = store.updateChapter(b.chapters[0].id, { body: '原来章节正文。' }, b.chapters[0].revision);
  const job = { id: 'ai', bookId: b.id, chapterId: c.id, kind: 'write', output: 'AI参考正文。', status: 'done', adopted: false, createdAt: '2026-10-14T01:00:00Z' }; store.putJob(job);
  return { store, b, c, job };
}
test('对照右栏首次为空，保存草稿和参考快照不会改变正文、记忆或候选状态', t => {
  const { store, b, c, job } = fixture(t), initial = compare.read(store, { chapterId: c.id });
  assert.equal(initial.text, ''); assert.equal(initial.baseRevision, c.revision);
  const saved = compare.save(store, { chapterId: c.id, revision: 0, text: '人工稿。', sourceId: job.id });
  assert.equal(saved.reference.text, job.output); assert.equal(saved.text, '人工稿。'); assert.equal(store.chapter(c.id).body, c.body); assert.equal(store.rawBook(b.id).memories.length, 0); assert.equal(store.job(job.id).adopted, false);
  job.output = '后来改动的AI文本'; store.putJob(job); assert.equal(compare.read(store, { chapterId: c.id }).reference.text, 'AI参考正文。');
});
test('两个入口共用草稿，旧版本不能覆盖新版本，切换参考不会清空人工稿', t => {
  const { store, c } = fixture(t);
  const first = compare.read(store, { chapterId: c.id }), second = compare.read(store, { chapterId: c.id });
  const updated = compare.save(store, { chapterId: c.id, revision: first.revision, text: '保留人工稿' });
  assert.throws(() => compare.save(store, { chapterId: c.id, revision: second.revision, text: '旧入口输入' }), /其他入口/);
  const pasted = compare.save(store, { chapterId: c.id, revision: updated.revision, text: updated.text, referenceText: '自定义参考原文' });
  assert.equal(pasted.text, '保留人工稿'); assert.equal(pasted.reference.text, '自定义参考原文');
});
test('明确写入后更新章节，保留原稿历史，草稿和参考继续保存，不自动定稿', t => {
  const { store, c } = fixture(t);
  const d = compare.save(store, { chapterId: c.id, revision: 0, text: '人工重新创作的正文。', sourceId: 'ai' });
  const result = compare.apply(store, { chapterId: c.id, revision: d.revision });
  assert.equal(result.chapter.body, d.text); assert.equal(result.chapter.status, 'draft'); assert.ok(store.versions(c.id).some(v => v.body === c.body)); assert.equal(result.draft.text, d.text); assert.equal(result.draft.reference.text, 'AI参考正文。');
  assert.equal(result.draft.baseRevision, result.chapter.revision);
});
test('正文变更时拒绝覆盖，保留两份文稿，空草稿和旧草稿版本不能写入', t => {
  const { store, c } = fixture(t);
  assert.throws(() => compare.apply(store, { chapterId: c.id, revision: 0 }), /先在右栏/);
  const d = compare.save(store, { chapterId: c.id, revision: 0, text: '人工稿' });
  store.updateChapter(c.id, { body: '另一入口修改的正文' }, c.revision);
  assert.throws(() => compare.apply(store, { chapterId: c.id, revision: d.revision }), /正文已变化/);
  assert.equal(store.chapter(c.id).body, '另一入口修改的正文'); assert.equal(compare.read(store, { chapterId: c.id }).text, '人工稿');
  assert.throws(() => compare.apply(store, { chapterId: c.id, revision: 0 }), /草稿已变化/);
});
test('来源必须属于当前章，草稿备份恢复保留全文与固定参考并重映射章节', t => {
  const { store, b, c } = fixture(t), next = store.createChapter(b.id);
  assert.throws(() => compare.save(store, { chapterId: next.id, revision: 0, text: '', sourceId: 'ai' }), /本章/);
  const long = '人工草稿'.repeat(20000); compare.save(store, { chapterId: c.id, revision: 0, text: long, sourceId: 'ai' });
  const backup = store.backup().books[0].comparisonDrafts, restored = compare.restoreDrafts(backup, new Map([[c.id, 'restored-id']]));
  assert.equal(restored['restored-id'].text, long); assert.equal(restored['restored-id'].reference.text, 'AI参考正文。'); assert.equal(restored['restored-id'].reference.id, ''); assert.equal(restored['restored-id'].chapterId, 'restored-id');
});
test('冲突恢复将当前输入另存为新章，不覆盖任一入口的正文或最新草稿', t => {
  const { store, c, b } = fixture(t);
  compare.save(store, { chapterId: c.id, revision: 0, text: '另一入口最新草稿' });
  const rescued = compare.rescue(store, { chapterId: c.id, text: '本入口尚未保存的输入' });
  assert.notEqual(rescued.chapter.id, c.id); assert.equal(rescued.chapter.body, '本入口尚未保存的输入'); assert.equal(rescued.draft.text, '另一入口最新草稿'); assert.equal(store.chapter(c.id).body, c.body);
  assert.equal(store.book(b.id).chapters.length, 2);
});
