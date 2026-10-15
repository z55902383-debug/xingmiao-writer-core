const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { join, resolve, sep } = require('node:path');
const { tmpdir } = require('node:os');
const { Store } = require('../electron/store.cjs');
const { buildContext } = require('../electron/context.cjs');
const { contextSignature } = require('../electron/timeline.cjs');
const { createAuthorTools, parseManuscript, importManuscript, impact } = require('../electron/author-tools.cjs');
const source = '第1章 雨夜\r\n林晚把铜钥匙交给陈默。\r\n第2章 未完\r\n她推开门，看见';
function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'xm-author-tools-'));
  const store = new Store(join(folder, 'store.sqlite'));
  t.after(() => { store.close(); assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + sep)); rmSync(folder, { recursive: true, force: true }); });
  const book = importManuscript(store, { title: '导入书', content: source, finalIndexes: [0] });
  return { store, book, chapter: book.chapters[0], folder };
}
const service = (store, rows) => createAuthorTools({ getStore: () => store, ask: async (_, chunk) => chunk(JSON.stringify({ rows })) });
const payload = context => JSON.parse(context.messages[1].content.split('以下 JSON 为资料数据：\n')[1]);

test('导入预览保持正文原样、识别残稿、创建副本并留存原始书稿', t => {
  const { store, book } = fixture(t), parsed = parseManuscript(source);
  assert.equal(parsed.length, 2); assert.equal(parsed[1].possiblePartial, true);
  assert.equal(book.chapters[0].body, '\n林晚把铜钥匙交给陈默。\r\n');
  assert.equal(book.chapters[0].status, 'final'); assert.equal(book.chapters[1].status, 'draft');
  assert.equal(book.importedSource.content, source);
  const copy = importManuscript(store, { title: '第二份', content: source, finalIndexes: [] });
  assert.notEqual(copy.id, book.id); assert.equal(store.book(book.id).chapters[0].body, book.chapters[0].body);
  assert.equal(parseManuscript('没有章标题的原稿。')[0].body, '没有章标题的原稿。');
  assert.equal(parseManuscript('# 第1章 雨夜\n原文。\n## 第2章 后续\n后续。')[1].title, '第2章 后续');
  assert.throws(() => importManuscript(store, { title: '无效', content: source, finalIndexes: [99] }), /核对/);
});

test('资料重建逐项采用、有原文证据、重开保留记录且拒绝重复或旧来源', async t => {
  const { store, book, chapter } = fixture(t);
  const rows = [{ kind: 'character', subject: '林晚', value: '交出钥匙的人', evidence: '林晚把铜钥匙交给陈默。' }, { kind: 'memory', subject: '铜钥匙', relation: '持有者', value: '陈默', evidence: '林晚把铜钥匙交给陈默。' }];
  const tools = service(store, rows), run = await tools.analyze({ bookId: book.id, chapterId: chapter.id, kind: 'facts' });
  assert.equal(store.book(book.id).characters.length, 0);
  let result = tools.apply({ id: run.id, ids: [run.rows[0].id] }); assert.equal(result.characters[0].name, '林晚'); assert.equal(result.memories.length, 0);
  assert.throws(() => tools.apply({ id: run.id, ids: [run.rows[0].id] }), /已采用/);
  assert.equal(service(store, []).list(book.id)[0].appliedIds.length, 1);
  result = tools.apply({ id: run.id, ids: [run.rows[1].id] }); assert.equal(result.memories[0].sourceRevision, chapter.revision);
  const later = await tools.analyze({ bookId: book.id, chapterId: chapter.id, kind: 'facts' });
  store.updateChapter(chapter.id, { body: '钥匙被收回。' }, chapter.revision);
  assert.throws(() => tools.apply({ id: later.id, ids: [later.rows[1].id] }), /来源已变化/);
  assert.equal(impact(store.book(book.id))[0].memories.length, 1);
});

test('伪造证据、草稿、非法条目均不能写入资料，原始错误输出可查', async t => {
  const { store, book, chapter } = fixture(t);
  const tools = service(store, [{ kind: 'memory', subject: '林晚', value: '死亡', evidence: '原文没有这句话' }]);
  const run = await tools.analyze({ bookId: book.id, chapterId: chapter.id, kind: 'facts' });
  assert.equal(run.status, 'error'); assert.match(run.raw, /死亡/); assert.equal(run.rows.length, 0);
  assert.throws(() => tools.apply({ id: run.id, ids: ['fake'] }), /尚未完成/);
  await assert.rejects(tools.analyze({ bookId: book.id, chapterId: book.chapters[1].id, kind: 'facts' }), /定稿/);
  assert.equal(store.book(book.id).memories.length, 0);
});

