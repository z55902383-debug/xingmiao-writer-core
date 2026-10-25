const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { runInNewContext } = require("node:vm");
const { Store, assert: check, text, id, now } = require("../electron/store.cjs");
const atlas = require("../electron/atlas.cjs");
const { buildContext } = require("../electron/context.cjs");
const { contextSignature } = require("../electron/timeline.cjs");
const sync = require("../electron/sync-review.cjs");
const {
  createKnowledgeChat,
  checkedProposal,
  buildPrompt,
} = require("../electron/knowledge-chat.cjs");

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "xm-atlas-")),
    db = new Store(join(dir, "test.sqlite"));
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const book = db.createBook({ title: "蓝图测试" });
  db.updateBook(book.id, {
    characters: [
      { id: "p1", name: "顾舟", role: "主角", description: "调查员" },
      { id: "p2", name: "林晚", role: "配角", description: "信使" },
    ],
  });
  return { db, bookId: book.id };
}
function final(db, chapter, body) {
  const c = db.updateChapter(chapter.id, { body }, chapter.revision);
  return db.finalize(c.id, c.revision);
}
const mapRow = (patch = {}) => ({
  id: "m1",
  name: "雾港",
  kind: "world",
  parentMapId: "",
  description: "",
  theme: "ink",
  status: "fixed",
  chapterId: "",
  order: 0,
  ...patch,
});
const nodeRow = (patch = {}) => ({
  id: "n1",
  mapId: "m1",
  parentId: "",
  kind: "landmark",
  name: "旧钟楼",
  description: "",
  x: 300,
  y: 400,
  status: "fixed",
  chapterId: "",
  ...patch,
});
const itemRow = (patch = {}) => ({
  id: "i1",
  name: "铜钥匙",
  description: "",
  nodeId: "n1",
  ownerCharacterId: "",
  status: "fixed",
  chapterId: "",
  ...patch,
});
const positionRow = (patch = {}) => ({
  id: "pos1",
  characterId: "p1",
  nodeId: "n1",
  chapterId: "",
  status: "present",
  note: "",
  ...patch,
});
const payload = (ctx) =>
  JSON.parse(ctx.messages[1].content.split("以下 JSON 为资料数据：\n")[1]);

test("新书初始化空数组，旧书缺少蓝图字段仍可读、保存、生成、对话和备份", (t) => {
  const { db, bookId } = setup(t);
  let book = db.book(bookId);
  for (const key of atlas.ATLAS_FIELDS) assert.deepEqual(book[key], []);
  // 模拟升级前保存的旧作品：books 表里完全没有 atlas 字段。
  const raw = db.rawBook(bookId);
  for (const key of atlas.ATLAS_FIELDS) delete raw[key];
  db.putBook(raw);
  book = db.book(bookId);
  for (const key of atlas.ATLAS_FIELDS) assert.deepEqual(book[key], []);
  const chapter = book.chapters[0];
  const finalized = final(db, chapter, "顾舟来到雾港。");
  const oldBook = db.book(bookId);
  const write = buildContext(oldBook, oldBook.chapters[0], "write");
  assert.equal(write.atlasCount, 0);
  assert.doesNotMatch(JSON.stringify(write.messages), /atlas/i);
  const memory = buildContext(oldBook, oldBook.chapters[0], "memory");
  assert.equal(memory.atlasCount, 0);
  assert.ok(!Object.hasOwn(payload(memory), "atlas"));
  const before = contextSignature(oldBook, oldBook.chapters[0]);
  const saved = db.saveAtlas(bookId, { maps: [mapRow()], nodes: [nodeRow()] });
  assert.equal(saved.atlasMaps.length, 1);
  assert.equal(saved.atlasNodes.length, 1);
  assert.notEqual(
    contextSignature(saved, saved.chapters[0]),
    before,
  );
  const backup = db.backup();
  assert.ok(Array.isArray(backup.books[0].atlasMaps));
  assert.equal(backup.books[0].atlasMaps[0].name, "雾港");
  assert.equal(db.chapter(finalized.id).status, "final");
  // 旧作品的资料对话与方案校验同样兼容缺失字段。
  const prompt = JSON.stringify(buildPrompt(oldBook, [], "新增一张地图"));
  assert.match(prompt, /atlasMaps/);
  const proposal = checkedProposal(
    JSON.stringify({
      reply: "新增地图",
      changes: [
        { target: "atlasMap", id: "", operation: "create", fields: { name: "旧书地图", kind: "world", status: "fixed" } },
      ],
    }),
    oldBook,
  );
  assert.equal(proposal.changes.length, 1);
  assert.equal(proposal.changes[0].after.name, "旧书地图");
});

