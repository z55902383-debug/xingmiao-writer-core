const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { Store } = require("../electron/store.cjs");
const { memoActions, saveMemo, deleteMemo } = require("../electron/memo-actions.cjs");
const { buildContext } = require("../electron/context.cjs");
const { contextSignature } = require("../electron/timeline.cjs");

function setup(t) {
  const tempRoot = resolve(tmpdir());
  const dir = mkdtempSync(join(tempRoot, "xm-memos-"));
  assert.equal(resolve(dir), dir);
  assert.ok(dir.startsWith(`${tempRoot}\\xm-memos-`) || dir.startsWith(`${tempRoot}/xm-memos-`));
  const db = new Store(join(dir, "test.sqlite"));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const book = db.createBook({ title: "备忘录测试" });
  const chapter = db.updateChapter(book.chapters[0].id, { body: "已经写下的正文。\n\n另一段。" }, 1);
  db.putJob({ id: "existing-candidate", bookId: book.id, chapterId: chapter.id,
    baseRevision: chapter.revision, output: "保留原候选。", kind: "write", status: "done", adopted: false });
  return { db, bookId: book.id, chapterId: chapter.id, actions: memoActions(db) };
}
function create(db, bookId, id, title = id, content = "备忘内容") {
  return saveMemo(db, { bookId, id, title, content, baseUpdatedAt: null });
}
function manuscriptState(db, bookId) {
  const { memos, updatedAt, ...book } = db.rawBook(bookId);
  return {
    book,
    chapters: db.chapters(bookId, true),
    candidates: db.db.prepare("SELECT id,book_id,data FROM candidates ORDER BY id").all(),
    versions: db.db.prepare("SELECT id,chapter_id,data FROM versions ORDER BY id").all(),
  };
}

test("原子新建与更新仅改变目标备忘录，正文、候选和写作统计完整保留", (t) => {
  const { db, bookId, actions } = setup(t);
  const manuscript = manuscriptState(db, bookId);
  const first = create(db, bookId, "note-a", "  人物选择  ", "  原始空白\r\n原样内容😀\n");
  assert.equal(first.title, "人物选择");
  assert.equal(first.content, "  原始空白\r\n原样内容😀\n");
  assert.equal(first.createdAt, first.updatedAt);
  const second = create(db, bookId, "note-b", "其他笔记", "另一条内容");
  assert.deepEqual(manuscriptState(db, bookId), manuscript);
  assert.deepEqual(actions["memo:list"]({ bookId }), [second, first]);
  const changed = actions["memo:save"]({ bookId, id: first.id, title: "更新标题", content: "只更新此条",
    baseUpdatedAt: first.updatedAt });
  assert.equal(changed.createdAt, first.createdAt);
  assert.ok(changed.updatedAt > first.updatedAt);
  assert.deepEqual(actions["memo:list"]({ bookId }), [second, changed]);
  assert.deepEqual(manuscriptState(db, bookId), manuscript);
  assert.equal(db.rawBook(bookId).memos.find((note) => note.id === second.id).updatedAt, second.updatedAt);
});

test("无内容变化的保存和只读列表不会写入数据库或更改时间戳", (t) => {
  const { db, bookId, actions } = setup(t);
  const note = create(db, bookId, "note-a");
  const before = db.rawBook(bookId);
  const changes = db.db.prepare("SELECT total_changes() AS count").get().count;
  assert.deepEqual(actions["memo:list"]({ bookId }), [note]);
  assert.deepEqual(saveMemo(db, { bookId, ...note, baseUpdatedAt: note.updatedAt }), note);
  assert.deepEqual(db.rawBook(bookId), before);
  assert.equal(db.db.prepare("SELECT total_changes() AS count").get().count, changes);
});

