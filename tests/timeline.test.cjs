const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { Store } = require("../electron/store.cjs");
const { resolveTimeline } = require("../electron/timeline.cjs");
const { buildContext } = require("../electron/context.cjs");
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "xm-time-")),
    db = new Store(join(dir, "db.sqlite"));
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let b = db.createBook({ title: "时间线测试" });
  db.updateBook(b.id, {
    characters: [
      { id: "a", name: "甲", role: "主角", description: "起点" },
      { id: "b", name: "乙", role: "配角", description: "起点" },
    ],
  });
  const cs = [b.chapters[0], db.createChapter(b.id), db.createChapter(b.id)];
  for (const c of cs) {
    const n = db.updateChapter(
      c.id,
      {
        body: ["甲与乙结盟。", "甲与乙决裂。北境陷落。", "甲死亡。"][
          cs.indexOf(c)
        ],
      },
      c.revision,
    );
    db.finalize(c.id, n.revision);
  }
  return { db, b: db.book(b.id), cs: db.book(b.id).chapters };
}
const event = (patch = {}) => ({
  kind: "relation",
  title: "结盟",
  characterId: "a",
  targetId: "b",
  attribute: "关系",
  value: "盟友",
  chapterId: "",
  phase: "confirmed",
  ...patch,
});
test("世界、关系、生死按章回看，生成章首不偷看章末与未来", (t) => {
  const { db, b, cs } = setup(t);
  db.saveEvent(b.id, event());
  db.saveEvent(
    b.id,
    event({ title: "决裂", chapterId: cs[1].id, value: "敌对" }),
  );
  db.saveEvent(
    b.id,
    event({
      kind: "character",
      title: "死亡",
      targetId: "",
      attribute: "生存状态",
      value: "死亡",
      chapterId: cs[2].id,
    }),
  );
  db.saveEvent(
    b.id,
    event({
      kind: "world",
      title: "北境陷落",
      entity: "北境",
      attribute: "政局",
      value: "沦陷",
      chapterId: cs[1].id,
    }),
  );
  const book = db.book(b.id);
  assert.equal(resolveTimeline(book, cs[0].id).relations[0].value, "盟友");
  assert.equal(resolveTimeline(book, cs[1].id).relations[0].value, "敌对");
  assert.equal(resolveTimeline(book, cs[2].id).characters[0].value, "死亡");
  const ctx = buildContext(book, book.chapters[1], "write");
  const json = JSON.parse(
    ctx.messages[1].content.split("以下 JSON 为资料数据：\n")[1],
  );
  assert.equal(JSON.parse(json.timelineState).relations[0].value, "盟友");
  assert.equal(JSON.parse(json.timelineState).characters.length, 0);
  assert.ok(!JSON.stringify(json).includes("死亡"));
  assert.equal(JSON.parse(json.currentChapterPlans)[0].value, "敌对");
});
test("计划不进入事实，编辑前文使后续时间线待复核，重确认校验来源与人物", (t) => {
  const { db, b, cs } = setup(t);
  db.saveEvent(
    b.id,
    event({ chapterId: cs[2].id, phase: "planned", value: "敌对" }),
  );
  assert.equal(resolveTimeline(db.book(b.id), cs[2].id).relations.length, 0);
  const e = db.book(b.id).timeline[0];
  db.saveEvent(b.id, { ...e, phase: "confirmed" });
  db.updateChapter(cs[0].id, { body: "改过前文" }, cs[0].revision);
  assert.equal(
    resolveTimeline(db.book(b.id), cs[2].id).events[0].state,
    "stale",
  );
  assert.equal(resolveTimeline(db.book(b.id), cs[2].id).relations.length, 0);
  db.saveEvent(b.id, { ...e, phase: "confirmed" });
  assert.equal(resolveTimeline(db.book(b.id), cs[2].id).relations.length, 1);
  assert.throws(
    () => db.saveEvent(b.id, event({ chapterId: cs[0].id })),
    /定稿/,
  );
  assert.throws(
    () => db.saveEvent(b.id, event({ characterId: "missing" })),
    /人物/,
  );
  assert.throws(
    () =>
      db.saveEvent(
        b.id,
        event({ chapterId: cs[1].id, evidence: "不存在的证据" }),
      ),
    /证据/,
  );
});
test("删除最新变化回到旧状态，回收站恢复为计划；人物删除不残留有效关系", (t) => {
  const { db, b, cs } = setup(t);
  db.saveEvent(b.id, event());
  db.saveEvent(b.id, event({ chapterId: cs[1].id, value: "敌对" }));
  db.deleteEvent(b.id, db.book(b.id).timeline[1].id);
  assert.equal(
    resolveTimeline(db.book(b.id), cs[2].id).relations[0].value,
    "盟友",
  );
  db.restoreTrash(db.trash()[0].id);
  assert.equal(db.book(b.id).timeline[1].phase, "planned");
  db.deleteCharacter(b.id, "a");
  assert.equal(resolveTimeline(db.book(b.id), cs[2].id).relations.length, 0);
});
test("分卷删除不丢章节，恢复关联；字数规划不取消定稿，提示区分整章和续写", (t) => {
  const { db, b, cs } = setup(t);
  db.saveVolume(b.id, { title: "第一卷", outline: "卷大纲", detail: "卷细纲" });
  const v = db.book(b.id).volumes[0];
  db.organizeChapter(cs[0].id, { volumeId: v.id, targetWords: 2500 });
  assert.equal(db.chapter(cs[0].id).status, "final");
  db.deleteVolume(b.id, v.id);
  assert.equal(db.book(b.id).chapters.length, 3);
  assert.equal(db.chapter(cs[0].id).volumeId, "");
  db.restoreTrash(db.trash()[0].id);
  assert.equal(db.chapter(cs[0].id).volumeId, v.id);
  let book = db.book(b.id);
  let ctx = buildContext(book, book.chapters[0], "write");
  assert.match(ctx.messages[1].content, /2500/);
  assert.match(ctx.messages[1].content, /卷细纲/);
  ctx = buildContext(book, book.chapters[0], "continue");
  assert.match(ctx.messages[1].content, /本次建议补写/);
  assert.throws(
    () => db.organizeChapter(cs[0].id, { volumeId: "other" }),
    /不属于/,
  );
  assert.throws(
    () => db.organizeChapter(cs[0].id, { targetWords: -1 }),
    /目标字数/,
  );
  db.updateBook(b.id, { chapterTargetWords: 3300 });
  book = db.book(b.id);
  assert.equal(buildContext(book, book.chapters[1], "write").targetWords, 3300);
});
test("设定变化阻止旧候选直接覆盖，类型切换不会残留错误关联", (t) => {
  const { db, b, cs } = setup(t);
  const { contextSignature } = require("../electron/timeline.cjs");
  db.putJob({
    id: "candidate",
    bookId: b.id,
    chapterId: cs[0].id,
    kind: "write",
    status: "done",
    output: "旧候选内容",
    adopted: false,
    baseRevision: cs[0].revision,
    contextSignature: contextSignature(db.book(b.id), cs[0]),
    createdAt: new Date().toISOString(),
  });
  db.saveEvent(
    b.id,
    event({
      kind: "character",
      entity: "不应残留的世界对象",
      targetId: "b",
      attribute: "生存状态",
      value: "存活",
    }),
  );
  const saved = db.book(b.id).timeline[0];
  assert.equal(saved.entity, "");
  assert.equal(saved.targetId, "");
  assert.throws(() => db.adopt("candidate", "replace"), /时间线或规划已变化/);
  assert.equal(db.chapter(cs[0].id).body, "甲与乙结盟。");
});
