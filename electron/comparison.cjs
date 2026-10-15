const { createHash } = require('node:crypto');
const hash = text => createHash('sha256').update(text).digest('hex');
const check = (ok, message) => { if (!ok) throw Error(message); };
const string = value => { check(typeof value === 'string', '对照文稿格式无效'); return value; };
function chapterFor(store, input) {
  const c = store.chapter(input.chapterId), b = store.rawBook(c.bookId);
  check(!c.deletedAt && !b.deletedAt && !b.archived, '章节不可编辑，请先恢复作品和章节');
  return { c, b };
}
function read(store, input) {
  const { c, b } = chapterFor(store, input);
  return b.comparisonDrafts?.[c.id] || { chapterId: c.id, revision: 0, text: '', reference: null, baseRevision: c.revision, baseHash: hash(c.body), updatedAt: '' };
}
function save(store, input) {
  return store.transaction(() => {
    const { c, b } = chapterFor(store, input), previous = read(store, input);
    check(input.revision === previous.revision, '对照草稿已在其他入口更新；当前输入仍保留，请重新载入前先复制或导出');
    const next = { ...previous, text: string(input.text), revision: previous.revision + 1, updatedAt: new Date().toISOString() };
    if (input.sourceId !== undefined) {
      if (input.sourceId === '') next.reference = null;
      else {
        const job = store.job(string(input.sourceId));
        check(job.bookId === b.id && job.chapterId === c.id && ['write', 'continue', 'polish'].includes(job.kind) && ['done', 'cancelled', 'interrupted'].includes(job.status) && job.output.trim(), '请选择本章已有正文候选稿');
        next.reference = { id: job.id, title: `${c.title} · ${job.kind}`, text: job.output, kind: job.kind, createdAt: job.createdAt || '' };
      }
    }
    if (input.referenceText !== undefined) next.reference = { id: '', title: '自定义参考文', text: string(input.referenceText), kind: 'custom', createdAt: new Date().toISOString() };
    if (input.loadBody === true) { next.text = c.body; next.baseRevision = c.revision; next.baseHash = hash(c.body); }
    b.comparisonDrafts = { ...b.comparisonDrafts, [c.id]: next }; store.putBook(b); return next;
  });
}
function apply(store, input) {
  return store.transaction(() => {
    const { c } = chapterFor(store, input), draft = read(store, input);
    check(input.revision === draft.revision, '对照草稿已变化，请先保存并重新核对');
    check(draft.text.trim(), '请先在右栏写下正文');
    check(c.revision === draft.baseRevision && hash(c.body) === draft.baseHash, '章节正文已变化；对照草稿仍保留，请先核对现有正文或另存为新章节');
    const saved = store.updateChapter(c.id, { body: draft.text }, c.revision, '对照创作写入前快照');
    const b = store.rawBook(c.bookId);
    const next = { ...draft, revision: draft.revision + 1, baseRevision: saved.revision, baseHash: hash(saved.body), updatedAt: new Date().toISOString() };
    b.comparisonDrafts = { ...b.comparisonDrafts, [c.id]: next }; store.putBook(b);
    return { draft: next, book: store.book(b.id), chapter: saved };
  });
}
function rescue(store, input) {
  return store.transaction(() => {
    const { c, b } = chapterFor(store, input);
    const text = string(input.text); check(text.trim(), '请先写下需要保留的人工稿');
    const chapter = store.createChapterWithBody(b.id, { title: (c.title.slice(0, 100) + '（对照创作副本）').slice(0, 120), body: text });
    return { chapter, book: store.book(b.id), draft: read(store, input) };
  });
}
function restoreDrafts(source, chapterMap) {
  const restored = {};
  for (const [id, d] of Object.entries(source || {})) {
    if (!chapterMap.has(id)) continue;
    check(d && Number.isInteger(d.revision) && d.revision >= 0 && Number.isInteger(d.baseRevision) && typeof d.baseHash === 'string', '备份中的对照草稿格式无效');
    const reference = d.reference ? { ...d.reference, id: '', text: string(d.reference.text), title: string(d.reference.title) } : null;
    restored[chapterMap.get(id)] = { chapterId: chapterMap.get(id), revision: d.revision, text: string(d.text), reference, baseRevision: d.baseRevision, baseHash: d.baseHash, updatedAt: d.updatedAt || '' };
  }
  return restored;
}
module.exports = { read, save, apply, rescue, restoreDrafts };