test("旧时间戳不能覆盖或删除已更新笔记，冲突失败完整回滚", (t) => {
  const { db, bookId } = setup(t);
  const old = create(db, bookId, "note-a", "原标题", "原内容");
  const latest = saveMemo(db, { bookId, id: old.id, title: old.title, content: "其他地方的新内容", baseUpdatedAt: old.updatedAt });
  const before = db.rawBook(bookId);
  const manuscript = manuscriptState(db, bookId);
  assert.throws(() => saveMemo(db, { bookId, id: old.id, title: "过期编辑", content: "过期内容", baseUpdatedAt: old.updatedAt }), /其他地方修改/);
  assert.throws(() => deleteMemo(db, { bookId, id: old.id, baseUpdatedAt: old.updatedAt }), /其他地方修改/);
  assert.deepEqual(db.rawBook(bookId), before);
  assert.deepEqual(manuscriptState(db, bookId), manuscript);
  assert.equal(db.rawBook(bookId).memos[0].content, latest.content);
});

test("删除仅移除目标笔记，陈旧编辑不会悄悄重新创建已删除ID", (t) => {
  const { db, bookId, actions } = setup(t);
  const first = create(db, bookId, "note-a"), second = create(db, bookId, "note-b");
  const manuscript = manuscriptState(db, bookId);
  assert.equal(actions["memo:delete"]({ bookId, id: first.id, baseUpdatedAt: first.updatedAt }), true);
  assert.deepEqual(actions["memo:list"]({ bookId }), [second]);
  const afterDelete = db.rawBook(bookId);
  assert.throws(() => saveMemo(db, { bookId, id: first.id, title: first.title, content: "被删后编辑", baseUpdatedAt: first.updatedAt }), /已被删除/);
  assert.deepEqual(db.rawBook(bookId), afterDelete);
  assert.equal(deleteMemo(db, { bookId, id: first.id, baseUpdatedAt: first.updatedAt }), true);
  assert.deepEqual(db.rawBook(bookId), afterDelete);
  assert.deepEqual(manuscriptState(db, bookId), manuscript);
});

test("新建ID碰撞不会重复创建或覆盖笔记，标题160字与输入类型严格校验", (t) => {
  const { db, bookId } = setup(t);
  const note = create(db, bookId, "note-a", "已存在标题", "已存在内容");
  assert.throws(() => create(db, bookId, note.id, "碰撞标题", "碰撞内容"), /其他地方修改/);
  assert.deepEqual(db.rawBook(bookId).memos, [note]);
  const valid = create(db, bookId, "long-title", "章".repeat(160), "内容");
  assert.equal(valid.title.length, 160);
  const before = db.rawBook(bookId);
  for (const patch of [
    { title: "章".repeat(161), content: "内容" },
    { title: false, content: "内容" },
    { title: "标题", content: false },
    { id: "a".repeat(101), title: "标题", content: "内容" },
  ]) {
    assert.throws(() => saveMemo(db, { bookId, id: "invalid", baseUpdatedAt: null, ...patch }), /文本格式/);
    assert.deepEqual(db.rawBook(bookId), before);
  }
  const unnamed = create(db, bookId, "empty-title", " \t\n", "");
  assert.equal(unnamed.title, "未命名备忘录");
});

test("1000条上限只限制新建，满额仍可更新或删除现有笔记", (t) => {
  const { db, bookId } = setup(t);
  const timestamp = "2026-01-01T00:00:00.000Z";
  const notes = Array.from({ length: 1000 }, (_, i) => ({
    id: `note-${i}`, title: `笔记${i}`, content: `内容${i}`, createdAt: timestamp, updatedAt: timestamp,
  }));
  db.putBook({ ...db.rawBook(bookId), memos: notes });
  const before = db.rawBook(bookId);
  assert.throws(() => create(db, bookId, "overflow"), /1000/);
  assert.deepEqual(db.rawBook(bookId), before);
  const updated = saveMemo(db, { bookId, id: notes[0].id, title: "满额时修改", content: "更新内容", baseUpdatedAt: timestamp });
  assert.equal(db.rawBook(bookId).memos.length, 1000);
  assert.deepEqual(db.rawBook(bookId).memos.slice(1), notes.slice(1));
  deleteMemo(db, { bookId, id: updated.id, baseUpdatedAt: updated.updatedAt });
  create(db, bookId, "replacement");
  assert.equal(db.rawBook(bookId).memos.length, 1000);
});

