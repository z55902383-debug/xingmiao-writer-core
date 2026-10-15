const DAY = 86400000;
function policy(store) {
  const value = store.setting('trash-retention', { days: 0, effectiveFrom: '' });
  return value && [0, 7, 30, 90].includes(value.days) && (!value.days || Number.isFinite(Date.parse(value.effectiveFrom))) ? value : { days: 0, effectiveFrom: '' };
}
function configure(store, days, now = Date.now()) {
  if (![0, 7, 30, 90].includes(days)) throw Error('请选择有效的回收站保留天数');
  const previous = policy(store);
  const next = { days, effectiveFrom: days === previous.days ? previous.effectiveFrom : days ? new Date(now).toISOString() : '' };
  store.putSetting('trash-retention', next); return next;
}
function expires(entry, prefs) {
  if (!prefs.days) return null;
  const deleted = Date.parse(entry.deletedAt), grace = Date.parse(prefs.effectiveFrom);
  if (!Number.isFinite(deleted) || !Number.isFinite(grace)) return null;
  return Math.max(deleted, grace) + prefs.days * DAY;
}
function list(store, now = Date.now()) {
  const prefs = policy(store);
  return store.trash().map(entry => {
    const deadline = expires(entry, prefs);
    return { ...entry, bookTitle: store.rawBook(entry.bookId).title, cleanupAt: deadline === null ? '' : new Date(deadline).toISOString(), remainingDays: deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / DAY)) };
  });
}
function sweep(store, now = Date.now()) {
  const prefs = policy(store); if (!prefs.days) return { removed: 0 };
  return store.transaction(() => {
    const entries = store.trash(), removed = new Set(), removedBooks = new Set();
    const due = entry => { const at = expires(entry, prefs); return at !== null && at <= now; };
    for (const entry of entries.filter(due)) {
      if (removedBooks.has(entry.bookId)) { removed.add(entry.id); continue; }
      const book = store.rawBook(entry.bookId);
      if (entry.type === 'book') {
        // A restored/deleted-again object must never be purged by an older trash entry.
        if (!book.deletedAt || Date.parse(book.deletedAt) > Date.parse(entry.deletedAt)) { removed.add(entry.id); continue; }
        // Keep the book container until every dependent recovery item has had its full retention period.
        if (entries.some(e => e.bookId === book.id && !due(e))) continue;
        store.db.prepare('DELETE FROM versions WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id=?)').run(book.id);
        store.db.prepare('DELETE FROM candidates WHERE book_id=?').run(book.id);
        store.db.prepare('DELETE FROM chapters WHERE book_id=?').run(book.id);
        if (store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='craft_runs'").get()) store.db.prepare('DELETE FROM craft_runs WHERE book_id=?').run(book.id);
        store.db.prepare('DELETE FROM config WHERE id=?').run('knowledge-chat:' + book.id);
        store.db.prepare('DELETE FROM books WHERE id=?').run(book.id);
        removedBooks.add(book.id); for (const e of entries.filter(e => e.bookId === book.id)) removed.add(e.id);
      } else if (entry.type === 'chapter') {
        const c = store.chapters(book.id, true).find(c => c.id === entry.item.id);
        if (c?.deletedAt && Date.parse(c.deletedAt) <= Date.parse(entry.deletedAt)) {
          store.db.prepare('DELETE FROM versions WHERE chapter_id=?').run(c.id);
          store.db.prepare("DELETE FROM candidates WHERE json_extract(data,'$.chapterId')=?").run(c.id);
          store.db.prepare('DELETE FROM chapters WHERE id=?').run(c.id);
          if (book.comparisonDrafts) delete book.comparisonDrafts[c.id];
          store.putBook(book);
        }
        removed.add(entry.id);
      } else removed.add(entry.id);
    }
    store.putSetting('recycle-bin', entries.filter(e => !removed.has(e.id)));
    store.putSetting('trash-cleanup-last', { at: new Date(now).toISOString(), removed: removed.size });
    return { removed: removed.size };
  });
}
module.exports = { policy, configure, expires, list, sweep };