test("类型、长度、坐标、去重与上限按中文错误拒绝或修复", (t) => {
  const { db, bookId } = setup(t);
  const reject = (patch, expected) => {
    assert.throws(() => db.saveAtlas(bookId, patch), expected);
    const book = db.book(bookId);
    for (const key of atlas.ATLAS_FIELDS) assert.deepEqual(book[key], []);
  };
  reject({}, /知识蓝图数据/);
  reject({ maps: "bad" }, /数组/);
  reject({ maps: [mapRow({ kind: "city" })] }, /地图类型/);
  reject({ maps: [mapRow({ name: " " })] }, /地图名称/);
  reject({ maps: [mapRow(), mapRow()] }, /编号重复/);
  reject({ maps: Array.from({ length: 201 }, (_, i) => mapRow({ id: "m" + i, name: "地图" + i })) }, /上限/);
  reject({ maps: [mapRow()], nodes: [nodeRow({ x: "左" })] }, /坐标/);
  reject({ maps: [mapRow()], nodes: [nodeRow({ x: 10, y: undefined })] }, /坐标/);
  reject({ maps: [mapRow()], nodes: [nodeRow({ mapId: "missing" })] }, /地图不存在/);
  reject({ maps: [mapRow(), mapRow({ id: "m2", name: "内城", parentMapId: "missing" })] }, /上级地图/);
  const cyclic = db.saveAtlas(bookId, {
    maps: [mapRow(), mapRow({ id: "m2", name: "内城", parentMapId: "m1" })],
  });
  assert.equal(cyclic.atlasMaps[1].parentMapId, "m1");
  const clamp = db.saveAtlas(bookId, {
    nodes: [nodeRow({ x: 1200, y: -8 })],
  });
  assert.equal(clamp.atlasNodes[0].x, 1000);
  assert.equal(clamp.atlasNodes[0].y, 0);
  const auto = db.saveAtlas(bookId, {
    nodes: [nodeRow({ id: "n2", name: "码头", x: undefined, y: undefined })],
  });
  const placed = auto.atlasNodes.find((row) => row.id === "n2");
  assert.ok(placed.x >= 0 && placed.x <= 1000 && placed.y >= 0 && placed.y <= 1000);
  const edge = db.saveAtlas(bookId, {
    nodes: [nodeRow(), nodeRow({ id: "n2", name: "码头", x: 500, y: 500 })],
    edges: [
      { id: "e1", mapId: "m1", source: "n1", target: "n2", kind: "route", label: "", status: "fixed", chapterId: "" },
      { id: "e2", mapId: "m1", source: "n1", target: "n2", kind: "route", label: "重复", status: "fixed", chapterId: "" },
    ],
  });
  assert.equal(edge.atlasEdges.length, 1);
  assert.throws(
    () =>
      db.saveAtlas(bookId, {
        edges: [{ id: "e3", mapId: "m1", source: "n1", target: "gone", kind: "route", label: "", status: "fixed", chapterId: "" }],
      }),
    /端点/,
  );
  assert.throws(
    () =>
      db.saveAtlas(bookId, {
        edges: [{ id: "e3", mapId: "m1", source: "n1", target: "n1", kind: "route", label: "", status: "fixed", chapterId: "" }],
      }),
    /同一个节点/,
  );
  assert.throws(
    () => db.saveAtlas(bookId, { items: [itemRow({ ownerCharacterId: "ghost" })] }),
    /保管人/,
  );
  assert.throws(
    () => db.saveAtlas(bookId, { positions: [positionRow({ characterId: "ghost" })] }),
    /人物不存在/,
  );
  // updateBook 与 saveAtlas 共用同一套规范化；失败时不写入半成品。
  const sizeBefore = db.book(bookId).atlasMaps.length;
  assert.throws(
    () => db.updateBook(bookId, { atlasMaps: [{ id: "bad" }] }),
    /地图名称/,
  );
  assert.equal(db.book(bookId).atlasMaps.length, sizeBefore);
});

