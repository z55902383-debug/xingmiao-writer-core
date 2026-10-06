const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { join, resolve, sep } = require("node:path");
const { tmpdir } = require("node:os");
const { runInNewContext } = require("node:vm");
const { Store, assert: check, text, id, now } = require("../electron/store.cjs");
const { contextSignature } = require("../electron/timeline.cjs");
const { buildContext } = require("../electron/context.cjs");
const { canvasRefs } = require("../electron/canvas.cjs");

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "xm-canvas-")), path = join(dir, "test.sqlite"), handles = new Set();
  const open = () => { const db = new Store(path); handles.add(db); return db; };
  const close = (db) => { db.close(); handles.delete(db); };
  t.after(() => {
    for (const db of handles) db.close();
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    rmSync(dir, { recursive: true, force: true });
  });
  return { db: open(), open, close };
}
function sample(db) {
  let book = db.createBook({ title: "画布作品", premise: "调查失踪案" });
  const c = db.updateChapter(book.chapters[0].id, { body: "林雾在旧钟楼找到钥匙。", outline: "追查钟楼", summary: "发现钥匙" }, 1);
  db.finalize(c.id, c.revision);
  db.updateBook(book.id, {
    outline: "全书正文资料不能复制进布局", world: "世界正文资料不能复制进布局",
    characters: [{ id: "person-1", name: "林雾", role: "调查员", description: "谨慎", authorNotes: "秘密", knowledgeFromChapterId: c.id, secretFromChapterId: c.id }],
    worldRecords: [{ id: "world-1", category: "地点", title: "旧钟楼", description: "午夜停摆", certainty: "fixed" }],
    foreshadows: [{ id: "clue-1", title: "钥匙", plantedChapterId: c.id, payoffChapterId: c.id, status: "resolved", note: "回收" }],
  });
  db.saveVolume(book.id, { id: "volume-1", title: "调查", outline: "卷大纲", detail: "卷细纲" });
  const volume = db.book(book.id).volumes[0];
  db.organizeChapter(c.id, { volumeId: volume.id });
  db.addMemory(book.id, { subject: "林雾", relation: "找到", object: "钥匙", sourceChapterId: c.id, evidence: "林雾在旧钟楼找到钥匙。" });
  db.saveEvent(book.id, { kind: "world", title: "钟楼封锁", entity: "旧钟楼", attribute: "状态", value: "封锁", chapterId: c.id, phase: "confirmed", sequence: 1 });
  book = db.book(book.id);
  const nodes = Object.fromEntries([...canvasRefs(book)].map((key, index) => [key, { x: index * 90, y: index ? -index * 35 : 0, locked: index % 2 === 0 }]));
  return { book, layout: {
    version: 1, nodes, viewport: { x: 230, y: -150, zoom: 0.8 },
    annotations: [{ id: "note-1", source: "character:person-1", target: "world:world-1", label: "调查地点", note: "作者标注，不是事实", direction: "forward", dashed: true }],
  } };
}
async function restore(db, backup) {
  const source = readFileSync(join(__dirname, "../electron/main.cjs"), "utf8");
  const start = source.indexOf("async function restoreBackup()"), end = source.indexOf("const actions =", start);
  assert.ok(start >= 0 && end > start);
  const json = JSON.stringify(backup);
  const action = runInNewContext("(" + source.slice(start, end).trim() + ")", {
    store: db, win: null, assert: check, text, id, now,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ["isolated-backup.json"] }) },
    fs: { stat: async () => ({ size: Buffer.byteLength(json) }), readFile: async () => json },
  });
  return action();
}

