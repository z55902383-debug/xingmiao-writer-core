const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Store } = require("../electron/store.cjs");

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "xm-manual-"));
  const db = new Store(join(dir, "test.sqlite"));
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return db;
}

test("人工文稿一次保存为新章节，保留正文、历史及每日净增字数", (t) => {
  const db = setup(t);
  const book = db.createBook({ title: "人工码字" });
  const previous = db.updateChapter(book.chapters[0].id, { body: "既有正文" }, 1);
  const body = "  夜色渐深。\n\nA cat waits.\n" + "长文内容".repeat(2000);
  const chapter = db.createChapterWithBody(book.id, { title: "  归途  ", body });
  const saved = db.book(book.id);

  assert.equal(chapter.title, "归途");
  assert.equal(chapter.body, body);
  assert.equal(chapter.bookId, book.id);
  assert.equal(chapter.order, previous.order + 1);
  assert.equal(chapter.revision, 2);
  assert.equal(chapter.status, "draft");
  assert.equal(saved.chapters.length, 2);
  assert.deepEqual(db.chapter(previous.id), previous);
  assert.equal(saved.chapters[1].body, body);
  assert.equal(
    saved.writingActivity.reduce((sum, day) => sum + day.netWords, 0),
    (previous.body + body).replace(/\s/g, "").length,
  );
  const versions = db.versions(chapter.id);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].body, "");
  assert.equal(versions[0].revision, 1);
});

test("人工文稿未填写章名时沿用作品的章节编号", (t) => {
  const db = setup(t);
  const book = db.createBook({ title: "自动编号" });
  const chapter = db.createChapterWithBody(book.id, { body: "新增的正文。" });
  assert.equal(chapter.title, "第2章");
});

test("无效人工文稿不会创建章节或改动作品", (t) => {
  const db = setup(t);
  const book = db.createBook({ title: "输入校验" });
  const before = db.book(book.id);
  const invalid = [
    { title: "空正文", body: " \n\t " },
    { title: "类型错误", body: null },
    { title: "过长章名".repeat(31), body: "正文" },
    { title: false, body: "正文" },
  ];
  for (const input of invalid) {
    assert.throws(() => db.createChapterWithBody(book.id, input));
    assert.deepEqual(db.book(book.id), before);
  }
  const chapter = db.createChapterWithBody(book.id, { title: "章".repeat(120), body: "正文" });
  assert.equal(chapter.title.length, 120);
});

test("人工文稿保存出错时完整回滚章节、历史和活动统计", (t) => {
  const db = setup(t);
  const book = db.createBook({ title: "事务回滚" });
  const before = db.book(book.id);
  const beforeBackup = db.backup();
  const updateChapter = db.updateChapter.bind(db);
  db.updateChapter = (...args) => {
    updateChapter(...args);
    throw new Error("模拟首次保存失败");
  };

  assert.throws(
    () => db.createChapterWithBody(book.id, { title: "新章节", body: "应整体回滚的正文。" }),
    /模拟首次保存失败/,
  );
  assert.deepEqual(db.book(book.id), before);
  assert.deepEqual(db.backup().versions, beforeBackup.versions);
  assert.equal(db.chapters(book.id, true).length, before.chapters.length);
});

test("人工文稿不能写入已归档或已删除的作品", (t) => {
  const db = setup(t);
  const book = db.createBook({ title: "作品状态" });
  db.updateBook(book.id, { archived: true });
  const archived = db.book(book.id);
  assert.throws(
    () => db.createChapterWithBody(book.id, { title: "新章节", body: "正文" }),
    /归档/,
  );
  assert.deepEqual(db.book(book.id), archived);
  db.updateBook(book.id, { archived: false });
  db.deleteBook(book.id);
  const deleted = db.book(book.id, true);
  assert.throws(
    () => db.createChapterWithBody(book.id, { title: "新章节", body: "正文" }),
    /恢复作品/,
  );
  assert.deepEqual(db.book(book.id, true), deleted);
});

