const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { Store } = require("../electron/store.cjs");
const { parseSkill, exportSkill } = require("../electron/extensions.cjs");
const { buildContext } = require("../electron/context.cjs");
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "xm-v02-"));
  const db = new Store(join(dir, "test.sqlite"));
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return db;
}
test("旧配置迁移、多模型切换与密钥隔离", (t) => {
  const db = setup(t);
  db.putSetting("model", { model: "old", encryptedKey: "encrypted-old" });
  assert.equal(db.config().model, "old");
  db.setConfig({
    profileId: "second",
    name: "另一模型",
    model: "second",
    encryptedKey: "encrypted-second",
  });
  assert.equal(db.config().encryptedKey, "encrypted-second");
  db.selectProfile("default");
  assert.equal(db.config().encryptedKey, "encrypted-old");
  db.deleteProfile("default");
  assert.equal(db.config().profileId, "second");
  assert.throws(() => db.deleteProfile("second"), /至少/);
  assert.equal(JSON.stringify(db.backup()).includes("encrypted-second"), false);
});
test("Skill 导入默认关闭、版本更新、任务隔离与完整长指令", (t) => {
  const db = setup(t),
    b = db.createBook({ title: "测试" });
  const imported = parseSkill(
    "---\nname: 节奏\ndescription: 调整句子\ntasks: [write]\n---\n短句推进。",
  );
  const s = db.saveSkill(imported);
  assert.equal(s.enabled, false);
  assert.equal(
    buildContext(b, b.chapters[0], "write", "", db.skills()).skills.length,
    0,
  );
  db.saveSkill({ ...s, enabled: true });
  const ctx = buildContext(b, b.chapters[0], "write", "", db.skills());
  assert.equal(ctx.skills[0].version, 2);
  assert.match(ctx.messages[0].content, /短句推进/);
  assert.equal(
    buildContext(b, b.chapters[0], "outline", "", db.skills()).skills.length,
    0,
  );
  assert.equal(parseSkill(exportSkill(s)).name, "节奏");
  assert.throws(() => db.saveSkill({ ...s, tasks: [] }), /至少/);
  db.saveSkill({
    name: "长指令",
    body: "字".repeat(80000),
    tasks: ["write"],
    enabled: true,
  });
  const full = buildContext(b, b.chapters[0], "write", "", db.skills());
  assert.ok(full.messages[0].content.includes("字".repeat(80000)));
  assert.equal(parseSkill(exportSkill(db.skills().find((skill) => skill.name === "长指令"))).body.length, 80000);
});
test("删除章节保留历史并使记忆过期，恢复仍需核对；删除书籍阻止旧候选采用", (t) => {
  const db = setup(t),
    b = db.createBook({ title: "回收测试" });
  let c = db.updateChapter(b.chapters[0].id, { body: "甲把钥匙交给乙。" }, 1);
  c = db.finalize(c.id, c.revision);
  db.addMemory(b.id, {
    subject: "甲",
    relation: "交给",
    object: "乙",
    evidence: "甲把钥匙交给乙。",
    sourceChapterId: c.id,
  });
  const copy = db.duplicateChapter(c.id);
  assert.equal(copy.status, "draft");
  const e = db.deleteChapter(c.id);
  assert.equal(db.book(b.id).chapters.length, 1);
  assert.ok(db.book(b.id).memories[0].stale);
  assert.throws(
    () => db.updateChapter(c.id, { body: "覆盖" }, c.revision),
    /回收站/,
  );
  assert.ok(db.versions(c.id).length);
  db.restoreTrash(e.id);
  assert.equal(db.book(b.id).chapters.length, 2);
  assert.ok(db.book(b.id).memories[0].stale);
  const deleted = db.deleteBook(b.id);
  assert.equal(db.list().length, 0);
  assert.equal(db.backup().books.length, 1);
  assert.throws(() => db.createChapter(b.id), /恢复作品/);
  db.restoreTrash(deleted.id);
  assert.equal(db.list().length, 1);
});
test("人物、记忆、参考资料删除恢复与覆盖保护", (t) => {
  const db = setup(t),
    b = db.createBook({ title: "资料测试" });
  db.updateBook(b.id, {
    characters: [{ id: "c", name: "甲", role: "主角", description: "人物" }],
    reference: "原文",
    referenceName: "参考",
  });
  db.deleteCharacter(b.id, "c");
  db.restoreTrash(db.trash()[0].id);
  assert.equal(db.book(b.id).characters[0].name, "甲");
  db.clearReference(b.id);
  const entry = db.trash()[0];
  db.updateBook(b.id, { reference: "新的参考" });
  assert.throws(() => db.restoreTrash(entry.id), /已有参考/);
  db.clearReference(b.id);
  db.restoreTrash(entry.id);
  assert.equal(db.book(b.id).reference, "原文");
  db.addMemory(b.id, {
    subject: "甲",
    relation: "认识",
    object: "乙",
    evidence: "",
    sourceChapterId: "",
  });
  db.deleteMemory(b.id, db.book(b.id).memories[0].id);
  db.restoreTrash(db.trash()[0].id);
  assert.equal(db.book(b.id).memories.length, 1);
});