test("画布持久化与作品、子页隔离，不触及内容时间戳、上下文和候选签名", (t) => {
  const env = setup(t), { db } = env, { book, layout } = sample(db);
  const other = db.createBook({ title: "另一本书" });
  const timestamp = book.updatedAt, signature = contextSignature(book, book.chapters[0]);
  const context = buildContext(book, book.chapters[0], "write");
  assert.equal(db.getCanvas(book.id, "world:setting"), null);
  assert.deepEqual(db.saveCanvas(book.id, "world:setting", layout), layout);
  assert.equal(db.getCanvas(book.id, "world:evolution"), null);
  assert.equal(db.getCanvas(other.id, "world:setting"), null);
  const after = db.book(book.id);
  assert.deepEqual(after, book);
  assert.equal(after.updatedAt, timestamp);
  assert.equal(contextSignature(after, after.chapters[0]), signature);
  assert.deepEqual(buildContext(after, after.chapters[0], "write"), context);
  assert.ok(!JSON.stringify(db.getCanvas(book.id, "world:setting")).includes("正文资料"));
  env.close(db);
  assert.deepEqual(env.open().getCanvas(book.id, "world:setting"), layout);
});

test("拒绝跨书引用、正文副本、无效数值、异常数量与标注字段，失败保留原布局", (t) => {
  const { db } = setup(t), { book, layout } = sample(db);
  const foreign = db.createBook({ title: "其他书" });
  db.saveCanvas(book.id, "characters", layout);
  const bad = (fn, expected) => { const value = structuredClone(layout); fn(value); assert.throws(() => db.saveCanvas(book.id, "characters", value), expected); assert.deepEqual(db.getCanvas(book.id, "characters"), layout); };
  bad((x) => { x.nodes["chapter:" + foreign.chapters[0].id] = { x: 0, y: 0 }; }, /不属于本书/);
  bad((x) => { x.annotations[0].target = "chapter:" + foreign.chapters[0].id; }, /不属于本书/);
  bad((x) => { x.body = "正文"; }, /副本/);
  bad((x) => { x.nodes["world:base"].description = "世界设定"; }, /只允许/);
  bad((x) => { x.nodes["world:base"].x = Infinity; }, /有限/);
  bad((x) => { x.nodes["world:base"].y = NaN; }, /有限/);
  bad((x) => { x.viewport.zoom = 0; }, /缩放/);
  bad((x) => { x.viewport.zoom = "1"; }, /缩放/);
  bad((x) => { x.annotations[0].direction = "execute"; }, /方向/);
  bad((x) => { x.annotations[0].label = "字".repeat(161); }, /160/);
  bad((x) => { x.annotations[0].note = "字".repeat(2001); }, /2000/);
  bad((x) => { x.annotations.push({ ...x.annotations[0] }); }, /重复/);
  bad((x) => { x.annotations = Array.from({ length: 5001 }, () => ({ ...x.annotations[0] })); }, /数量/);
  bad((x) => { x.nodes = Object.fromEntries(Array.from({ length: 25001 }, (_, i) => ["world:" + i, { x: 0, y: 0 }])); }, /数量/);
  assert.throws(() => db.saveCanvas(book.id, "world:unknown", layout), /视图/);
  assert.throws(() => db.getCanvas("no-book", "world"), /找不到/);
});

test("读取过滤已删除实体，作品软删除保留回收布局且禁止访问", (t) => {
  const { db } = setup(t), { book, layout } = sample(db);
  db.saveCanvas(book.id, "world", layout);
  db.updateBook(book.id, { worldRecords: [] });
  const filtered = db.getCanvas(book.id, "world");
  assert.equal(filtered.nodes["world:world-1"], undefined);
  assert.equal(filtered.annotations.length, 0);
  const entry = db.deleteBook(book.id);
  assert.throws(() => db.getCanvas(book.id, "world"), /恢复作品/);
  assert.throws(() => db.saveCanvas(book.id, "world", layout), /恢复作品/);
  assert.equal(db.backup().canvasViews.length, 1);
  db.restoreTrash(entry.id);
  assert.deepEqual(db.getCanvas(book.id, "world"), filtered);
});

