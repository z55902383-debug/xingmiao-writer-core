const { test } = require('node:test');
const assert = require('node:assert/strict');
const { search, prepare, stateCard, createSemanticSearch, defaultChapterIds } = require('../electron/continuity.cjs');
const { buildContext } = require('../electron/context.cjs');
const { contextSignature } = require('../electron/timeline.cjs');
function fixture() {
  const chapters = Array.from({ length: 15 }, (_, i) => ({ id: 'c' + i, bookId: 'continuity-book', title: '第' + (i + 1) + '章', order: i + 1, revision: 1, status: 'final', outline: '', summary: '', body: `当天林晚沿河调查，第${i + 1}站没有新发现。`, updatedAt: '2026-10-14T00:00:00Z' }));
  chapters[0].body = '雨夜，林晚把铜钥匙交给陈默保管。陈默答应明天带她去旧码头。';
  chapters[13].status = 'draft'; chapters[13].outline = '老陈手里的铜钥匙归属'; chapters[13].body = '';
  chapters[14].body = '未来章节独有内容';
  return { id: 'continuity-book', title: '续写测试', genre: '', premise: '', outline: '', world: '', style: '', reference: '', contextChapters: 10, chapters, characters: [{ id: 'p', name: '陈默', role: '配角', description: '外号：老陈，熟悉码头', introducedOrder: 1 }], memories: [], timeline: [], foreshadows: [], worldRecords: [], candidates: [] };
}
const data = ctx => JSON.parse(ctx.messages[1].content.split('以下 JSON 为资料数据：\n')[1]);
const mockStore = book => ({ book: () => book, chapter: id => book.chapters.find(c => c.id === id) });

test('状态卡按当前章过滤，拒绝未来、草稿、过期和无原文证据记录', () => {
  const b = fixture(), c = b.chapters[13]; b.chapters[2].status = 'draft';
  b.memories = [
    { id: 'valid', subject: '铜钥匙', relation: '保管', object: '陈默', sourceChapterId: 'c0', sourceRevision: 1, evidence: '铜钥匙交给陈默保管', stale: false },
    { id: 'stale', subject: '过期标记', relation: '状态', object: '旧', sourceChapterId: 'c0', sourceRevision: 0, evidence: '陈默' },
    { id: 'bad', subject: '伪证标记', relation: '状态', object: '旧', sourceChapterId: 'c0', sourceRevision: 1, evidence: '不在原文' },
    { id: 'future', subject: '未来标记', relation: '状态', object: '未知', sourceChapterId: 'c14', sourceRevision: 1, evidence: '未来章节独有内容' },
    { id: 'draft', subject: '草稿标记', relation: '状态', object: '未知', sourceChapterId: 'c2', sourceRevision: 1, evidence: '调查' },
  ];
  b.foreshadows = [{ id: 'f', title: '有效旧线索', plantedChapterId: 'c0', status: 'open', note: '第三卷再揭示' }, { id: 'future-f', title: '未来伏笔标记', plantedChapterId: 'c14', status: 'open' }];
  const card = stateCard(b, c), text = JSON.stringify(card);
  assert.match(text, /铜钥匙/); assert.match(text, /有效旧线索/);
  assert.doesNotMatch(text, /过期标记|伪证标记|未来标记|草稿标记|未来章节独有内容|未来伏笔标记/);
  const ctx = buildContext(b, c, 'write'); assert.doesNotMatch(data(ctx).openForeshadows, /未来伏笔标记/);
  assert.equal(card.asOfChapterId, 'c12');
  assert.equal(card.sections.find(s => s.key === 'position').items[0].source.evidence, b.chapters[12].body);
});

test('人物、读者认知和作者秘密分别标记，未生效的认知不进入状态卡', () => {
  const b = fixture(), c = b.chapters[13];
  b.characters[0] = { ...b.characters[0], characterKnown: '只知道钥匙交接', readerKnown: '看到信封', knowledgeFromChapterId: 'c0', authorNotes: '真凶身份保密', secretFromChapterId: 'c1' };
  b.characters.push({ id: 'future', name: '未来人物标记', description: '', introducedOrder: 15, characterKnown: '未来认知', readerKnown: '未来信息' });
  const card = stateCard(b, c);
  assert.match(JSON.stringify(card.sections.find(s => s.key === 'knowledge')), /只知道钥匙交接/);
  assert.doesNotMatch(JSON.stringify(card.sections.find(s => s.key === 'knowledge')), /真凶身份/);
  assert.match(JSON.stringify(card.sections.find(s => s.key === 'limits')), /不能据此视为角色或读者已知/);
  assert.doesNotMatch(JSON.stringify(stateCard(b, b.chapters[0])), /只知道钥匙交接|真凶身份|未来人物/);
});