test('采用事务失败不留下部分人物、素材或已采用标记', async t => {
  const { store, book, chapter } = fixture(t);
  const tools = service(store, [{ kind: 'character', subject: '新人', value: '访客', evidence: '林晚' }, { kind: 'memory', subject: '钥匙', value: '陈默', evidence: '陈默' }]);
  const run = await tools.analyze({ bookId: book.id, chapterId: chapter.id, kind: 'facts' });
  const original = store.addMemory;
  store.addMemory = () => { throw Error('模拟写入失败'); };
  assert.throws(() => tools.apply({ id: run.id, ids: run.rows.map(r => r.id) }), /模拟/);
  store.addMemory = original;
  assert.equal(store.book(book.id).characters.length, 0); assert.deepEqual(tools.list(book.id)[0].appliedIds, []);
});

test('取消保留部分输出且不生成可采用资料', async t => {
  const { store, book, chapter } = fixture(t);
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const tools = createAuthorTools({ getStore: () => store, ask: async (_, chunk, signal) => { chunk('{"rows":'); started(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('stop')), { once: true })); } });
  const pending = tools.analyze({ bookId: book.id, chapterId: chapter.id, kind: 'facts' }); await ready; tools.cancel(book.id);
  const run = await pending; assert.equal(run.status, 'error'); assert.equal(run.raw, '{"rows":'); assert.match(run.error, /停止/);
});

test('拆文素材默认关闭，启用后只发送方法且更新签名，保留来源证据', async t => {
  const { store, book } = fixture(t), tools = service(store, [{ title: '行动交代关系', method: '用物品交接呈现信任', useWhen: '人物有明确行动目的时', evidence: '铜钥匙' }]);
  const run = await tools.analyze({ bookId: book.id, kind: 'techniques', source: '私有原文：铜钥匙', sourceName: '参考书' });
  let result = tools.apply({ id: run.id, ids: [run.rows[0].id] }), c = result.chapters[1];
  assert.equal(result.techniques[0].enabled, false);
  const old = contextSignature(result, c); assert.deepEqual(payload(buildContext(result, c, 'write')).techniques, []);
  result = store.updateBook(book.id, { techniques: result.techniques.map(row => ({ ...row, enabled: true })) });
  const ctx = buildContext(result, c, 'write'); assert.equal(payload(ctx).techniques[0].title, '行动交代关系');
  assert.ok(!ctx.messages[1].content.includes('私有原文')); assert.notEqual(contextSignature(result, c), old);
  assert.equal(store.backup().books[0].techniques[0].sourceName, '参考书');
});

test('写前卡保存、进入正文任务、更新历史，记忆提取不注入写作约束', t => {
  const { store, book, chapter } = fixture(t);
  const card = { must: '交出钥匙', avoid: '不揭露真凶', knowledge: '陈默不知真相', stop: '门响时停笔' };
  const first = store.updateChapter(chapter.id, { writingCard: card }, chapter.revision);
  const result = store.book(book.id); assert.deepEqual(payload(buildContext(result, first, 'write')).writingCard, card);
  assert.equal(payload(buildContext(result, { ...first, status: 'final' }, 'memory')).writingCard, undefined);
  const second = store.updateChapter(chapter.id, { writingCard: { ...card, stop: '交接后停笔' } }, first.revision);
  const version = store.versions(chapter.id).find(v => v.writingCard?.stop === card.stop);
  assert.ok(version); assert.deepEqual(store.restoreVersion(chapter.id, version.id, second.revision).writingCard, card);
});