test("删除地图级联清理节点、连线、物品定位与人物位置，不留悬空引用", (t) => {
  const { db, bookId } = setup(t);
  db.saveAtlas(bookId, {
    maps: [mapRow()],
    nodes: [nodeRow(), nodeRow({ id: "n2", name: "码头", x: 500, y: 500 })],
    edges: [{ id: "e1", mapId: "m1", source: "n1", target: "n2", kind: "route", label: "", status: "fixed", chapterId: "" }],
    items: [itemRow()],
    positions: [positionRow()],
  });
  let book = db.book(bookId);
  assert.equal(book.atlasPositions.length, 1);
  book = db.saveAtlas(bookId, { maps: [] });
  assert.deepEqual(book.atlasMaps, []);
  assert.deepEqual(book.atlasNodes, []);
  assert.deepEqual(book.atlasEdges, []);
  assert.equal(book.atlasItems.length, 1);
  assert.equal(book.atlasItems[0].nodeId, "");
  assert.deepEqual(book.atlasPositions, []);
});

test("章节修改/删除把 order>=当前章 order 的蓝图记录标 stale，生成时排除并警告", (t) => {
  const { db, bookId } = setup(t);
  let book = db.book(bookId);
  const c1 = final(db, book.chapters[0], "第一章正文。");
  const c2 = final(db, db.createChapter(bookId), "第二章正文。");
  book = db.book(bookId);
  const second = book.chapters.find((row) => row.id === c2.id);
  db.saveAtlas(bookId, {
    maps: [mapRow({ chapterId: c2.id })],
    nodes: [nodeRow({ chapterId: c2.id })],
    items: [itemRow({ chapterId: c2.id })],
    positions: [positionRow({ chapterId: c2.id })],
  });
  let state = db.book(bookId);
  assert.ok(state.atlasMaps.every((row) => !row.stale));
  const beforeEdit = buildContext(state, second, "write");
  assert.ok(beforeEdit.atlasCount > 0);
  // 修改更早的章节：来源章节 order 相同的记录全部过期。
  db.updateChapter(c1.id, { body: "第一章正文改过。" }, db.chapter(c1.id).revision);
  state = db.book(bookId);
  for (const key of ["atlasMaps", "atlasNodes", "atlasItems", "atlasPositions"])
    assert.ok(state[key].length && state[key].every((row) => row.stale), key);
  const ctx = buildContext(state, second, "write");
  assert.equal(ctx.atlasCount, 0);
  assert.ok(ctx.warnings.some((w) => /知识蓝图中有 \d+ 条记录来源已变化/.test(w)));
  // 删除来源章节同样让记录过期。
  const c3 = final(db, db.createChapter(bookId), "第三章正文。");
  db.saveAtlas(bookId, { nodes: [nodeRow({ id: "n3", name: "灯塔", x: 600, y: 600, chapterId: c3.id })] });
  db.deleteChapter(c3.id);
  const afterDelete = db.book(bookId).atlasNodes.find((row) => row.id === "n3");
  assert.equal(afterDelete.stale, true);
});

