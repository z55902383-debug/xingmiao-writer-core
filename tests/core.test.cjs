const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Store, id, now } = require("../electron/store.cjs");
const { buildContext } = require("../electron/context.cjs");
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "xm-test-"));
  const db = new Store(join(dir, "test.sqlite"));
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return db;
}
function final(db, chapter, body) {
  const c = db.updateChapter(chapter.id, { body }, chapter.revision);
  return db.finalize(c.id, c.revision);
}
test("书籍隔离、持久化与草稿恢复", (t) => {
  const db = setup(t);
  const a = db.createBook({ title: "甲书" }),
    b = db.createBook({ title: "乙书" });
  const c = db.updateChapter(a.chapters[0].id, { body: "内容甲" }, 1);
  assert.equal(db.book(b.id).chapters[0].body, "");
  assert.equal(db.book(a.id).chapters[0].body, "内容甲");
  assert.equal(c.revision, 2);
  assert.throws(
    () => db.updateChapter(c.id, { body: "过期写入" }, 1),
    /已发生变化/,
  );
  assert.equal(db.chapter(c.id).body, "内容甲");
});
test("世界资料卡、角色认知、伏笔与每日净增统计可保存", (t) => {
  const db = setup(t);
  const b = db.createBook({ title: "资料结构" });
  const c = b.chapters[0];
  db.updateBook(b.id, {
    characters: [
      {
        id: "p1",
        name: "林雾",
        role: "主角",
        description: "调查员",
        characterKnown: "只知道失踪案",
        readerKnown: "见过红印",
        authorNotes: "作者秘密",
      },
    ],
    worldRecords: [
      {
        id: "w1",
        category: "地点",
        title: "旧钟楼",
        description: "每到午夜停摆",
        certainty: "fixed",
      },
    ],
    foreshadows: [
      {
        id: "f1",
        title: "停摆的钟",
        plantedChapterId: c.id,
        status: "open",
        note: "稍后解释",
      },
    ],
  });
  db.updateChapter(c.id, { body: "第一段正文" }, c.revision);
  db.updateChapter(c.id, { body: "第一段正文增加" }, 2);
  const saved = db.book(b.id);
  assert.equal(saved.characters[0].authorNotes, "作者秘密");
  assert.equal(saved.worldRecords[0].title, "旧钟楼");
  assert.equal(saved.foreshadows[0].status, "open");
  assert.equal(
    saved.writingActivity.reduce((sum, day) => sum + day.netWords, 0),
    7,
  );
});
test("长备忘录随作品独立保存且完整进入备份", (t) => {
  const db = setup(t);
  const a = db.createBook({ title: "备忘录甲" });
  const b = db.createBook({ title: "备忘录乙" });
  const memo = {
    id: "memo-1",
    title: "开篇灵感",
    content: "主角在旧车站收到一封信。",
  };
  const saved = db.updateBook(a.id, { memos: [memo] });
  assert.equal(saved.memos[0].content, memo.content);
  assert.equal(db.book(b.id).memos.length, 0);
  assert.equal(
    db.backup().books.find((book) => book.id === a.id).memos[0].title,
    "开篇灵感",
  );
  const long = "x".repeat(50001);
  db.updateBook(a.id, { memos: [{ ...memo, content: long }] });
  assert.equal(db.book(a.id).memos[0].content, long);
  assert.equal(db.backup().books.find((book) => book.id === a.id).memos[0].content, long);
});
test("只有先前定稿且版本有效的事实参与下一章", (t) => {
  const db = setup(t);
  const b = db.createBook({ title: "连续性" });
  const c1 = final(db, b.chapters[0], "甲把钥匙交给乙。");
  db.addMemory(b.id, {
    subject: "甲",
    relation: "交出钥匙",
    object: "乙",
    sourceChapterId: c1.id,
    evidence: "甲把钥匙交给乙。",
  });
  const c2 = db.createChapter(b.id);
  const c3 = final(db, db.createChapter(b.id), "乙知道了秘密。");
  db.addMemory(b.id, {
    subject: "乙",
    relation: "知道",
    object: "秘密",
    sourceChapterId: c3.id,
    evidence: "乙知道了秘密。",
  });
  let ctx = buildContext(db.book(b.id), c2, "write");
  assert.equal(ctx.memoryCount, 1);
  assert.doesNotMatch(ctx.messages[1].content, /乙知道了秘密/);
  assert.equal(buildContext(db.book(b.id), c1, "write").memoryCount, 0);
  db.updateChapter(c1.id, { body: "甲没有交出钥匙。" }, c1.revision);
  ctx = buildContext(db.book(b.id), c2, "write");
  assert.equal(ctx.memoryCount, 0);
  assert.ok(ctx.warnings.length);
  assert.ok(db.book(b.id).memories.every((m) => m.stale));
});
test("记忆来源必须属于本书，且证据必须逐字存在", (t) => {
  const db = setup(t);
  const a = db.createBook({ title: "A" }),
    b = db.createBook({ title: "B" });
  const c = final(db, a.chapters[0], "真实证据。");
  assert.throws(
    () =>
      db.addMemory(b.id, {
        subject: "人",
        relation: "是",
        object: "甲",
        sourceChapterId: c.id,
        evidence: "真实证据。",
      }),
    /本书/,
  );
  assert.throws(
    () =>
      db.addMemory(a.id, {
        subject: "人",
        relation: "是",
        object: "甲",
        sourceChapterId: c.id,
        evidence: "虚构证据",
      }),
    /原文/,
  );
  assert.equal(db.book(a.id).memories.length, 0);
});
test("候选稿采用不覆盖生成之后的手动编辑", (t) => {
  const db = setup(t);
  const b = db.createBook({ title: "A" });
  const c = b.chapters[0];
  const job = {
    id: id(),
    bookId: b.id,
    chapterId: c.id,
    baseRevision: 1,
    kind: "write",
    output: "AI正文",
    status: "done",
    adopted: false,
  };
  db.putJob(job);
  db.updateChapter(c.id, { body: "作者新写的内容" }, 1);
  assert.throws(() => db.adopt(job.id, "replace"), /原文已修改/);
  assert.equal(db.chapter(c.id).body, "作者新写的内容");
});
test("候选稿追加和历史恢复保留原文，重复采用被拒绝", (t) => {
  const db = setup(t);
  const b = db.createBook({ title: "A" });
  const c = db.updateChapter(b.chapters[0].id, { body: "开头" }, 1);
  const job = {
    id: id(),
    bookId: b.id,
    chapterId: c.id,
    baseRevision: c.revision,
    kind: "continue",
    output: "后文",
    status: "done",
    adopted: false,
  };
  db.putJob(job);
  db.adopt(job.id, "append");
  assert.equal(db.chapter(c.id).body, "开头\n\n后文");
  assert.throws(() => db.adopt(job.id, "append"), /已经采用/);
  const v = db.versions(c.id).find((v) => v.body === "开头");
  db.restoreVersion(c.id, v.id, db.chapter(c.id).revision);
  assert.equal(db.chapter(c.id).body, "开头");
  assert.ok(db.versions(c.id).some((v) => v.body.includes("后文")));
});
test("多条记忆确认具备事务性，部分证据无效时全部回滚", (t) => {
  const db = setup(t);
  const b = db.createBook({ title: "A" });
  const c = final(db, b.chapters[0], "甲给乙钥匙。");
  const job = {
    id: id(),
    bookId: b.id,
    chapterId: c.id,
    baseRevision: c.revision,
    kind: "memory",
    status: "done",
    adopted: false,
    output: JSON.stringify({
      memories: [
        {
          subject: "甲",
          relation: "交给",
          object: "乙",
          evidence: "甲给乙钥匙。",
        },
        {
          subject: "乙",
          relation: "知道",
          object: "秘密",
          evidence: "不存在的原文",
        },
      ],
    }),
  };
  db.putJob(job);
  assert.throws(() => db.acceptExtraction(job.id), /原文/);
  assert.equal(db.book(b.id).memories.length, 0);
  assert.equal(db.job(job.id).adopted, false);
});
test("正常记忆确认不会重复入库，备份不含模型密钥", (t) => {
  const db = setup(t);
  const b = db.createBook({ title: "A" });
  const c = final(db, b.chapters[0], "甲给乙钥匙。");
  const job = {
    id: id(),
    bookId: b.id,
    chapterId: c.id,
    baseRevision: c.revision,
    kind: "memory",
    status: "done",
    adopted: false,
    output: JSON.stringify({
      memories: [
        {
          subject: "甲",
          relation: "交给",
          object: "乙",
          evidence: "甲给乙钥匙。",
        },
      ],
    }),
  };
  db.putJob(job);
  db.acceptExtraction(job.id);
  assert.equal(db.book(b.id).memories.length, 1);
  assert.throws(() => db.acceptExtraction(job.id), /重复采用/);
  db.setConfig({ encryptedKey: "secret-encrypted-value" });
  assert.doesNotMatch(JSON.stringify(db.backup()), /secret-encrypted-value/);
});
test("大纲完整进入上下文，参考文章仅在分析任务中使用", (t) => {
  const db = setup(t);
  const b = db.createBook({ title: "A" });
  db.updateBook(b.id, {
    reference: "参考原文独有标记",
    outline: "长".repeat(20000),
  });
  const updated = db.book(b.id);
  const write = buildContext(updated, b.chapters[0], "write");
  assert.doesNotMatch(write.messages[1].content, /参考原文独有标记/);
  assert.match(write.messages[1].content, new RegExp("长".repeat(20000)));
  assert.ok(!write.warnings.some((w) => w.includes("预算")));
  const style = buildContext(updated, b.chapters[0], "style");
  assert.match(style.messages[1].content, /参考原文独有标记/);
});
test("中断任务重启后标记为中断，保留最近输出", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "xm-restart-"));
  const path = join(dir, "db.sqlite");
  let db = new Store(path);
  try {
    const b = db.createBook({ title: "持久化" });
    const job = {
      id: id(),
      bookId: b.id,
      chapterId: b.chapters[0].id,
      baseRevision: 1,
      kind: "write",
      output: "已收到的半段",
      status: "running",
      createdAt: now(),
    };
    db.putJob(job);
    db.close();
    db = new Store(path);
    assert.equal(db.job(job.id).status, "interrupted");
    assert.equal(db.job(job.id).output, "已收到的半段");
    assert.equal(db.list()[0].title, "持久化");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
