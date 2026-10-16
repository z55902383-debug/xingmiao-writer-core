const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join, resolve, sep } = require('node:path');
const { tmpdir } = require('node:os');
const { Store } = require('../electron/store.cjs');
const writing = require('../electron/writing-profiles.cjs');
const { normalizeWeights, reselectWeights } = require('../electron/style-weights.mjs');
const { buildContext } = require('../electron/context.cjs');
const { contextSignature } = require('../electron/timeline.cjs');

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'xm-blend-'));
  const db = new Store(join(dir, 'library.sqlite'));
  t.after(() => { db.close(); assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep)); rmSync(dir, { recursive: true, force: true }); });
  const book = db.createBook({ title: '融合专项', premise: '主角要追回遗失的信件', writingMode: 'imitate', creationMode: 'short' });
  db.updateChapter(book.chapters[0].id, { body: '主角走进邮局。', outline: '寻找信件' }, book.chapters[0].revision);
  db.importWritingSources(book.id, ['A', 'B', 'C'].map(name => ({ name: `${name}.txt`, title: name, body: `PRIVATE-${name}` })));
  for (const row of db.book(book.id).writingProfiles) db.saveWritingProfile(book.id, { ...row, body: `FULL-${row.title}-START\n语言、对白、节奏\nFULL-${row.title}-END` });
  return { db, book: db.book(book.id) };
}

test('百分比始终为100，均分舍入稳定，增删保留相对权重', () => {
  assert.deepEqual(normalizeWeights(['a', 'b', 'c']), { a: 34, b: 33, c: 33 });
  assert.deepEqual(reselectWeights(['a', 'b'], ['a'], { a: 100 }), { a: 50, b: 50 });
  assert.deepEqual(reselectWeights(['a', 'c'], ['a', 'b', 'c'], { a: 60, b: 20, c: 20 }), { a: 75, c: 25 });
  for (let size = 1; size <= 30; size++) {
    const ids = Array.from({ length: size }, (_, i) => `s${i}`);
    const result = normalizeWeights(ids, Object.fromEntries(ids.map((id, i) => [id, i % 7])));
    assert.equal(Object.values(result).reduce((a, b) => a + b, 0), 100);
    assert.ok(Object.values(result).every(Number.isInteger));
  }
  assert.deepEqual(normalizeWeights([]), {});
});

test('每本书独立保存创作方式与比例，短长篇路径互不干扰', t => {
  const { db, book } = fixture(t), other = db.createBook({ title: '其他书', creationMode: 'long' });
  assert.equal(book.writingMode, 'imitate'); assert.equal(book.creationMode, 'short');
  assert.equal(other.writingMode, 'original');
  db.updateBook(book.id, { writingMode: 'original' });
  assert.equal(db.book(book.id).writingProfiles.length, 3);
  assert.equal(db.book(other.id).writingProfiles, undefined);
  assert.throws(() => db.updateBook(book.id, { writingMode: 'unknown' }), /请选择/);
});

test('按整体权重发送完整档案，零占比和原文不进入创作，要求无权重', t => {
  const { db, book } = fixture(t), [a, b, c] = book.writingProfiles;
  const required = db.saveWritingProfile(book.id, { title: '独立要求', kind: 'requirement', body: 'REQUIREMENT', source: '', sourceName: '' }).writingProfiles.at(-1);
  const chosen = db.selectWritingProfiles(book.id, { styleIds: [a.id, b.id, c.id], requirementIds: [required.id], styleWeights: { [a.id]: 70, [b.id]: 30, [c.id]: 0 } });
  for (const kind of ['write', 'bookOutline', 'outline', 'check']) {
    const ctx = buildContext(chosen, chosen.chapters[0], kind);
    assert.deepEqual(ctx.writingReferences.map(row => row.weight), [70, 30, undefined]);
    const sent = JSON.stringify(ctx.messages);
    for (const row of [a, b]) { assert.ok(sent.includes(`FULL-${row.title}-START`)); assert.ok(sent.includes(`FULL-${row.title}-END`)); }
    assert.ok(!sent.includes('FULL-C') && !sent.includes('PRIVATE-'));
    assert.match(sent, /不按段落轮换/);
    assert.equal(ctx.referenceSections.find(row => row.key === 'writingStyles').count, 2);
  }
  assert.deepEqual(buildContext(chosen, chosen.chapters[0], 'style', '', [], { writingProfileId: a.id }).writingReferences, []);
});

test('拒绝无效总和、负数、小数、跨书和多余权重，失败不覆盖当前选择', t => {
  const { db, book } = fixture(t), [a, b] = book.writingProfiles;
  const selected = { styleIds: [a.id, b.id], requirementIds: [], styleWeights: { [a.id]: 60, [b.id]: 40 } };
  db.selectWritingProfiles(book.id, selected);
  for (const weights of [{ [a.id]: 60, [b.id]: 30 }, { [a.id]: 101, [b.id]: -1 }, { [a.id]: 50.5, [b.id]: 49.5 }, { [a.id]: 100 }, { [a.id]: 60, [b.id]: 40, unknown: 0 }]) {
    assert.throws(() => db.selectWritingProfiles(book.id, { ...selected, styleWeights: weights }), /占比/);
    assert.deepEqual(db.book(book.id).writingSelection, selected);
  }
  const other = db.createBook({ title: '另一本' });
  assert.throws(() => db.selectWritingProfiles(other.id, selected), /已删除/);
});