test("生成上下文只含截至本章有效资料，planned 单列，位置与物品归属可读", (t) => {
  const { db, bookId } = setup(t);
  let book = db.book(bookId);
  const c1 = final(db, book.chapters[0], "顾舟来到雾港。");
  const c2 = final(db, db.createChapter(bookId), "旧钟楼出现。");
  book = db.book(bookId);
  db.saveAtlas(bookId, {
    maps: [mapRow()],
    nodes: [
      nodeRow({ chapterId: c1.id }),
      nodeRow({ id: "n2", name: "码头", x: 500, y: 500, status: "planned", chapterId: c1.id }),
      nodeRow({ id: "n3", name: "第二章地点", x: 700, y: 700, chapterId: c2.id }),
    ],
    items: [itemRow({ ownerCharacterId: "p2", chapterId: c1.id })],
    positions: [positionRow({ chapterId: c1.id }), positionRow({ id: "pos2", characterId: "p2", nodeId: "n1", chapterId: c1.id, status: "planned" })],
  });
  const state = atlas.context(db.book(bookId), c1);
  assert.deepEqual(state.nodes.map((row) => row.name).sort(), ["旧钟楼"]);
  assert.deepEqual(state.planned.nodes.map((row) => row.name), ["码头"]);
  assert.equal(state.positions.length, 1);
  assert.equal(state.planned.positions.length, 1);
  assert.equal(state.staleCount, 0);
  // 第二章的节点要到第二章才可见。
  const later = atlas.context(db.book(bookId), c2);
  assert.ok(later.nodes.some((row) => row.name === "第二章地点"));
  const write = buildContext(db.book(bookId), c1, "write");
  assert.ok(write.atlasCount > 0);
  assert.ok(write.warnings.some((w) => w.includes("尚未发生")));
  const data = payload(write);
  assert.equal(data.atlas.nodes[0].name, "旧钟楼");
  assert.equal(data.atlas.planned.nodes[0].name, "码头");
  assert.equal(data.atlas.positions[0].character, "顾舟");
  assert.equal(data.atlas.positions[0].node, "旧钟楼");
  assert.equal(data.atlas.items[0].owner, "林晚");
  assert.equal(data.atlas.items[0].node, "旧钟楼");
  // 计划可以来自尚未定稿的章节计划：进入 planned，不算 stale，也不当成已发生事实。
  const draft = db.createChapter(bookId);
  db.saveAtlas(bookId, {
    nodes: [
      ...db.book(bookId).atlasNodes,
      nodeRow({ id: "plan", name: "计划营地", x: 800, y: 800, status: "planned", chapterId: draft.id }),
    ],
  });
  const draftBook = db.book(bookId);
  const draftState = atlas.context(
    draftBook,
    draftBook.chapters.find((row) => row.id === draft.id),
  );
  assert.ok(draftState.planned.nodes.some((row) => row.name === "计划营地"));
  assert.equal(draftState.staleCount, 0);
  // 界面默认把新记录标在当前「截至章节」；未定稿章节来源可以保存，但生成时按未定稿排除。
  db.saveAtlas(bookId, {
    nodes: [
      ...db.book(bookId).atlasNodes,
      nodeRow({ id: "ui-draft", name: "未定稿地点", x: 900, y: 900, status: "fixed", chapterId: draft.id }),
    ],
  });
  const mixedBook = db.book(bookId);
  const mixed = atlas.context(
    mixedBook,
    mixedBook.chapters.find((row) => row.id === draft.id),
  );
  assert.ok(!mixed.nodes.some((row) => row.name === "未定稿地点"));
  assert.ok(mixed.staleCount >= 1);
  const firstCtx = buildContext(mixedBook, mixedBook.chapters[0], "write");
  assert.ok(!JSON.stringify(firstCtx.messages).includes("未定稿地点"));
  // 抽取记忆只给正文，不携带蓝图资料。
  const memory = buildContext(db.book(bookId), db.book(bookId).chapters[0], "memory");
  assert.ok(!Object.hasOwn(payload(memory), "atlas"));
  assert.equal(memory.atlasCount, 0);
});

test("变化分析消息只提供截至本章有效的蓝图资料，不泄露未来地点", (t) => {
  const { db, bookId } = setup(t);
  let book = db.book(bookId);
  const c1 = final(db, book.chapters[0], "顾舟来到雾港。");
  const c2 = final(db, db.createChapter(bookId), "旧钟楼。");
  book = db.book(bookId);
  db.saveAtlas(bookId, {
    maps: [mapRow({ chapterId: c1.id })],
    nodes: [nodeRow({ chapterId: c1.id }), nodeRow({ id: "future", name: "未来地点标记", x: 500, y: 500, chapterId: c2.id })],
    positions: [positionRow({ chapterId: c1.id })],
  });
  const fresh = db.book(bookId);
  const c2row = fresh.chapters.find((row) => row.id === c2.id);
  const text = JSON.stringify(sync.messages(fresh, c2row, c2row.body));
  assert.match(text, /旧钟楼/);
  assert.match(text, /顾舟/);
  assert.doesNotMatch(text, /未来地点标记/);
});