test("同名笔记ID按作品隔离，跨书编辑凭据不会覆盖，删除作品拒绝编辑", (t) => {
  const { db, bookId, actions } = setup(t);
  const other = db.createBook({ title: "另一部作品" });
  const first = create(db, bookId, "shared-id", "甲笔记", "甲内容");
  const second = create(db, other.id, "shared-id", "乙笔记", "乙内容");
  assert.deepEqual(actions["memo:list"]({ bookId }), [first]);
  assert.deepEqual(actions["memo:list"]({ bookId: other.id }), [second]);
  const otherBefore = db.rawBook(other.id);
  saveMemo(db, { bookId, id: first.id, title: first.title, content: "甲变更", baseUpdatedAt: first.updatedAt });
  assert.deepEqual(db.rawBook(other.id), otherBefore);
  assert.throws(() => saveMemo(db, { bookId: other.id, id: "foreign-only", title: "跨书", content: "不应创建", baseUpdatedAt: first.updatedAt }), /已被删除/);
  assert.deepEqual(db.rawBook(other.id), otherBefore);
  deleteMemo(db, { bookId, id: first.id, baseUpdatedAt: db.rawBook(bookId).memos[0].updatedAt });
  assert.deepEqual(db.rawBook(other.id), otherBefore);
  assert.throws(() => actions["memo:list"]({ bookId: "missing-book" }), /找不到/);
  db.deleteBook(other.id);
  assert.throws(() => actions["memo:list"]({ bookId: other.id }), /恢复作品/);
  assert.throws(() => create(db, other.id, "deleted-book-note"), /恢复作品/);
  assert.throws(() => deleteMemo(db, { bookId: other.id, id: second.id, baseUpdatedAt: second.updatedAt }), /恢复作品/);
});

test("备忘录原子编辑与旧book:update改时间戳均不影响正文生成上下文", (t) => {
  const { db, bookId, chapterId } = setup(t);
  const timestamp = "2000-01-01T00:00:00.000Z";
  db.putBook({ ...db.rawBook(bookId), memos: [
    { id: "note-a", title: "私人备忘", content: "不能混入正文的秘密", createdAt: timestamp, updatedAt: timestamp },
    { id: "note-b", title: "另一条", content: "另一秘密", createdAt: timestamp, updatedAt: timestamp },
  ] });
  const originalBook = db.book(bookId), chapter = db.chapter(chapterId);
  const signature = contextSignature(originalBook, chapter);
  const context = buildContext(originalBook, chapter, "write");
  const manuscript = manuscriptState(db, bookId);
  const notes = memoActions(db)["memo:list"]({ bookId });
  const legacy = db.updateBook(bookId, { memos: notes });
  assert.notEqual(legacy.memos[0].updatedAt, notes[0].updatedAt);
  assert.notEqual(legacy.memos[1].updatedAt, notes[1].updatedAt);
  assert.equal(legacy.memos[0].content, notes[0].content);
  assert.throws(() => saveMemo(db, { bookId, id: notes[0].id, title: notes[0].title, content: "旧凭据编辑", baseUpdatedAt: notes[0].updatedAt }), /其他地方修改/);
  const refreshed = memoActions(db)["memo:list"]({ bookId })[0];
  saveMemo(db, { bookId, id: refreshed.id, title: refreshed.title, content: "纯备忘修改", baseUpdatedAt: refreshed.updatedAt });
  assert.deepEqual(buildContext(db.book(bookId), db.chapter(chapterId), "write"), context);
  assert.equal(contextSignature(db.book(bookId), db.chapter(chapterId)), signature);
  assert.deepEqual(manuscriptState(db, bookId), manuscript);
  assert.doesNotMatch(JSON.stringify(context.messages), /不能混入正文的秘密|另一秘密|纯备忘修改/);
});