test("旧 v1 无画布备份继续恢复，新备份独立导出并完整重映射全部实体引用", async (t) => {
  const { db } = setup(t), { book, layout } = sample(db);
  db.saveCanvas(book.id, "outline:volumes", layout);
  db.saveCanvas(book.id, "world:setting", layout);
  const backup = db.backup();
  assert.equal(backup.version, 1);
  assert.equal(backup.canvasViews.length, 2);
  assert.equal(backup.books[0].canvasViews, undefined);
  const old = structuredClone(backup); delete old.canvasViews;
  assert.equal(await restore(db, old), 1);
  const oldCopy = db.list().find((x) => x.id !== book.id);
  assert.equal(db.getCanvas(oldCopy.id, "world:setting"), null);
  const before = new Set(db.list().map((x) => x.id));
  assert.equal(await restore(db, backup), 1);
  const restored = db.book(db.list().find((x) => !before.has(x.id)).id);
  const target = db.getCanvas(restored.id, "world:setting");
  assert.equal(Object.keys(target.nodes).length, Object.keys(layout.nodes).length);
  const oldRefs = new Set(Object.keys(layout.nodes).filter((ref) => !["book:outline", "book:premise", "world:base"].includes(ref)));
  assert.ok(Object.keys(target.nodes).every((ref) => !oldRefs.has(ref)));
  assert.ok(Object.keys(target.nodes).every((ref) => canvasRefs(restored).has(ref)));
  assert.equal(target.annotations.length, 1);
  assert.notEqual(target.annotations[0].id, layout.annotations[0].id);
  assert.equal(target.annotations[0].source, "character:" + restored.characters[0].id);
  assert.equal(target.annotations[0].target, "world:" + restored.worldRecords[0].id);
  assert.equal(restored.chapters[0].volumeId, restored.volumes[0].id);
  assert.equal(restored.memories[0].sourceChapterId, restored.chapters[0].id);
  assert.equal(restored.timeline[0].chapterId, restored.chapters[0].id);
  assert.equal(restored.foreshadows[0].plantedChapterId, restored.chapters[0].id);
  assert.equal(restored.foreshadows[0].payoffChapterId, restored.chapters[0].id);
  assert.equal(restored.characters[0].knowledgeFromChapterId, restored.chapters[0].id);
  assert.equal(restored.characters[0].secretFromChapterId, restored.chapters[0].id);
  assert.deepEqual(target.viewport, layout.viewport);
  assert.deepEqual(db.getCanvas(book.id, "world:setting"), layout);
});

test("损坏的画布备份回滚整次恢复，跨书或缺失端点不会泄漏到副本", async (t) => {
  const { db } = setup(t), { book, layout } = sample(db);
  db.saveCanvas(book.id, "world", layout);
  const invalid = db.backup(); invalid.canvasViews[0].layout.viewport.zoom = -1;
  const before = db.list().map((x) => x.id);
  await assert.rejects(restore(db, invalid), /缩放/);
  assert.deepEqual(db.list().map((x) => x.id), before);
  const detached = db.backup();
  detached.canvasViews[0].layout.nodes["character:foreign"] = { x: 1, y: 2 };
  detached.canvasViews[0].layout.annotations.push({ id: "detached", source: "character:foreign", target: "world:base", label: "不可带入", direction: "none", dashed: false });
  await restore(db, detached);
  const copy = db.list().find((x) => x.id !== book.id), saved = db.getCanvas(copy.id, "world");
  assert.equal(saved.nodes["character:foreign"], undefined);
  assert.equal(saved.annotations.length, 1);
});