test("同步变化提取地点/位置/物品并以同一事务写入，失败整体回滚", (t) => {
  const { db, bookId } = setup(t);
  const body = "顾舟来到雾港。林晚在旧钟楼把铜钥匙交给顾舟。";
  const c = db.updateChapter(db.book(bookId).chapters[0].id, { body }, 1);
  let book = db.book(bookId);
  const rows = sync.parse(
    JSON.stringify({
      changes: [
        { kind: "place", subject: "雾港", value: "港口城市", evidence: "顾舟来到雾港。" },
        { kind: "place", subject: "旧钟楼", value: "停摆的钟楼", evidence: "林晚在旧钟楼" },
        { kind: "position", subject: "林晚", value: "旧钟楼", evidence: "林晚在旧钟楼" },
        { kind: "item", subject: "铜钥匙", target: "顾舟", value: "旧钟楼", evidence: "把铜钥匙交给顾舟" },
      ],
    }),
    c.body,
  );
  assert.equal(rows.length, 4);
  const job = {
    id: "j",
    bookId,
    chapterId: c.id,
    kind: "write",
    output: c.body,
    status: "done",
    adopted: true,
    review: {
      status: "ready",
      bodyHash: sync.hash(c.body),
      revision: c.revision,
      signature: contextSignature(book, c),
      changes: rows,
    },
  };
  db.putJob(job);
  const result = sync.apply(db, "j", rows);
  assert.equal(result.chapters[0].status, "final");
  assert.equal(result.atlasMaps.length, 1);
  assert.equal(result.atlasMaps[0].name, "世界地图");
  assert.equal(result.atlasMaps[0].chapterId, c.id);
  assert.equal(result.atlasNodes.length, 2);
  const tower = result.atlasNodes.find((row) => row.name === "旧钟楼");
  assert.equal(tower.status, "fixed");
  assert.equal(tower.chapterId, c.id);
  assert.ok(tower.x >= 0 && tower.x <= 1000 && tower.y >= 0 && tower.y <= 1000);
  assert.equal(tower.evidence, "林晚在旧钟楼");
  assert.equal(result.atlasPositions.length, 1);
  assert.equal(result.atlasPositions[0].characterId, "p2");
  assert.equal(result.atlasPositions[0].nodeId, tower.id);
  assert.equal(result.atlasPositions[0].chapterId, c.id);
  assert.equal(result.atlasPositions[0].status, "present");
  assert.equal(result.atlasItems.length, 1);
  assert.equal(result.atlasItems[0].ownerCharacterId, "p1");
  assert.equal(result.atlasItems[0].nodeId, tower.id);
  assert.match(result.atlasItems[0].evidence, /铜钥匙/);

  // 位置指向未记录的地点时，整个同步回滚：正文保持草稿，蓝图不变。
  const c2 = db.updateChapter(db.createChapter(bookId).id, { body: "顾舟去了无名谷。" }, 1);
  book = db.book(bookId);
  const badRows = sync.parse(
    JSON.stringify({
      changes: [
        { kind: "place", subject: "临时营地", value: "临时营地", evidence: "顾舟去了无名谷。" },
        { kind: "position", subject: "顾舟", value: "无名谷", evidence: "顾舟去了无名谷。" },
      ],
    }),
    c2.body,
  );
  db.putJob({
    id: "j2",
    bookId,
    chapterId: c2.id,
    kind: "write",
    output: c2.body,
    status: "done",
    adopted: true,
    review: {
      status: "ready",
      bodyHash: sync.hash(c2.body),
      revision: c2.revision,
      signature: contextSignature(book, c2),
      changes: badRows,
    },
  });
  assert.throws(() => sync.apply(db, "j2", badRows), /地点尚未记录/);
  assert.equal(db.chapter(c2.id).status, "draft");
  const after = db.book(bookId);
  assert.ok(!after.atlasNodes.some((row) => row.name === "临时营地"));
  assert.equal(after.atlasPositions.length, 1);
  // 伪造证据依然不能进入清单。
  assert.throws(
    () => sync.parse(JSON.stringify({ changes: [{ kind: "place", subject: "假地点", value: "x", evidence: "伪造" }] }), c2.body),
    /证据/,
  );
  assert.throws(
    () => sync.parse(JSON.stringify({ changes: [{ kind: "unknown", subject: "x", value: "y", evidence: "顾舟去了无名谷。" }] }), c2.body),
    /类型/,
  );
});