test('改稿影响同时追踪前文依赖，归档旧资料可恢复且不改正文', async t => {
  const { store, book, chapter } = fixture(t);
  store.addMemory(book.id, { subject: '林晚', relation: '交出', object: '铜钥匙', evidence: '铜钥匙', sourceChapterId: chapter.id });
  const target = book.chapters[1];
  store.putJob({ id: 'dependent', bookId: book.id, chapterId: target.id, kind: 'write', status: 'done', adopted: false, baseRevision: target.revision, output: '候选', context: { sourceChapters: [{ id: chapter.id, revision: chapter.revision, selected: true }] }, createdAt: new Date().toISOString() });
  store.recordProseSources(store.job('dependent'));
  const edited = store.updateChapter(chapter.id, { body: '林晚仍保管铜钥匙。' }, chapter.revision); store.finalize(edited.id, edited.revision);
  const affected = impact(store.book(book.id)); assert.equal(affected[0].candidates[0].chapterId, target.id);
  assert.equal(affected[0].dependents[0].id, target.id);
  const tools = service(store, []), run = await tools.analyze({ bookId: book.id, kind: 'facts', chapterId: chapter.id });
  assert.throws(() => tools.retireStale({ id: run.id }), /确认归档/);
  tools.retireStale({ id: run.id, confirm: true });
  assert.equal(store.book(book.id).memories.length, 0); assert.equal(store.chapter(chapter.id).body, edited.body); assert.ok(store.trash().some(row => row.type === 'memory'));
});

test('作品备份恢复保留原始书稿、素材和写前卡，分析过程不伪装已迁移', async t => {
  const { store, book, chapter } = fixture(t);
  store.updateChapter(chapter.id, { writingCard: { must: '交接' } }, chapter.revision);
    store.updateBook(book.id, { relatedMemoryOnly: true, includeContinuity: false, techniques: [{ title: '技法', method: '动作', source: '原文证据', evidence: '证据' }] });
    store.recordProseSources({ bookId: book.id, chapterId: book.chapters[1].id, context: { relationSources: [{ chapterId: chapter.id, revision: chapter.revision }] } });
  require('../electron/comparison.cjs').save(store, { chapterId: chapter.id, revision: 0, text: '备份中的人工对照草稿', referenceText: '备份中的固定参考全文' });
  const backup = store.backup(), main = readFileSync(resolve('electron/main.cjs'), 'utf8'), start = main.indexOf('async function restoreBackup()'), end = main.indexOf('const actions =', start);
  const { assert: guard, text, id, now } = require('../electron/store.cjs');
  const restore = require('node:vm').runInNewContext(main.slice(start, end) + ';restoreBackup;', { require: require('node:module').createRequire(resolve('electron/main.cjs')), store, win: {}, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['backup.json'] }) }, fs: { readFile: async () => JSON.stringify(backup), stat: async () => ({ size: Buffer.byteLength(JSON.stringify(backup)) }) }, assert: guard, text, id, now });
  assert.equal(await restore(), 1);
  const copy = store.book(store.list().find(b => b.id !== book.id).id);
  assert.equal(copy.importedSource.content, source); assert.equal(copy.techniques[0].evidence, '证据'); assert.equal(copy.chapters[0].writingCard.must, '交接');
  assert.equal(copy.includeContinuity, false);
  assert.equal(copy.comparisonDrafts[copy.chapters[0].id].text, '备份中的人工对照草稿');
  assert.equal(copy.comparisonDrafts[copy.chapters[0].id].reference.text, '备份中的固定参考全文');
    assert.equal(copy.relatedMemoryOnly, true);
  assert.equal(copy.chapters[1].proseSources[0].chapterId, copy.chapters[0].id);
  assert.notEqual(copy.chapters[1].proseSources[0].chapterId, chapter.id);
  assert.ok(backup.excludedHistory.includes('craft-analysis-runs'));
});

test('本地正文检查定位重复、占位与截断，尊重正常对白和结尾', async () => {
  const { checkProse } = await import('../electron/prose-check.mjs');
  const line = '林晚沿着长廊走到窗前，把铜钥匙藏进书柜最下面的抽屉里。';
  const text = line + '\n' + line + '\n（此处省略）\n她走进那间很久没有人来过的房间，看见桌子上的';
  const result = checkProse(text); assert.ok(result.some(r => r.kind === 'repeat' && r.line === 2)); assert.ok(result.some(r => r.kind === 'placeholder')); assert.ok(result.some(r => r.kind === 'ending'));
  for (const row of result) assert.equal(text.slice(row.start, row.end), row.excerpt);
  assert.deepEqual(checkProse('“作为AI，我会保护你。”\n林晚关上门。'), []);
});