test("章节正文来源跨过全书最近40条限制，按本章过滤并保持只读", (t) => {
  const db = setup(t);
  const book = db.createBook({ title: "历史正文" });
  const chapter = book.chapters[0];
  const sibling = db.createChapter(book.id);
  const otherBook = db.createBook({ title: "其他作品" });
  const source = (id, patch = {}) => ({
    id,
    bookId: book.id,
    chapterId: chapter.id,
    kind: "write",
    status: "done",
    output: "保留的候选正文。",
    adopted: false,
    ...patch,
  });
  db.putJob(source("old-source", { adopted: true }));
  for (let i = 0; i < 45; i++)
    db.putJob(source(`sibling-${i}`, { chapterId: sibling.id }));
  assert.equal(db.jobs(book.id).some((job) => job.id === "old-source"), false);

  db.putJob(source("continue-source", { kind: "continue" }));
  db.putJob(source("polish-source", { kind: "polish", status: "error" }));
  db.putJob(source("interrupted-source", { status: "interrupted" }));
  db.putJob(source("cancelled-source", { status: "cancelled" }));
  db.putJob(source("running-source", { status: "running" }));
  db.putJob(source("outline-source", { kind: "outline" }));
  db.putJob(source("other-book", { bookId: otherBook.id }));
  db.putJob(source("other-chapter", { chapterId: otherBook.chapters[0].id }));
  db.putJob(source("empty-source", { output: "" }));
  db.putJob(source("whitespace-source", { output: " \n\t\r\u3000\u00a0" }));
  db.putJob(source("nontext-source", { output: null }));
  // The relational book key and the candidate's own metadata must both agree.
  db.db.prepare("INSERT INTO candidates VALUES (?,?,?)").run(
    "mismatched-book-metadata",
    book.id,
    JSON.stringify(source("mismatched-book-metadata", { bookId: otherBook.id })),
  );
  const beforeBook = db.rawBook(book.id);
  const beforeChapter = db.chapter(chapter.id);
  const beforeVersions = db.versions(chapter.id);
  const beforeChanges = db.db.prepare("SELECT total_changes() AS count").get().count;

  assert.deepEqual(db.chapterWritingSources(chapter.id).map((job) => job.id), [
    "cancelled-source",
    "interrupted-source",
    "polish-source",
    "continue-source",
    "old-source",
  ]);
  assert.deepEqual(db.rawBook(book.id), beforeBook);
  assert.deepEqual(db.chapter(chapter.id), beforeChapter);
  assert.deepEqual(db.versions(chapter.id), beforeVersions);
  assert.equal(db.db.prepare("SELECT total_changes() AS count").get().count, beforeChanges);
});

test("章节正文来源每章最多读取100条，不被其他章节候选挤占", (t) => {
  const db = setup(t);
  const book = db.createBook({ title: "较长创作历史" });
  const chapter = book.chapters[0];
  const sibling = db.createChapter(book.id);
  for (let i = 0; i < 105; i++) {
    db.putJob({
      id: `chapter-${i}`,
      bookId: book.id,
      chapterId: chapter.id,
      kind: "write",
      status: "done",
      output: `第${i}次正文`,
    });
    db.putJob({
      id: `sibling-${i}`,
      bookId: book.id,
      chapterId: sibling.id,
      kind: "write",
      status: "done",
      output: "另章正文",
    });
  }
  const sources = db.chapterWritingSources(chapter.id);
  assert.equal(sources.length, 100);
  assert.equal(sources[0].id, "chapter-104");
  assert.equal(sources[99].id, "chapter-5");
  assert.ok(sources.every((job) => job.chapterId === chapter.id && job.bookId === book.id));
});

test("已删除作品及章节仍可读取正文来源，缺失章节或作品则拒绝", (t) => {
  const db = setup(t);
  const book = db.createBook({ title: "可恢复历史" });
  const chapter = book.chapters[0];
  db.putJob({
    id: "recoverable-source",
    bookId: book.id,
    chapterId: chapter.id,
    kind: "write",
    status: "done",
    output: "误删前的候选正文",
  });
  db.putChapter({ ...chapter, deletedAt: new Date().toISOString() });
  db.deleteBook(book.id);
  assert.equal(db.chapterWritingSources(chapter.id)[0].id, "recoverable-source");
  assert.throws(() => db.chapterWritingSources("missing-chapter"), /章节不存在/);
  assert.throws(() => db.chapterWritingSources(null), /文本格式/);
  db.putChapter({ ...chapter, bookId: "missing-book" });
  assert.throws(() => db.chapterWritingSources(chapter.id), /找不到这本书/);
});