test('删除、清空、旧档案移除会重新分配，恢复不自动选中', t => {
  const { db, book } = fixture(t), [a, b, c] = book.writingProfiles;
  db.selectWritingProfiles(book.id, { styleIds: [a.id, b.id, c.id], requirementIds: [], styleWeights: { [a.id]: 60, [b.id]: 20, [c.id]: 20 } });
  let next = db.deleteWritingProfile(book.id, b.id, b.revision);
  assert.deepEqual(next.writingSelection.styleWeights, { [a.id]: 75, [c.id]: 25 });
  next = db.restoreWritingProfile(book.id, b.id);
  assert.ok(!next.writingSelection.styleIds.includes(b.id));
  next = db.saveWritingProfile(book.id, { ...a, body: '' });
  assert.deepEqual(next.writingSelection.styleWeights, { [c.id]: 100 });
  next = db.updateBook(book.id, { style: '旧档案' });
  db.selectWritingProfiles(book.id, { styleIds: [writing.LEGACY, c.id], requirementIds: [], styleWeights: { [writing.LEGACY]: 70, [c.id]: 30 } });
  next = db.updateBook(book.id, { style: '' });
  assert.deepEqual(next.writingSelection.styleWeights, { [c.id]: 100 });
});

test('修改占比改变生成签名，历史引用快照保留旧比例和完整内容', t => {
  const { db, book } = fixture(t), [a, b] = book.writingProfiles;
  const chosen = db.selectWritingProfiles(book.id, { styleIds: [a.id, b.id], requirementIds: [], styleWeights: { [a.id]: 80, [b.id]: 20 } });
  const old = buildContext(chosen, chosen.chapters[0], 'write');
  const hash = contextSignature(chosen, chosen.chapters[0]);
  const changed = db.selectWritingProfiles(book.id, { ...chosen.writingSelection, styleWeights: { [a.id]: 30, [b.id]: 70 } });
  assert.notEqual(contextSignature(changed, changed.chapters[0]), hash);
  assert.deepEqual(old.writingReferences.map(row => row.weight), [80, 20]);
  const restored = writing.restoreFields(db.backup().books[0]);
  assert.deepEqual(restored.writingSelection.styleWeights, { [a.id]: 30, [b.id]: 70 });
});

test('批量上传保存事务拒绝一篇无效时不留下半批条目，待分析条目不能选用', t => {
  const { db, book } = fixture(t), before = book.writingProfiles.length;
  assert.throws(() => db.importWritingSources(book.id, [{ name: 'good.txt', title: '有效', body: '文本' }, { name: 'bad.txt', title: '', body: '' }]), /名称/);
  assert.equal(db.book(book.id).writingProfiles.length, before);
  const saved = db.importWritingSources(book.id, [{ name: 'new.txt', title: '待分析', body: '原文' }]);
  assert.equal(saved.writingProfiles.at(-1).source, '原文');
  assert.throws(() => db.selectWritingProfiles(book.id, { styleIds: [saved.writingProfiles.at(-1).id], requirementIds: [] }), /蒸馏/);
});

test('实际备份恢复创建独立副本，保留仿写方式、源文与完整占比', async t => {
  const { db, book } = fixture(t), [a, b, c] = book.writingProfiles;
  const selected = { styleIds: [a.id, b.id, c.id], requirementIds: [], styleWeights: { [a.id]: 50, [b.id]: 30, [c.id]: 20 } };
  db.selectWritingProfiles(book.id, selected);
  const backup = db.backup();
  const main = require('node:fs').readFileSync(resolve('electron/main.cjs'), 'utf8');
  const start = main.indexOf('async function restoreBackup()'), end = main.indexOf('const actions =', start);
  const helpers = require('../electron/store.cjs');
  const restore = require('node:vm').runInNewContext(main.slice(start, end) + ';restoreBackup;', {
    require: require('node:module').createRequire(resolve('electron/main.cjs')), store: db, win: {},
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['backup.json'] }) },
    fs: { readFile: async () => JSON.stringify(backup), stat: async () => ({ size: Buffer.byteLength(JSON.stringify(backup)) }) },
    assert: helpers.assert, text: helpers.text, id: helpers.id, now: helpers.now,
  });
  assert.equal(await restore(), 1);
  const copy = db.book(db.list().find(row => row.id !== book.id).id);
  assert.equal(copy.writingMode, 'imitate'); assert.equal(copy.creationMode, 'short');
  assert.deepEqual(copy.writingSelection, selected);
  assert.equal(copy.writingProfiles[0].source, 'PRIVATE-A');
});
