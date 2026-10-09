const { assert, text, now, id } = require("./store.cjs");

function liveBook(store, bookId) {
  const book = store.rawBook(text(bookId, 100));
  assert(!book.deletedAt, "请先恢复作品，再编辑备忘录");
  return book;
}
function saveMemo(store, input) {
  return store.transaction(() => {
    const book = liveBook(store, input.bookId);
    const notes = book.memos || [];
    const noteId = text(input.id || id(), 100);
    const current = notes.find((memo) => memo.id === noteId);
    assert(
      notes.filter((memo) => memo.id === noteId).length <= 1,
      "备忘录编号重复，未改动内容，请另存为新备忘录。",
    );
    const title = text(input.title ?? "", 160).trim() || "未命名备忘录";
    const content = text(input.content ?? "");
    if (current) {
      if (current.title === title && current.content === content)
        return current;
      assert(
        typeof input.baseUpdatedAt === "string" &&
          current.updatedAt === input.baseUpdatedAt,
        "这条备忘录已在其他地方修改，当前编辑仍保留。请刷新核对后再保存。",
      );
    } else {
      assert(
        input.baseUpdatedAt === null,
        "这条备忘录已被删除，当前编辑仍保留。请另存为新备忘录。",
      );
      assert(notes.length < 1000, "备忘录最多保存 1000 条");
    }
    const timestamp = new Date(
      Math.max(Date.now(), (Date.parse(current?.updatedAt || "") || 0) + 1),
    ).toISOString();
    const next = {
      id: noteId,
      title,
      content,
      createdAt: current?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    book.memos = current
      ? notes.map((memo) => (memo.id === noteId ? next : memo))
      : [next, ...notes];
    book.updatedAt = now();
    store.putBook(book);
    return next;
  });
}
function deleteMemo(store, input) {
  return store.transaction(() => {
    const book = liveBook(store, input.bookId);
    const notes = book.memos || [];
    const current = notes.find((memo) => memo.id === text(input.id, 100));
    if (!current) return true;
    assert(
      notes.filter((memo) => memo.id === current.id).length === 1,
      "备忘录编号重复，未删除内容，请先核对备忘录。",
    );
    assert(
      current.updatedAt === input.baseUpdatedAt,
      "这条备忘录已在其他地方修改，请刷新核对后再删除。",
    );
    book.memos = notes.filter((memo) => memo.id !== current.id);
    book.updatedAt = now();
    store.putBook(book);
    return true;
  });
}
function memoActions(store) {
  return {
    "memo:list": (d) => liveBook(store, d.bookId).memos || [],
    "memo:save": (d) => saveMemo(store, d),
    "memo:delete": (d) => deleteMemo(store, d),
  };
}
module.exports = { memoActions, saveMemo, deleteMemo };