function manager(store, reply, options = {}) {
  let resolve;
  const done = new Promise((r) => (resolve = r));
  const calls = [];
  const service = createKnowledgeChat({
    getStore: () => store,
    getConfig: () => ({ model: "fixture", provider: options.provider || "api" }),
    getKey: async () => "",
    requestModel: async (...args) => {
      calls.push(args[2]);
      args[3](JSON.stringify(reply));
      return { finishReason: "stop" };
    },
    requestCodex: async (...args) => {
      calls.push(args[2]);
      args[3](JSON.stringify(reply));
      return {};
    },
    emit: (value) => {
      if (value.messages.at(-1)?.status !== "running") resolve(value);
    },
  });
  return { service, done, calls };
}

test("资料对话新增地图与节点自动落位，修改章节来源记录转为作者设定，删除与撤销往返", async (t) => {
  const { db, bookId } = setup(t);
  let book = db.book(bookId);
  const c1 = final(db, book.chapters[0], "顾舟在雾港。");
  book = db.book(bookId);
  db.saveAtlas(bookId, { maps: [mapRow({ chapterId: c1.id })] });
  const existingMap = db.book(bookId).atlasMaps[0];
  const first = manager(db, {
    reply: "新增地点",
    changes: [
      { target: "atlasMap", id: "", operation: "create", fields: { name: "雾港内城", kind: "region", theme: "ink", status: "fixed" } },
      { target: "atlasNode", id: "", operation: "create", fields: { kind: "landmark", name: "钟楼", description: "停摆", status: "fixed" } },
    ],
  });
  first.service.start({ bookId, message: "在地图上加钟楼" });
  const created = (await first.done).messages.at(-1).proposal;
  const applied = first.service.apply({
    bookId,
    proposalId: created.id,
    changeIds: created.changes.map((row) => row.key),
  });
  const node = applied.book.atlasNodes.find((row) => row.name === "钟楼");
  assert.ok(node);
  assert.equal(node.mapId, applied.book.atlasMaps.find((row) => row.name === "雾港内城").id);
  assert.ok(node.x >= 0 && node.x <= 1000 && node.y >= 0 && node.y <= 1000);
  first.service.undo({ bookId, proposalId: created.id });
  assert.equal(db.book(bookId).atlasNodes.length, 0);

  // 修改章节来源的记录：转为作者设定，不再伪造正文来源。
  db.saveAtlas(bookId, {
    nodes: [nodeRow({ mapId: existingMap.id, chapterId: c1.id, evidence: "顾舟在雾港。" })],
  });
  const sourced = db.book(bookId).atlasNodes[0];
  const second = manager(db, {
    reply: "补充描述",
    changes: [
      { target: "atlasNode", id: sourced.id, operation: "update", fields: { description: "作者补充的钟楼描述" } },
    ],
  });
  second.service.start({ bookId, message: "补充钟楼描述" });
  const updated = (await second.done).messages.at(-1).proposal;
  const saved = second.service.apply({
    bookId,
    proposalId: updated.id,
    changeIds: updated.changes.map((row) => row.key),
  });
  const adjusted = saved.book.atlasNodes[0];
  assert.equal(adjusted.description, "作者补充的钟楼描述");
  assert.equal(adjusted.chapterId, "");
  assert.equal(adjusted.evidence, "");
  assert.equal(adjusted.stale, false);

  // 删除记录进回收站，撤销后恢复且清掉回收项。
  const third = manager(db, {
    reply: "删除节点",
    changes: [{ target: "atlasNode", id: adjusted.id, operation: "delete", fields: {} }],
  });
  third.service.start({ bookId, message: "删除钟楼" });
  const deletion = (await third.done).messages.at(-1).proposal;
  third.service.apply({
    bookId,
    proposalId: deletion.id,
    changeIds: deletion.changes.map((row) => row.key),
  });
  assert.equal(db.book(bookId).atlasNodes.length, 0);
  const trashEntry = db.trash().find((row) => row.type === "atlasNode");
  assert.equal(trashEntry.title, "旧钟楼");
  third.service.undo({ bookId, proposalId: deletion.id });
  assert.equal(db.book(bookId).atlasNodes[0].id, adjusted.id);
  assert.ok(!db.trash().some((row) => row.id === trashEntry.id));
});