test("事实编辑保留 ID 与创建时间，更新同一内容源且不复制画布节点", (t) => {
  const { db } = setup(t), { book, layout } = sample(db), original = book.memories[0];
  db.saveCanvas(book.id, "memory:facts", layout);
  const beforeSignature = contextSignature(book, book.chapters[0]);
  const saved = db.updateMemory(book.id, { ...original, subject: "调查员林雾", createdAt: "伪造时间", sourceRevision: 999, stale: true });
  assert.equal(saved.memories.length, 1);
  assert.equal(saved.memories[0].id, original.id);
  assert.equal(saved.memories[0].createdAt, original.createdAt);
  assert.equal(saved.memories[0].subject, "调查员林雾");
  assert.equal(saved.memories[0].sourceRevision, saved.chapters[0].revision);
  assert.equal(saved.memories[0].stale, false);
  assert.notEqual(contextSignature(saved, saved.chapters[0]), beforeSignature);
  assert.deepEqual(db.getCanvas(book.id, "memory:facts"), layout);
  const unchanged = db.updateMemory(book.id, saved.memories[0]);
  assert.equal(unchanged.updatedAt, saved.updatedAt);
  const manual = db.updateMemory(book.id, { ...saved.memories[0], sourceChapterId: "", evidence: "" });
  assert.equal(manual.memories[0].id, original.id);
  assert.equal(manual.memories[0].sourceRevision, 0);
  assert.equal(manual.memories[0].stale, false);
});

test("事实编辑拒绝不存在与跨书 ID、无效来源和证据，失败不覆盖已有记忆", (t) => {
  const { db } = setup(t), { book } = sample(db), memory = book.memories[0];
  const foreign = db.createBook({ title: "其他作品" });
  const foreignChapter = db.updateChapter(foreign.chapters[0].id, { body: memory.evidence }, 1);
  db.finalize(foreignChapter.id, foreignChapter.revision);
  db.addMemory(foreign.id, { ...memory, sourceChapterId: foreignChapter.id });
  const wrongMemory = db.book(foreign.id).memories[0];
  const reject = (input, expected) => {
    assert.throws(() => db.updateMemory(book.id, input), expected);
    assert.deepEqual(db.book(book.id).memories, book.memories);
  };
  reject({ ...memory, id: "missing" }, /不存在或不属于本书/);
  reject({ ...memory, id: wrongMemory.id }, /不属于本书/);
  reject({ ...memory, sourceChapterId: foreignChapter.id }, /本书且已定稿/);
  reject({ ...memory, evidence: "原文中没有这句话" }, /原文/);
  reject({ ...memory, evidence: "" }, /原文/);
  reject({ ...memory, subject: "" }, /完整填写/);
  const draft = db.createChapter(book.id);
  reject({ ...memory, sourceChapterId: draft.id }, /已定稿/);
  assert.equal(db.book(foreign.id).memories[0].id, wrongMemory.id);
});

test("来源改稿后事实保持过期，重新定稿并核对证据才能清除；重复编辑不删除另一条", (t) => {
  const { db } = setup(t), { book } = sample(db), original = book.memories[0], chapter = book.chapters[0];
  const changed = db.updateChapter(chapter.id, { body: "林雾在旧钟楼找到地图。" }, chapter.revision);
  assert.equal(db.book(book.id).memories[0].stale, true);
  assert.throws(() => db.updateMemory(book.id, { ...original, object: "地图", evidence: changed.body }), /已定稿/);
  db.finalize(changed.id, changed.revision);
  assert.throws(() => db.updateMemory(book.id, original), /原文/);
  assert.equal(db.book(book.id).memories[0].stale, true);
  const checked = db.updateMemory(book.id, { ...original, object: "地图", evidence: changed.body });
  assert.equal(checked.memories[0].stale, false);
  assert.equal(checked.memories[0].sourceRevision, changed.revision);
  assert.equal(checked.memories[0].createdAt, original.createdAt);
  db.addMemory(book.id, { subject: "林雾", relation: "携带", object: "地图", sourceChapterId: changed.id, evidence: changed.body });
  const both = db.book(book.id).memories;
  assert.throws(() => db.updateMemory(book.id, { ...both[0], relation: "携带" }), /相同内容/);
  assert.deepEqual(db.book(book.id).memories, both);
  const deleted = db.deleteBook(book.id);
  assert.throws(() => db.updateMemory(book.id, both[0]), /恢复作品/);
  db.restoreTrash(deleted.id);
  db.deleteChapter(changed.id);
  assert.throws(() => db.updateMemory(book.id, both[0]), /已定稿/);
});