test('回看较早章节时，不把未来章节中的伏笔回收提前视为完成', () => {
  const b = fixture(); b.foreshadows = [{ id: 'f', title: '信封来历', plantedChapterId: 'c0', payoffChapterId: 'c10', status: 'resolved' }];
  const before = stateCard(b, b.chapters[5]), after = stateCard(b, b.chapters[13]);
  assert.equal(before.sections.find(s => s.key === 'open').items.length, 1);
  assert.equal(after.sections.find(s => s.key === 'open').items.length, 0);
  assert.equal(JSON.parse(data(buildContext(b, b.chapters[5], 'write')).openForeshadows).length, 1);
});

test('旧文检索利用人物别名和事件词，片段必须是已定稿来源的精确切片', () => {
  const b = fixture(), c = b.chapters[13], result = search(b, c, { query: '老陈归属' });
  const item = result.results.find(r => r.chapterId === 'c0'); assert.ok(item);
  assert.match(item.reasons.join('；'), /相关人物：陈默/);
  for (const row of result.results) {
    const source = b.chapters.find(c => c.id === row.chapterId);
    assert.equal(row.text, source.body.slice(row.start, row.end));
    assert.ok(source.order < c.order && source.status === 'final');
    assert.ok(!defaultChapterIds(b, c).includes(source.id));
    assert.equal(row.selected, false);
  }
});

test('保持最近10章完整正文，只有明确勾选的旧文才附加到请求并保存引用快照', () => {
  const b = fixture(), c = b.chapters[13], item = search(b, c).results.find(r => r.chapterId === 'c0');
  const base = buildContext(b, c, 'write'); assert.equal(data(base).recent.length, 10); assert.deepEqual(base.retrievedExcerpts, []);
  const ctx = buildContext(b, c, 'write', '', [], { excerptIds: [item.id] });
  assert.deepEqual(data(ctx).recent.map(r => r.body), b.chapters.slice(3, 13).map(r => r.body));
  assert.equal(data(ctx).retrievedExcerpts[0].text, item.text); assert.equal(ctx.retrievedExcerpts[0].chapterId, 'c0');
  assert.ok(ctx.referenceSections.some(row => row.key === 'retrieved' && row.count === 1));
  const snapshot = JSON.stringify(ctx); b.chapters[0].body = '已改写'; assert.equal(JSON.stringify(ctx), snapshot);
  assert.throws(() => buildContext(b, c, 'write', '', [], { excerptIds: [item.id] }), /重新检索/);
});

test('完整章节与片段去重，取消正文引用不由状态卡偷偷补回结尾', () => {
  const b = fixture(), c = b.chapters[13], item = search(b, c).results.find(r => r.chapterId === 'c0');
  const ctx = buildContext(b, c, 'write', '', [], { chapterIds: ['c0'], excerptIds: [item.id] });
  assert.equal(data(ctx).recent.length, 1); assert.deepEqual(ctx.retrievedExcerpts, []);
  const none = data(buildContext(b, c, 'write', '', [], { chapterIds: [] }));
  assert.deepEqual(none.recent, []);
  assert.equal(none.continuityCard.sections.find(s => s.key === 'position').items[0].source.evidence, '');
  const off = buildContext({ ...b, includeContinuity: false }, c, 'write'); assert.equal(off.continuityCard, undefined);
  assert.notEqual(contextSignature(b, c), contextSignature({ ...b, includeContinuity: false }, c));
  assert.equal(buildContext(b, c, 'outline').continuityCard, undefined);
});

test('来源取消定稿、改序或内容变化后拒绝旧片段，包括缓存下的同版本修改', () => {
  for (const change of [c => { c.status = 'draft'; }, c => { c.order = 20; }, c => { c.body = '全新原文。'; }]) {
    const b = fixture(), c = b.chapters[13], item = search(b, c).results.find(r => r.chapterId === 'c0'); change(b.chapters[0]);
    assert.throws(() => search(b, c, { excerptIds: [item.id] }), /重新检索/);
  }
  const b = fixture(), c = b.chapters[13];
  assert.throws(() => search(b, c, { excerptIds: ['forged'] }), /重新检索/);
});

test('语义补搜只允许候选ID，原文由程序提供，模型不能替换证据', async () => {
  const b = fixture(), c = b.chapters[13]; let sent;
  const tools = createSemanticSearch({ getStore: () => mockStore(b), ask: async (messages, chunk) => {
    sent = messages; const pool = JSON.parse(messages[1].content.split('\n候选：')[1]);
    chunk(JSON.stringify({ matches: [{ id: pool[0].id, reason: '此处记载物品交接', text: '伪造的引文' }] }));
  } });
  const result = await tools.run({ bookId: b.id, chapterId: c.id, query: '之前的交接' });
  const row = result.matches[0], origin = b.chapters.find(c => c.id === row.chapterId);
  assert.equal(row.text, origin.body.slice(row.start, row.end)); assert.notEqual(row.text, '伪造的引文');
  assert.ok(result.candidateCount <= 64); assert.doesNotMatch(JSON.stringify(sent), /未来章节独有内容/);
  const invalid = createSemanticSearch({ getStore: () => mockStore(b), ask: async (_, chunk) => chunk('{"matches":[{"id":"unknown","reason":"猜测"}]}') });
  await assert.rejects(invalid.run({ bookId: b.id, chapterId: c.id, query: '钥匙' }), /无效/);
});