test("资料对话校验蓝图引用，删除地图级联清理节点与连线", async (t) => {
  const { db, bookId } = setup(t);
  const book = db.book(bookId);
  const reject = (change, expected) =>
    assert.throws(
      () => checkedProposal(JSON.stringify({ reply: "x", changes: [change] }), book),
      expected,
    );
  reject(
    { target: "atlasNode", id: "", operation: "create", fields: { name: "坏点", mapId: "missing", kind: "landmark", status: "fixed" } },
    /地图不存在/,
  );
  reject(
    { target: "atlasEdge", id: "", operation: "create", fields: { mapId: "missing", source: "a", target: "b", kind: "link", status: "fixed" } },
    /地图不存在|端点/,
  );
  reject(
    { target: "atlasPosition", id: "", operation: "create", fields: { characterId: "ghost", nodeId: "gone", status: "present" } },
    /地图不存在|地点不存在|人物不存在/,
  );
  reject(
    { target: "atlasItem", id: "", operation: "create", fields: { name: "坏物品", nodeId: "gone", ownerCharacterId: "ghost", status: "fixed" } },
    /节点不存在|保管人/,
  );
  reject(
    { target: "atlasMap", id: "", operation: "create", fields: { chapters: [] } },
    /不允许修改的字段/,
  );
  reject(
    { target: "atlasNode", id: "", operation: "create", fields: { name: "坏坐标", x: 1, y: 2 } },
    /不允许修改的字段/,
  );
  // 删除地图：节点、连线随级联清理，不留下悬空引用。
  db.saveAtlas(bookId, {
    maps: [mapRow()],
    nodes: [nodeRow(), nodeRow({ id: "n2", name: "码头", x: 500, y: 500 })],
    edges: [{ id: "e1", mapId: "m1", source: "n1", target: "n2", kind: "route", label: "", status: "fixed", chapterId: "" }],
  });
  const instance = manager(db, {
    reply: "删除地图",
    changes: [{ target: "atlasMap", id: "m1", operation: "delete", fields: {} }],
  });
  instance.service.start({ bookId, message: "删除地图" });
  const proposal = (await instance.done).messages.at(-1).proposal;
  const result = instance.service.apply({
    bookId,
    proposalId: proposal.id,
    changeIds: proposal.changes.map((row) => row.key),
  });
  assert.deepEqual(result.book.atlasNodes, []);
  assert.deepEqual(result.book.atlasEdges, []);
  instance.service.undo({ bookId, proposalId: proposal.id });
  assert.equal(db.book(bookId).atlasNodes.length, 2);
  assert.equal(db.book(bookId).atlasEdges.length, 1);
});

const restore = async (db, backup) => {
  const source = readFileSync(join(__dirname, "../electron/main.cjs"), "utf8");
  const start = source.indexOf("async function restoreBackup()"),
    end = source.indexOf("const actions =", start);
  assert.ok(start >= 0 && end > start);
  const json = JSON.stringify(backup);
  const action = runInNewContext("(" + source.slice(start, end).trim() + ")", {
    require: require("node:module").createRequire(require("node:path").resolve("electron/main.cjs")),
    store: db,
    win: null,
    assert: check,
    text,
    id,
    now,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ["isolated-backup.json"] }) },
    fs: { stat: async () => ({ size: Buffer.byteLength(json) }), readFile: async () => json },
  });
  return action();
};

