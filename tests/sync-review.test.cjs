const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Store } = require("../electron/store.cjs");
const sync = require("../electron/sync-review.cjs");
const { contextSignature } = require("../electron/timeline.cjs");
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "sync-")),
    db = new Store(join(dir, "test.sqlite"));
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const b = db.createBook({ title: "测试" });
  const c = db.updateChapter(
    b.chapters[0].id,
    { body: "顾舟来到城中。顾舟已经失踪。" },
    1,
  );
  return { db, b: db.book(b.id), c };
}
function job(db, b, c, rows) {
  const j = {
    id: "j",
    bookId: b.id,
    chapterId: c.id,
    kind: "write",
    output: c.body,
    status: "done",
    adopted: true,
    review: {
      status: "ready",
      bodyHash: sync.hash(c.body),
      revision: c.revision,
      signature: contextSignature(b, c),
      changes: rows,
    },
  };
  db.putJob(j);
  return j;
}
test("同步新人和状态需要确认，证据有效，重复同步拒绝", (t) => {
  const { db, b, c } = setup(t);
  const rows = sync.parse(
    JSON.stringify({
      changes: [
        {
          kind: "newCharacter",
          subject: "顾舟",
          value: "来到城中",
          evidence: "顾舟来到城中。",
        },
        {
          kind: "character",
          subject: "顾舟",
          attribute: "生存状态",
          value: "失踪",
          evidence: "顾舟已经失踪。",
        },
      ],
    }),
    c.body,
  );
  job(db, b, c, rows);
  const result = sync.apply(db, "j", rows);
  assert.equal(result.characters.length, 1);
  assert.equal(result.timeline[0].value, "失踪");
  assert.equal(result.chapters[0].status, "final");
  assert.throws(() => sync.apply(db, "j", rows), /采用正文/);
});
test("同步任一项失败全体回滚，修改正文后拒绝旧清单", (t) => {
  const { db, b, c } = setup(t);
  const rows = sync.parse(
    JSON.stringify({
      changes: [
        {
          kind: "newCharacter",
          subject: "顾舟",
          value: "新人",
          evidence: "顾舟来到城中。",
        },
        {
          kind: "relation",
          subject: "顾舟",
          target: "不存在",
          attribute: "关系",
          value: "朋友",
          evidence: "顾舟来到城中。",
        },
      ],
    }),
    c.body,
  );
  job(db, b, c, rows);
  assert.throws(() => sync.apply(db, "j", rows), /姓名/);
  assert.equal(db.book(b.id).characters.length, 0);
  assert.equal(db.chapter(c.id).status, "draft");
  db.updateChapter(c.id, { body: c.body + "修改" }, c.revision);
  assert.throws(() => sync.apply(db, "j", rows), /重新分析/);
});
test("无变化返回空清单，伪造证据不能进入清单", () => {
  assert.deepEqual(sync.parse('{"changes":[]}', "正文"), []);
  assert.throws(
    () =>
      sync.parse(
        '{"changes":[{"kind":"world","subject":"城","value":"封锁","evidence":"伪造"}]}',
        "正文",
      ),
    /证据/,
  );
});
