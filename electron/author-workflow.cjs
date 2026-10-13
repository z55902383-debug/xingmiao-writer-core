function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function completeBook(store, bookId) {
  return store.transaction(() => {
    const book = store.book(bookId);
    if (book.deletedAt || !book.chapters.length || book.chapters.some(c => !c.body.trim() || c.status !== 'final'))
      throw Error('请先为所有章节填写正文并定稿，再确认完结。');
    store.putBook({ ...store.rawBook(bookId), completedAt: new Date().toISOString() });
    return store.book(bookId);
  });
}
function safePlaceholder(book) {
  const c = book.chapters[0];
  return book.chapters.length === 1 && c && !c.volumeId && !c.body.trim() && !c.summary?.trim() && !c.outline.trim() && c.status !== 'final' && /^第\s*[1一]\s*章$/.test(c.title) ? c : null;
}
module.exports = { localDate, completeBook, safePlaceholder };