test('语义补搜期间来源或目标变化会拒绝迟到的结果', async () => {
  for (const mutate of [b => { b.chapters[0].body = '内容被改写'; }, b => { b.chapters[13].revision++; }]) {
    const b = fixture(), c = b.chapters[13];
    const tools = createSemanticSearch({ getStore: () => mockStore(b), ask: async (messages, chunk) => {
      const pool = JSON.parse(messages[1].content.split('\n候选：')[1]), row = pool.find(r => r.text.includes('铜钥匙')); mutate(b);
      chunk(JSON.stringify({ matches: [{ id: row.id, reason: '相关' }] }));
    } });
    await assert.rejects(tools.run({ bookId: b.id, chapterId: c.id, query: '铜钥匙' }), /变化|无效/);
  }
});

test('语义补搜可以停止；状态卡和本地检索不触发任何模型调用', async () => {
  const b = fixture(), c = b.chapters[13]; let started, calls = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const tools = createSemanticSearch({ getStore: () => mockStore(b), ask: async (_, __, signal) => { calls++; started(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('stopped')), { once: true })); } });
  const p = prepare(b, c); assert.equal(calls, 0); assert.equal(p.stateCard.asOfChapterId, 'c12');
  const pending = tools.run({ bookId: b.id, chapterId: c.id, query: '钥匙' }); await ready; tools.cancel(b.id);
  await assert.rejects(pending, /stopped/); assert.equal(calls, 1);
});

test('改写来源再定稿不会复活旧认知或伏笔，逐项重新确认且拒绝过期确认', t => {
  const { mkdtempSync, rmSync } = require('node:fs'), { join, resolve, sep } = require('node:path'), { tmpdir } = require('node:os');
  const { Store } = require('../electron/store.cjs'), { confirmReview } = require('../electron/continuity.cjs');
  const folder = mkdtempSync(join(tmpdir(), 'xm-continuity-')), store = new Store(join(folder, 'store.sqlite'));
  t.after(() => { store.close(); assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + sep)); rmSync(folder, { recursive: true, force: true }); });
  const b = store.createBook({ title: '知情版本测试' }), c = b.chapters[0];
  const source = store.updateChapter(c.id, { body: '陈默知道铜钥匙的存在。' }, c.revision); store.finalize(source.id, source.revision);
  const current = store.createChapter(b.id);
  store.updateBook(b.id, { characters: [{ id: 'p', name: '陈默', role: '', description: '', characterKnown: '知道钥匙存在', readerKnown: '看到信封', knowledgeFromChapterId: source.id, authorNotes: '组织身份未揭露', secretFromChapterId: source.id }], foreshadows: [{ id: 'f', title: '信封来历', plantedChapterId: source.id, status: 'open', note: '之后再揭示' }] });
  const changed = store.updateChapter(source.id, { body: '陈默没有收到铜钥匙，但知道它的存在。' }, source.revision); store.finalize(changed.id, changed.revision);
  let book = store.book(b.id), preview = prepare(book, current); assert.equal(preview.reviews.length, 3);
  assert.equal(preview.stateCard.sections.find(s => s.key === 'knowledge').items.length, 0); assert.equal(preview.stateCard.sections.find(s => s.key === 'open').items.length, 0);
  const payload = data(buildContext(book, current, 'write')); assert.equal(JSON.parse(payload.characters)[0].characterKnown, undefined); assert.equal(JSON.parse(payload.openForeshadows).length, 0);
  const row = preview.reviews.find(r => r.kind === 'knowledge');
  book = confirmReview(store, { bookId: b.id, id: row.id, kind: row.kind, basis: row.basis });
  assert.equal(book.characters[0].knowledgeStale, false); assert.equal(book.characters[0].secretStale, true);
  assert.equal(prepare(book, current).stateCard.sections.find(s => s.key === 'knowledge').items.length, 1);
  assert.throws(() => confirmReview(store, { bookId: b.id, id: row.id, kind: row.kind, basis: row.basis }), /变化/);
  const stale = prepare(book, current).reviews.find(r => r.kind === 'secret');
  store.updateChapter(source.id, { body: '来源再次改写。' }, changed.revision);
  assert.throws(() => confirmReview(store, { bookId: b.id, id: stale.id, kind: stale.kind, basis: stale.basis }), /变化/);
});