test("备份恢复重映射蓝图全部 id 引用，断引用清空或标 stale", (t) => {
  const source = {
    atlasMaps: [
      { id: "m", name: "雾港", kind: "world", parentMapId: "", status: "fixed", chapterId: "c", theme: "ink", order: 0 },
      { id: "m2", name: "内城", kind: "region", parentMapId: "m", status: "provisional", chapterId: "gone", order: 1 },
    ],
    atlasNodes: [
      { id: "n", mapId: "m", parentId: "", kind: "landmark", name: "钟楼", x: 10, y: 20, status: "fixed", chapterId: "c" },
      { id: "n2", mapId: "m", parentId: "", kind: "landmark", name: "码头", x: 500, y: 500, status: "fixed", chapterId: "c" },
      { id: "detached", mapId: "missing", kind: "landmark", name: "断地图", x: 1, y: 1 },
    ],
    atlasEdges: [
      { id: "e", mapId: "m", source: "n", target: "n2", kind: "route", status: "fixed", chapterId: "c" },
      { id: "e2", mapId: "m", source: "n", target: "n2", kind: "route", status: "fixed", chapterId: "" },
    ],
    atlasItems: [{ id: "i", name: "钥匙", nodeId: "n", ownerCharacterId: "p", status: "fixed", chapterId: "c" }],
    atlasPositions: [
      { id: "pos", characterId: "p", nodeId: "n", chapterId: "c", status: "present" },
      { id: "ghost", characterId: "gone", nodeId: "n", chapterId: "" },
    ],
  };
  const restored = atlas.restoreAtlas(source, {
    chapterMap: new Map([["c", "new-c"]]),
    characterMap: new Map([["p", "new-p"]]),
  });
  assert.equal(restored.atlasMaps.length, 2);
  const [port, inner] = restored.atlasMaps;
  assert.notEqual(port.id, "m");
  assert.equal(inner.parentMapId, port.id);
  assert.equal(inner.stale, true);
  const tower = restored.atlasNodes.find((row) => row.name === "钟楼");
  assert.equal(tower.mapId, port.id);
  assert.equal(restored.atlasNodes.length, 2);
  assert.equal(restored.atlasEdges.length, 1);
  assert.equal(restored.atlasEdges[0].source, tower.id);
  assert.equal(restored.atlasItems[0].nodeId, tower.id);
  assert.equal(restored.atlasItems[0].ownerCharacterId, "new-p");
  assert.equal(restored.atlasPositions.length, 1);
  assert.equal(restored.atlasPositions[0].characterId, "new-p");
  assert.equal(restored.atlasPositions[0].chapterId, "new-c");
  assert.deepEqual(atlas.restoreAtlas({}, {}), {
    atlasMaps: [],
    atlasNodes: [],
    atlasEdges: [],
    atlasItems: [],
    atlasPositions: [],
  });
});

test("备份恢复端到端重映射蓝图，旧备份无字段兼容，损坏备份整体回滚", async (t) => {
  const { db, bookId } = setup(t);
  let book = db.book(bookId);
  const c = final(db, book.chapters[0], "顾舟在雾港。");
  book = db.book(bookId);
  db.saveAtlas(bookId, {
    maps: [mapRow({ chapterId: c.id })],
    nodes: [nodeRow({ chapterId: c.id })],
    items: [itemRow({ ownerCharacterId: "p2", chapterId: c.id })],
    positions: [positionRow({ chapterId: c.id })],
  });
  const backup = db.backup();
  assert.equal(backup.books[0].atlasNodes.length, 1);
  assert.equal(await restore(db, backup), 1);
  const copyId = db.list().find((row) => row.id !== bookId).id;
  const copy = db.book(copyId);
  assert.equal(copy.atlasMaps.length, 1);
  assert.notEqual(copy.atlasMaps[0].id, "m1");
  assert.equal(copy.atlasNodes[0].mapId, copy.atlasMaps[0].id);
  assert.equal(copy.atlasNodes[0].chapterId, copy.chapters[0].id);
  assert.equal(copy.atlasItems[0].ownerCharacterId, copy.characters.find((row) => row.name === "林晚").id);
  assert.equal(copy.atlasItems[0].nodeId, copy.atlasNodes[0].id);
  assert.equal(copy.atlasPositions[0].characterId, copy.characters.find((row) => row.name === "顾舟").id);
  // 旧备份没有蓝图字段时照常恢复为空蓝图。
  const old = structuredClone(backup);
  for (const row of old.books) for (const key of atlas.ATLAS_FIELDS) delete row[key];
  const before = new Set(db.list().map((row) => row.id));
  await restore(db, old);
  const oldCopy = db.book(db.list().find((row) => !before.has(row.id)).id);
  for (const key of atlas.ATLAS_FIELDS) assert.deepEqual(oldCopy[key], []);
  assert.ok(buildContext(oldCopy, oldCopy.chapters[0], "write"));
  // 损坏的蓝图备份拒绝恢复，不产生半成品副本。
  const count = db.list().length;
  const broken = structuredClone(backup);
  broken.books[0].atlasNodes = "not-an-array";
  await assert.rejects(restore(db, broken), /知识蓝图备份格式无效/);
  assert.equal(db.list().length, count);
});
