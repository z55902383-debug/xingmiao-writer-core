// 知识蓝图跨模块独立验收（store → context → sync-review → knowledge-chat → backup restore）。
// 只使用公开数据契约与本机 fixture，不修改产品代码。
//
// 末尾「独立验收发现项」最初以 todo 记录计划泄漏 / stale 泄漏 / 回收站与备份断引用，
// Lead 修复后（planned 归属、地图级 stale 继承、作者手动确认、回收站规范化、备份带回回收站）
// 已全部转正为普通用例。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const { runInNewContext } = require("node:vm");
const { pathToFileURL } = require("node:url");
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
  const dir = mkdtempSync(join(tmpdir(), "xm-atlas-integration-"));
  const db = new Store(join(dir, "test.sqlite"));
  t.after(() => {
    try {
      db.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows 上 SQLite 句柄偶尔晚一拍释放；临时目录由系统清理。
      }
    }
  });
  const book = db.createBook({ title: "蓝图集成验收" });
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
const edgeRow = (patch = {}) => ({
  id: "e1",
  mapId: "m1",
  source: "n1",
  target: "n2",
  kind: "route",
  label: "",
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

const payload = (ctx) => {
  const message = ctx.messages.find((row) => row.role === "user");
  const marker = "以下 JSON 为资料数据：\n";
  assert.ok(message?.content.includes(marker), "生成上下文应暴露普通资料 JSON");
  return JSON.parse(message.content.split(marker)[1]);
};

// 断言蓝图五集合没有悬空引用（仅用于引用应当完整的受控流程）。
function assertNoDangling(book) {
  const mapIds = new Set(book.atlasMaps.map((row) => row.id));
  const nodeIds = new Set(book.atlasNodes.map((row) => row.id));
  const characterIds = new Set(book.characters.map((row) => row.id));
  const chapterIds = new Set(book.chapters.map((row) => row.id));
  const problems = [];
  for (const row of book.atlasMaps)
    if (row.parentMapId && !mapIds.has(row.parentMapId))
      problems.push(`地图 ${row.id} 的上级地图 ${row.parentMapId} 不存在`);
  for (const row of book.atlasNodes) {
    if (!mapIds.has(row.mapId)) problems.push(`节点 ${row.id} 的地图不存在`);
    if (row.parentId && !nodeIds.has(row.parentId))
      problems.push(`节点 ${row.id} 的上级节点不存在`);
  }
  for (const row of book.atlasEdges) {
    if (!mapIds.has(row.mapId)) problems.push(`连线 ${row.id} 的地图不存在`);
    if (!nodeIds.has(row.source) || !nodeIds.has(row.target))
      problems.push(`连线 ${row.id} 的端点不存在`);
  }
  for (const row of book.atlasItems) {
    if (row.nodeId && !nodeIds.has(row.nodeId))
      problems.push(`物品 ${row.id} 所在节点不存在`);
    if (row.ownerCharacterId && !characterIds.has(row.ownerCharacterId))
      problems.push(`物品 ${row.id} 的保管人不存在`);
  }
  for (const row of book.atlasPositions) {
    if (!characterIds.has(row.characterId))
      problems.push(`人物位置 ${row.id} 的人物不存在`);
    if (!nodeIds.has(row.nodeId)) problems.push(`人物位置 ${row.id} 的地点不存在`);
  }
  for (const row of [...book.atlasMaps, ...book.atlasNodes, ...book.atlasEdges, ...book.atlasItems, ...book.atlasPositions])
    if (row.chapterId && !row.stale && !chapterIds.has(row.chapterId))
      problems.push(`蓝图记录 ${row.id} 的来源章节不存在且未标记待复核`);
  assert.deepEqual(problems, []);
}

function jobFor(db, bookId, chapterId, body) {
  const book = db.book(bookId);
  const chapter = book.chapters.find((row) => row.id === chapterId);
  return {
    id: `job-${chapterId}`,
    bookId,
    chapterId,
    kind: "write",
    instruction: "",
    output: body,
    status: "done",
    adopted: true,
    createdAt: now(),
    baseRevision: chapter.revision,
    context: {},
    error: "",
    review: {
      status: "ready",
      bodyHash: sync.hash(body),
      revision: chapter.revision,
      signature: contextSignature(book, chapter),
      changes: [],
    },
  };
}

function managerFixture(store, reply) {
  let resolveDone;
  const done = new Promise((doneResolve) => (resolveDone = doneResolve));
  const service = createKnowledgeChat({
    getStore: () => store,
    getConfig: () => ({ model: "fixture", provider: "api" }),
    getKey: async () => "",
    requestModel: async (...args) => {
      args[3](JSON.stringify(reply));
      return { finishReason: "stop" };
    },
    requestCodex: async () => ({}),
    emit: (value) => {
      if (value.messages.at(-1)?.status !== "running") resolveDone(value);
    },
  });
  return { service, done };
}

/* ------------------------------------------------------------------ 1. 闭环 */

test("闭环：定稿正文→同步提取地点/位置/物品→原子写入→下一次生成的上下文可用且不含未来资料", async (t) => {
  const { db, bookId } = setup(t);
  const body = "顾舟来到雾港。林晚在旧钟楼把铜钥匙交给顾舟。";
  const draft = db.updateChapter(db.book(bookId).chapters[0].id, { body }, 1);
  const rows = sync.parse(
    JSON.stringify({
      changes: [
        { kind: "place", subject: "雾港", value: "港口城市", evidence: "顾舟来到雾港。" },
        { kind: "place", subject: "旧钟楼", value: "停摆的钟楼", evidence: "林晚在旧钟楼" },
        { kind: "position", subject: "林晚", value: "旧钟楼", evidence: "林晚在旧钟楼" },
        { kind: "item", subject: "铜钥匙", target: "顾舟", value: "旧钟楼", evidence: "把铜钥匙交给顾舟" },
      ],
    }),
    draft.body,
  );
  const job = jobFor(db, bookId, draft.id, body);
  job.review.changes = rows;
  db.putJob(job);
  const applied = sync.apply(db, job.id, rows);
  assert.equal(applied.chapters[0].status, "final");
  assert.equal(applied.atlasMaps.length, 1);
  assert.equal(applied.atlasNodes.length, 2);
  assert.equal(applied.atlasPositions.length, 1);
  assert.equal(applied.atlasItems.length, 1);
  assertNoDangling(applied);

  // 新增一个未定稿的“下一章”：它之前的蓝图记录作为事实进入上下文。
  const c2 = db.createChapter(bookId);
  let book = db.book(bookId);
  let chapter2 = book.chapters.find((row) => row.id === c2.id);
  const generated = buildContext(book, chapter2, "write");
  assert.ok(generated.atlasCount >= 4, "已定稿章节里的地点、位置、物品应进入生成上下文");
  const facts = payload(generated).atlas;
  assert.deepEqual(facts.nodes.map((row) => row.name).sort(), ["旧钟楼", "雾港"].sort());
  assert.equal(facts.positions[0].character, "林晚");
  assert.equal(facts.positions[0].node, "旧钟楼");
  assert.equal(facts.items[0].owner, "顾舟");
  assert.equal(facts.items[0].node, "旧钟楼");
  assert.deepEqual(facts.planned.nodes, []);

  // 来源是未定稿章节的蓝图记录：生成时排除并警告，变化分析消息也不提供。
  // 注意：世界地图由同步自动创建，id 是随机 UUID，节点必须引用真实的 mapId。
  const worldMap = db.book(bookId).atlasMaps[0];
  db.saveAtlas(bookId, {
    nodes: [
      ...db.book(bookId).atlasNodes,
      nodeRow({ id: "draft-node", name: "未定稿地点", mapId: worldMap.id, chapterId: c2.id }),
    ],
  });
  book = db.book(bookId);
  chapter2 = book.chapters.find((row) => row.id === c2.id);
  const withDraft = buildContext(book, chapter2, "write");
  assert.ok(!JSON.stringify(withDraft.messages).includes("未定稿地点"));
  assert.ok(withDraft.warnings.some((warning) => /知识蓝图中有 \d+ 条记录来源已变化或未定稿/.test(warning)));
  const analysis = JSON.stringify(sync.messages(book, chapter2, "顾舟来到雾港。"));
  assert.match(analysis, /旧钟楼/, "变化分析应看到此前已确认的地点");
  assert.doesNotMatch(analysis, /未定稿地点/, "变化分析不得看到当前章未定稿资料");
});

test("守卫：蓝图变化会让旧的正文变化分析整体失效，不会用过期资料同步", (t) => {
  const { db, bookId } = setup(t);
  const body = "顾舟来到雾港。";
  const draft = db.updateChapter(db.book(bookId).chapters[0].id, { body }, 1);
  let book = db.book(bookId);
  const rows = sync.parse(
    JSON.stringify({
      changes: [{ kind: "place", subject: "雾港", value: "港口", evidence: "顾舟来到雾港。" }],
    }),
    body,
  );
  db.saveAtlas(bookId, { maps: [mapRow()], nodes: [nodeRow()] });
  book = db.book(bookId);
  const job = jobFor(db, bookId, draft.id, body);
  job.review.changes = rows;
  db.putJob(job);
  // 分析完成后作者又改了蓝图（例如拖动节点/补描述）。
  db.saveAtlas(bookId, {
    nodes: db.book(bookId).atlasNodes.map((row) => ({ ...row, description: "分析后补的描述" })),
  });
  const changed = db.book(bookId);
  assert.notEqual(contextSignature(changed, changed.chapters[0]), job.review.signature);
  assert.throws(() => sync.apply(db, job.id, rows), /正文或资料已修改/);
  assert.equal(db.chapter(draft.id).status, "draft", "同步失败不得顺手定稿");
  assert.equal(db.book(bookId).atlasNodes[0].description, "分析后补的描述");
});

test("回滚：地点/位置/物品任一引用解析失败时，章节定稿、蓝图、记忆与时间线都不半写入", (t) => {
  const { db, bookId } = setup(t);
  const body = "顾舟去了无名谷，青铜镜留在那里。";
  const draft = db.updateChapter(db.book(bookId).chapters[0].id, { body }, 1);
  const before = db.book(bookId);
  const rows = sync.parse(
    JSON.stringify({
      changes: [
        { kind: "place", subject: "临时营地", value: "临时营地", evidence: "顾舟去了无名谷" },
        { kind: "position", subject: "顾舟", value: "无名谷", evidence: "顾舟去了无名谷" },
        { kind: "memory", subject: "顾舟", attribute: "位置", value: "无名谷", evidence: "顾舟去了无名谷" },
      ],
    }),
    body,
  );
  const job = jobFor(db, bookId, draft.id, body);
  job.review.changes = rows;
  db.putJob(job);
  assert.throws(() => sync.apply(db, job.id, rows), /地点尚未记录/);
  const after = db.book(bookId);
  assert.equal(after.chapters[0].status, "draft");
  for (const key of atlas.ATLAS_FIELDS) assert.deepEqual(after[key], before[key], key);
  assert.deepEqual(after.memories, before.memories);
  assert.deepEqual(after.timeline || [], before.timeline || []);
  const reviewed = db.job(job.id);
  assert.notEqual(reviewed.review.applied, true);
});

/* ------------------------------------------ 2. 资料对话方案应用 / 级联 / 撤销 */

test("资料对话：跨集合新增蓝图→应用→删除地图级联→撤销完整还原，全程无悬空引用", async (t) => {
  const { db, bookId } = setup(t);
  db.saveAtlas(bookId, {
    maps: [mapRow()],
    nodes: [nodeRow(), nodeRow({ id: "n2", name: "码头", x: 500, y: 500 })],
    edges: [edgeRow()],
    items: [itemRow()],
    positions: [positionRow()],
  });
  const first = managerFixture(db, {
    reply: "新增内城与钟楼。",
    changes: [
      {
        target: "atlasMap",
        id: "",
        operation: "create",
        fields: { name: "雾港内城", kind: "region", parentMapId: "m1", theme: "parchment", status: "fixed" },
      },
      {
        target: "atlasNode",
        id: "",
        operation: "create",
        fields: { kind: "building", name: "钟楼", description: "停摆的钟楼", status: "fixed" },
      },
    ],
  });
  first.service.start({ bookId, message: "在雾港里加一座钟楼" });
  const created = (await first.done).messages.at(-1).proposal;
  assert.equal(created.changes.length, 2);
  const applied = first.service.apply({
    bookId,
    proposalId: created.id,
    changeIds: created.changes.map((row) => row.key),
  });
  const inner = applied.book.atlasMaps.find((row) => row.name === "雾港内城");
  assert.ok(inner);
  const tower = applied.book.atlasNodes.find((row) => row.name === "钟楼");
  assert.ok(tower);
  assert.equal(tower.mapId, inner.id, "新节点应自动落到本方案新建的地图");
  assert.equal(inner.parentMapId, "m1");
  assertNoDangling(applied.book);

  // 删除父地图：节点、连线、人物位置级联删除，物品变为未定位；撤销完整还原。
  // 撤销恢复到“删除前”状态，即第一次方案应用后的快照（含新建的雾港内城）。
  const beforeDeletion = db.book(bookId);
  const second = managerFixture(db, {
    reply: "删除雾港地图。",
    changes: [{ target: "atlasMap", id: "m1", operation: "delete", fields: {} }],
  });
  second.service.start({ bookId, message: "删掉雾港地图" });
  const deletion = (await second.done).messages.at(-1).proposal;
  const cascaded = second.service.apply({
    bookId,
    proposalId: deletion.id,
    changeIds: deletion.changes.map((row) => row.key),
  });
  assert.deepEqual(cascaded.book.atlasMaps.map((row) => row.name), ["雾港内城"]);
  assert.deepEqual(cascaded.book.atlasNodes.map((row) => row.name), ["钟楼"]);
  assert.deepEqual(cascaded.book.atlasEdges, []);
  assert.equal(cascaded.book.atlasItems.length, 1);
  assert.equal(cascaded.book.atlasItems[0].nodeId, "");
  assert.deepEqual(cascaded.book.atlasPositions, []);
  assertNoDangling(cascaded.book);
  // 删除记录进入回收站，撤销后清掉回收项并还原全部引用。
  const trash = db.trash().filter((entry) => entry.type.startsWith("atlas"));
  assert.ok(trash.length >= 1);
  second.service.undo({ bookId, proposalId: deletion.id });
  const undone = db.book(bookId);
  for (const key of atlas.ATLAS_FIELDS)
    assert.deepEqual(undone[key], beforeDeletion[key], key);
  assert.ok(undone.atlasNodes.some((row) => row.name === "钟楼"), "第一次方案新建的节点应在撤销后保留");
  assert.ok(!db.trash().some((entry) => trash.some((row) => row.id === entry.id)));
});

test("资料对话：伪造/悬空引用与不允许的字段在方案阶段被拒绝，不写入蓝图", (t) => {
  const { db, bookId } = setup(t);
  db.saveAtlas(bookId, {
    maps: [mapRow()],
    nodes: [nodeRow()],
  });
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
    { target: "atlasEdge", id: "", operation: "create", fields: { mapId: "m1", source: "n1", target: "gone", kind: "link", status: "fixed" } },
    /端点|连接/,
  );
  reject(
    { target: "atlasPosition", id: "", operation: "create", fields: { characterId: "p1", nodeId: "gone", status: "present" } },
    /地点不存在/,
  );
  reject(
    { target: "atlasItem", id: "", operation: "create", fields: { name: "坏物品", nodeId: "gone", ownerCharacterId: "p1", status: "fixed" } },
    /节点不存在/,
  );
  reject(
    { target: "atlasNode", id: "", operation: "create", fields: { name: "坏字段", x: 1, y: 2 } },
    /不允许修改的字段/,
  );
  // 提示词要求引用真实地图/节点/人物；旧书缺失字段也要能给出蓝图资料。
  const prompt = JSON.stringify(buildPrompt(book, [], "列一下地图"));
  assert.match(prompt, /atlasMaps/);
  assert.match(prompt, /atlasPositions/);
  assertNoDangling(db.book(bookId));
});

/* -------------------------------------------------- 3. 备份恢复重映射闭环 */

async function restoreBackupFrom(db, backup) {
  // 与作品内「恢复备份」同一入口（electron/main.cjs 的 restoreBackup）。
  const source = readFileSync(resolve(__dirname, "../electron/main.cjs"), "utf8");
  const start = source.indexOf("async function restoreBackup()");
  const end = source.indexOf("const actions =", start);
  assert.ok(start >= 0 && end > start);
  const json = JSON.stringify(backup);
  const action = runInNewContext("(" + source.slice(start, end).trim() + ")", {
    require: require("node:module").createRequire(resolve("electron/main.cjs")),
    store: db,
    win: null,
    assert: check,
    text,
    id,
    now,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ["isolated-backup.json"] }) },
    fs: {
      stat: async () => ({ size: Buffer.byteLength(json) }),
      readFile: async () => json,
    },
  });
  return action();
}

test("备份恢复：五集合全部重新编号并重映射引用，恢复后的书可继续生成/同步/资料对话", async (t) => {
  const { db, bookId } = setup(t);
  let book = db.book(bookId);
  const c1 = final(db, book.chapters[0], "顾舟来到雾港。");
  const c2 = final(db, db.createChapter(bookId), "旧钟楼出现。");
  book = db.book(bookId);
  db.saveAtlas(bookId, {
    maps: [mapRow({ chapterId: c1.id }), mapRow({ id: "m2", name: "内城", kind: "region", parentMapId: "m1", chapterId: c1.id, order: 1 })],
    nodes: [
      nodeRow({ chapterId: c1.id }),
      nodeRow({ id: "n2", name: "码头", x: 500, y: 500, status: "provisional", chapterId: c2.id }),
    ],
    edges: [edgeRow({ chapterId: c1.id })],
    items: [itemRow({ ownerCharacterId: "p2", chapterId: c1.id })],
    positions: [positionRow({ chapterId: c1.id }), positionRow({ id: "pos2", characterId: "p2", nodeId: "n2", chapterId: c2.id, stale: true })],
  });
  book = db.book(bookId);
  const backup = db.backup();
  assert.equal(backup.books[0].atlasPositions.length, 2);
  assert.equal(await restoreBackupFrom(db, backup), 1);
  const copyId = db.list().find((row) => row.id !== bookId).id;
  const copy = db.book(copyId);
  assert.equal(copy.atlasMaps.length, 2);
  const [port, inner] = copy.atlasMaps;
  assert.notEqual(port.id, "m1");
  assert.equal(inner.parentMapId, port.id);
  const tower = copy.atlasNodes.find((row) => row.name === "旧钟楼");
  const dock = copy.atlasNodes.find((row) => row.name === "码头");
  assert.equal(tower.mapId, port.id);
  assert.equal(tower.chapterId, copy.chapters[0].id);
  assert.equal(copy.atlasEdges.length, 1);
  assert.equal(copy.atlasEdges[0].source, tower.id);
  assert.equal(copy.atlasEdges[0].target, dock.id);
  assert.equal(copy.atlasItems[0].nodeId, tower.id);
  assert.equal(copy.atlasItems[0].ownerCharacterId, copy.characters.find((row) => row.name === "林晚").id);
  const position = copy.atlasPositions.find((row) => row.position !== undefined) || copy.atlasPositions[0];
  assert.equal(position.characterId, copy.characters.find((row) => row.name === "顾舟").id);
  assert.equal(position.nodeId, tower.id);
  assert.ok(copy.atlasPositions.some((row) => row.stale === true), "备份里的待复核标记应保留");
  assertNoDangling(copy);

  // 恢复后的书可以继续用于生成上下文、同步提取与资料对话。
  const generated = buildContext(copy, copy.chapters[0], "write");
  assert.ok(generated.atlasCount >= 4);
  const facts = payload(generated).atlas;
  assert.ok(facts.nodes.some((row) => row.name === "旧钟楼"));
  const rows = sync.parse(
    JSON.stringify({ changes: [{ kind: "place", subject: "灯塔", value: "废弃灯塔", evidence: "顾舟终于走进灯塔。" }] }),
    "顾舟终于走进灯塔。",
  );
  const next = db.createChapter(copyId);
  const nextDraft = db.updateChapter(next.id, { body: "顾舟终于走进灯塔。" }, next.revision);
  const job = jobFor(db, copyId, nextDraft.id, "顾舟终于走进灯塔。");
  job.review.changes = rows;
  db.putJob(job);
  const synced = sync.apply(db, job.id, rows);
  assert.ok(synced.atlasNodes.some((row) => row.name === "灯塔"));
  const proposal = checkedProposal(
    JSON.stringify({
      reply: "补一张世界地图。",
      changes: [{ target: "atlasMap", id: "", operation: "create", fields: { name: "恢复后的新地图", kind: "world", status: "fixed" } }],
    }),
    db.book(copyId),
  );
  assert.equal(proposal.changes.length, 1);

  // 损坏的蓝图备份拒绝恢复，且不产生半成品副本或覆盖逻辑。
  const count = db.list().length;
  const broken = structuredClone(backup);
  broken.books[0].atlasNodes = "not-an-array";
  await assert.rejects(restoreBackupFrom(db, broken), /知识蓝图备份格式无效/);
  assert.equal(db.list().length, count);
});

test("旧作品没有任何 atlas 字段时，同步写入/生成/备份/资料对话全部兼容", async (t) => {
  const { db, bookId } = setup(t);
  const raw = db.rawBook(bookId);
  for (const key of atlas.ATLAS_FIELDS) delete raw[key];
  db.putBook(raw);
  const draft = db.updateChapter(db.book(bookId).chapters[0].id, { body: "顾舟来到雾港。" }, 1);
  const rows = sync.parse(
    JSON.stringify({
      changes: [
        { kind: "place", subject: "雾港", value: "港口", evidence: "顾舟来到雾港。" },
        { kind: "position", subject: "顾舟", value: "雾港", evidence: "顾舟来到雾港。" },
      ],
    }),
    draft.body,
  );
  const job = jobFor(db, bookId, draft.id, draft.body);
  job.review.changes = rows;
  db.putJob(job);
  const synced = sync.apply(db, job.id, rows);
  for (const key of atlas.ATLAS_FIELDS) assert.ok(Array.isArray(synced[key]), key);
  assert.equal(synced.atlasNodes.length, 1);
  assert.equal(synced.atlasPositions.length, 1);
  const context = buildContext(db.book(bookId), db.book(bookId).chapters[0], "write");
  assert.ok(context.atlasCount >= 2);
  const backup = db.backup();
  assert.equal(backup.books[0].atlasNodes.length, 1);
  assert.equal(
    checkedProposal(
      JSON.stringify({
        reply: "补一条物品。",
        changes: [{ target: "atlasItem", id: "", operation: "create", fields: { name: "旧罗盘", status: "fixed" } }],
      }),
      db.book(bookId),
    ).changes.length,
    1,
  );
});

/* ------------------------------------------------------------ 4. i18n 完整性 */

test("i18n：蓝图类型/状态/主题等动态标签都有英文翻译（静态 tr 扫描覆盖不到）", async () => {
  const model = await import(pathToFileURL(resolve(__dirname, "../src/atlasModel.ts")).href);
  const { english } = await import(pathToFileURL(resolve(__dirname, "../src/locales/en.ts")).href);
  const labelMaps = [
    "ATLAS_MAP_KIND_LABELS",
    "ATLAS_NODE_KIND_LABELS",
    "ATLAS_EDGE_KIND_LABELS",
    "ATLAS_STATUS_LABELS",
    "ATLAS_POSITION_STATUS_LABELS",
    "ATLAS_THEME_LABELS",
    "ATLAS_STATE_LABELS",
  ];
  const missing = [];
  let total = 0;
  for (const name of labelMaps) {
    const map = model[name];
    assert.ok(map && typeof map === "object", `${name} 必须存在`);
    for (const [key, value] of Object.entries(map)) {
      total += 1;
      assert.ok(key && value, `${name}.${key} 不能为空`);
      if (!english[value]) missing.push(`${name}.${key}=${value}`);
    }
  }
  // 界面上通过 tr(常量) 动态显示的标签，必须也能在英文表里找到。
  assert.deepEqual(missing, []);
  assert.ok(total >= 26);
});

/* ------------------------ 5. 独立验收发现项（Lead 修复后已全部转正） */

test("计划不是事实：planned 地图下的固定节点/连线/物品/位置统一归入计划，不进入生成事实", (t) => {
  const { db, bookId } = setup(t);
  const c1 = final(db, db.book(bookId).chapters[0], "顾舟在雾港。");
  db.saveAtlas(bookId, {
    maps: [
      mapRow({ id: "m1", name: "计划中的未来城", status: "planned", order: 0 }),
      mapRow({ id: "m2", name: "现在的雾港", order: 1 }),
    ],
    nodes: [
      nodeRow({ id: "n1", mapId: "m1", name: "计划中的塔" }),
      nodeRow({ id: "n1b", mapId: "m1", kind: "building", name: "计划中的楼", x: 150 }),
      nodeRow({ id: "n2", mapId: "m2", name: "现在的塔", x: 200, y: 200 }),
    ],
    edges: [edgeRow({ id: "e1", mapId: "m1", source: "n1", target: "n1b" })],
    items: [
      itemRow({ id: "i1", name: "计划宝物", nodeId: "n1" }),
      itemRow({ id: "i2", name: "现在的信", nodeId: "n2" }),
    ],
    positions: [
      // 同一人物同一章节只保留最后一条位置记录，计划位置换一个人物避免被合并掉。
      positionRow({ id: "pos1", characterId: "p2", nodeId: "n1" }),
      positionRow({ id: "pos2", nodeId: "n2" }),
    ],
  });
  const book = db.book(bookId);
  const state = atlas.context(book, book.chapters[0]);
  // 事实集合：计划地图本身与它的子资料全部不出现。
  assert.deepEqual(state.maps.map((row) => row.name), ["现在的雾港"]);
  assert.deepEqual(state.nodes.map((row) => row.name), ["现在的塔"]);
  assert.deepEqual(state.edges, []);
  assert.deepEqual(state.items.map((row) => row.name), ["现在的信"]);
  assert.deepEqual(state.positions.map((row) => row.id), ["pos2"]);
  assert.equal(state.count, 4); // 1 地图 + 1 节点 + 1 物品 + 1 位置
  // 计划集合：地图及其下的节点/连线/物品/位置都保留为“尚未发生”，不能被当作事实丢失。
  assert.deepEqual(state.planned.maps.map((row) => row.name), ["计划中的未来城"]);
  assert.deepEqual(state.planned.nodes.map((row) => row.name).sort(), ["计划中的楼", "计划中的塔"].sort());
  assert.equal(state.planned.edges.length, 1);
  assert.deepEqual(state.planned.items.map((row) => row.name), ["计划宝物"]);
  assert.deepEqual(state.planned.positions.map((row) => row.id), ["pos1"]);
  assert.equal(state.plannedCount, 6);
  // 生成上下文里必须明确区分计划与事实，且不能把计划写进 maps/nodes。
  const generated = buildContext(book, book.chapters[0], "write");
  const facts = payload(generated).atlas;
  assert.deepEqual(facts.nodes.map((row) => row.name), ["现在的塔"]);
  assert.deepEqual(facts.planned.nodes.map((row) => row.name).sort(), ["计划中的楼", "计划中的塔"].sort());
  assert.ok(generated.warnings.some((warning) => warning.includes("尚未发生")));
});



test("地图级 stale 会继承到节点/连线/物品/位置，投影与后端判断一致", async () => {
  const { resolveAtlas } = await import(pathToFileURL(resolve(__dirname, "../src/atlasModel.ts")).href);
  const book = {
    chapters: [{ id: "c1", order: 1, status: "final", title: "第一章" }],
    characters: [{ id: "p1", name: "顾舟" }],
    atlasMaps: [{ id: "m1", name: "已过期地图", kind: "world", parentMapId: "", description: "", theme: "ink", status: "fixed", chapterId: "c1", stale: true, order: 0 }],
    atlasNodes: [
      { id: "n1", mapId: "m1", parentId: "", kind: "landmark", name: "过期钟楼", description: "", x: 10, y: 20, status: "fixed", chapterId: "" },
      { id: "n2", mapId: "m1", parentId: "", kind: "landmark", name: "过期码头", description: "", x: 30, y: 40, status: "fixed", chapterId: "" },
    ],
    atlasEdges: [{ id: "e1", mapId: "m1", source: "n1", target: "n2", kind: "route", label: "", status: "fixed", chapterId: "" }],
    atlasItems: [{ id: "i1", name: "过期钥匙", description: "", nodeId: "n1", ownerCharacterId: "", status: "fixed", chapterId: "" }],
    atlasPositions: [{ id: "pos1", characterId: "p1", nodeId: "n2", chapterId: "", status: "present", note: "" }],
  };
  // 后端：地图过期后，地图/节点/连线/位置都不进生成事实，物品不再定位到过期地点。
  const backend = atlas.context(book, { id: "c1", order: 1, status: "final" });
  assert.deepEqual(backend.maps, [], "后端排除 stale 地图");
  assert.deepEqual(backend.nodes, []);
  assert.deepEqual(backend.edges, []);
  assert.deepEqual(backend.positions, []);
  assert.ok(backend.items.every((row) => row.nodeId === ""), "过期地点上的物品不能仍作为定位事实");
  // 语义：因祖先 stale 被排除的地图/节点/连线/位置各计一次；物品保留为「未定位事实」，
  // 其位置归属不可靠但物品本身可独立确认，因此不计入 staleCount。
  assert.equal(backend.staleCount, 5, "过期地图 + 两个节点 + 一条连线 + 一条位置 = 5，物品不计入");
  // 前端：地图级 stale 传给全部子资料，不能显示成已确认，stats 也要计入。
  const view = resolveAtlas(book, "c1");
  assert.equal(view.maps.find((row) => row.id === "m1")?.state, "stale");
  assert.equal(view.stats.staleMaps, 1);
  assert.deepEqual(view.nodes.map((row) => [row.id, row.state]), [["n1", "stale"], ["n2", "stale"]]);
  assert.equal(view.edges.find((row) => row.id === "e1")?.state, "stale");
  assert.equal(view.items.find((row) => row.id === "i1")?.state, "stale");
  assert.equal(view.positions.find((row) => row.id === "pos1")?.state, "stale");
  assert.equal(view.stats.staleNodes, 2);
  assert.equal(view.stats.staleEdges, 1);
  assert.equal(view.stats.staleItems, 1);
  assert.equal(view.stats.stalePositions, 1);
});

test("待复核资料由作者确认后恢复事实资格；重新定稿不会自动清除（产品语义：必须人工核对）", (t) => {
  const { db, bookId } = setup(t);
  const c1 = final(db, db.book(bookId).chapters[0], "顾舟来到雾港。");
  db.saveAtlas(bookId, {
    maps: [mapRow({ chapterId: c1.id })],
    nodes: [nodeRow({ chapterId: c1.id })],
  });
  // 修改来源章节 → 两条记录都被标 stale，生成上下文排除并告警。
  const editing = db.chapter(c1.id);
  db.updateChapter(c1.id, { body: "顾舟来到雾港。风很大。" }, editing.revision);
  const refinal = db.chapter(c1.id);
  db.finalize(c1.id, refinal.revision);
  let state = db.book(bookId);
  assert.equal(state.atlasMaps[0].stale, true);
  assert.equal(state.atlasNodes[0].stale, true);
  let ctx = atlas.context(state, state.chapters[0]);
  assert.equal(ctx.count, 0);
  assert.ok(ctx.staleCount >= 2);
  assert.ok(
    buildContext(state, state.chapters[0], "write").warnings.some((warning) =>
      /知识蓝图中有 \d+ 条记录来源已变化或未定稿/.test(warning),
    ),
  );
  // 作者核对来源后手动确认（等价于界面「确认有效」/编辑保存：提交 stale:false）。
  db.saveAtlas(bookId, {
    maps: db.book(bookId).atlasMaps.map((row) => ({ ...row, stale: false })),
    nodes: db.book(bookId).atlasNodes.map((row) => ({ ...row, stale: false })),
  });
  state = db.book(bookId);
  ctx = atlas.context(state, state.chapters[0]);
  assert.equal(ctx.staleCount, 0);
  assert.equal(ctx.count, 2, "确认后地图与节点重新作为事实进入生成");
  // 确认不是永久豁免：来源章节再次变化会重新待复核。
  const again = db.chapter(c1.id);
  db.updateChapter(c1.id, { body: "顾舟来到雾港。真的风很大。" }, again.revision);
  const refinal2 = db.chapter(c1.id);
  db.finalize(c1.id, refinal2.revision);
  assert.equal(db.book(bookId).atlasMaps[0].stale, true);
  assert.equal(db.book(bookId).atlasNodes[0].stale, true);
});

test("回收站恢复蓝图记录会规范化引用：节点仍在时保留定位，节点已删除时清空定位且仍然可见", async (t) => {
  const { db, bookId } = setup(t);
  const { resolveAtlas } = await import(pathToFileURL(resolve(__dirname, "../src/atlasModel.ts")).href);
  db.saveAtlas(bookId, {
    maps: [mapRow()],
    nodes: [nodeRow(), nodeRow({ id: "n2", name: "码头", x: 500, y: 500 })],
    items: [itemRow()],
    positions: [positionRow()],
  });
  // 场景一：删除物品时所在地点仍在 → 从回收站恢复后保留 nodeId。
  const item = db.book(bookId).atlasItems[0];
  db.recycle("atlasItem", bookId, item);
  db.updateBook(bookId, { atlasItems: [] });
  db.restoreTrash(db.trash().find((row) => row.type === "atlasItem").id);
  let book = db.book(bookId);
  assert.equal(book.atlasItems.length, 1);
  assert.equal(book.atlasItems[0].nodeId, "n1", "节点仍存在时应保留物品定位");

  // 场景二：先真正删除节点、再从回收站恢复物品 → 悬空定位被清空，且不会从界面消失。
  const current = db.book(bookId).atlasItems[0];
  db.recycle("atlasItem", bookId, current);
  db.updateBook(bookId, { atlasItems: [] });
  db.saveAtlas(bookId, { nodes: [nodeRow({ id: "n2", name: "码头", x: 500, y: 500 })] });
  const itemEntry = db.trash().find((row) => row.type === "atlasItem");
  db.restoreTrash(itemEntry.id);
  book = db.book(bookId);
  const restored = book.atlasItems.find((row) => row.name === "铜钥匙");
  assert.ok(restored);
  assert.equal(restored.nodeId, "", "节点永久删除后恢复应清空定位，而不是留下悬空引用");
  const view = resolveAtlas(book, book.chapters[0].id);
  assert.ok(view.items.some((row) => row.name === "铜钥匙"), "清空悬空引用后物品必须在界面上可见");
});

test("祖先链继承：planned/stale 父地图或父节点下的固定子资料也不进入生成事实", async () => {
  const { resolveAtlas } = await import(pathToFileURL(resolve(__dirname, "../src/atlasModel.ts")).href);
  // 场景一：作者先规划“未来大陆”，再在它下面建子区域与地点（父地图 planned，子地图/节点默认 fixed）。
  const plannedParentMap = {
    chapters: [{ id: "c1", order: 1, status: "final", title: "第一章" }],
    characters: [],
    atlasMaps: [
      { id: "planned-parent", name: "计划中的大陆", kind: "world", parentMapId: "", description: "", theme: "ink", status: "planned", chapterId: "", order: 0 },
      { id: "fixed-child", name: "计划大陆上的旧城", kind: "region", parentMapId: "planned-parent", description: "", theme: "ink", status: "fixed", chapterId: "", order: 1 },
    ],
    atlasNodes: [
      { id: "n1", mapId: "fixed-child", parentId: "", kind: "landmark", name: "计划大陆上的塔", description: "", x: 100, y: 100, status: "fixed", chapterId: "" },
    ],
    atlasEdges: [],
    atlasItems: [],
    atlasPositions: [],
  };
  const plannedContext = atlas.context(plannedParentMap, { id: "c1", order: 1, status: "final" });
  assert.deepEqual(plannedContext.maps.map((row) => row.name), [], "计划父地图的固定子地图不能进入事实");
  assert.deepEqual(plannedContext.nodes.map((row) => row.name), [], "计划父地图下的节点不能进入事实");
  assert.deepEqual(
    plannedContext.planned.maps.map((row) => row.name).sort(),
    ["计划中的大陆", "计划大陆上的旧城"].sort(),
    "子地图应随父地图归入计划",
  );
  assert.deepEqual(plannedContext.planned.nodes.map((row) => row.name), ["计划大陆上的塔"]);
  const plannedView = resolveAtlas(plannedParentMap, "c1");
  assert.ok(!plannedView.maps.some((row) => row.id === "fixed-child"), "默认不显示计划父地图下的子地图，也不能把它当 root");
  assert.ok(!plannedView.roots.some((row) => row.id === "fixed-child"));
  const plannedShown = resolveAtlas(plannedParentMap, "c1", { showPlans: true });
  assert.equal(plannedShown.maps.find((row) => row.id === "fixed-child")?.state, "planned", "前端子地图应继承父地图的计划状态");
  assert.equal(plannedShown.nodes.find((row) => row.id === "n1")?.state, "planned");

  // 场景二：active 地图上，planned 父节点与 stale 父节点下的固定子节点。
  const parentNodeBook = {
    chapters: [{ id: "c1", order: 1, status: "final", title: "第一章" }],
    characters: [],
    atlasMaps: [{ id: "m1", name: "雾港", kind: "world", parentMapId: "", description: "", theme: "ink", status: "fixed", chapterId: "", order: 0 }],
    atlasNodes: [
      { id: "planned-parent", mapId: "m1", parentId: "", kind: "building", name: "计划中的钟楼", description: "", x: 100, y: 100, status: "planned", chapterId: "" },
      { id: "planned-child", mapId: "m1", parentId: "planned-parent", kind: "room", name: "计划中的钟室", description: "", x: 200, y: 200, status: "fixed", chapterId: "" },
      { id: "stale-parent", mapId: "m1", parentId: "", kind: "building", name: "过期的仓库", description: "", x: 300, y: 300, status: "fixed", stale: true, chapterId: "" },
      { id: "stale-child", mapId: "m1", parentId: "stale-parent", kind: "room", name: "过期仓库的房间", description: "", x: 400, y: 400, status: "fixed", chapterId: "" },
    ],
    atlasEdges: [],
    atlasItems: [],
    atlasPositions: [],
  };
  const nodeContext = atlas.context(parentNodeBook, { id: "c1", order: 1, status: "final" });
  assert.deepEqual(nodeContext.nodes.map((row) => row.name), [], "计划/待复核父节点下的固定子节点不能进入事实");
  assert.ok(nodeContext.planned.nodes.some((row) => row.id === "planned-child"), "计划父节点下的子节点应归入计划");
  assert.ok(nodeContext.staleCount >= 2, "过期父节点与其子节点都应计入待复核");
  const nodeView = resolveAtlas(parentNodeBook, "c1");
  assert.ok(!nodeView.nodes.some((row) => row.id === "planned-child"), "默认不显示计划父节点下的子节点");
  assert.equal(nodeView.nodes.find((row) => row.id === "stale-child")?.state, "stale", "前端待复核父节点下的子节点应继承待复核");
  const nodeShown = resolveAtlas(parentNodeBook, "c1", { showPlans: true });
  assert.equal(nodeShown.nodes.find((row) => row.id === "planned-child")?.state, "planned", "前端计划父节点下的子节点应继承计划");
});

test("备份恢复会重映射并带回五类蓝图回收站记录，恢复后可继续逐项还原", async (t) => {
  const { db, bookId } = setup(t);
  db.saveAtlas(bookId, {
    maps: [
      mapRow({ id: "m1", name: "雾港", order: 0 }),
      mapRow({ id: "m2", name: "内城", kind: "region", parentMapId: "m1", order: 1 }),
    ],
    nodes: [
      nodeRow({ id: "n1" }),
      nodeRow({ id: "n2a", mapId: "m2", name: "钟楼", x: 400, y: 400 }),
      nodeRow({ id: "n2b", mapId: "m2", name: "码头", x: 500, y: 500 }),
    ],
    edges: [{ id: "e2", mapId: "m2", source: "n2a", target: "n2b", kind: "route", label: "石阶", status: "fixed", chapterId: "" }],
    items: [itemRow({ id: "i2", name: "旧钥匙", nodeId: "n2a", ownerCharacterId: "p1" })],
    positions: [positionRow({ id: "pos2", nodeId: "n2b", chapterId: "" })],
  });
  // 模拟资料对话删除内城：先回收其下的线/物品/位置/节点，最后回收地图。
  const before = db.book(bookId);
  const snapshot = (field, id) => before[field].find((row) => row.id === id);
  db.recycle("atlasEdge", bookId, snapshot("atlasEdges", "e2"));
  db.recycle("atlasItem", bookId, snapshot("atlasItems", "i2"));
  db.recycle("atlasPosition", bookId, snapshot("atlasPositions", "pos2"));
  db.recycle("atlasNode", bookId, snapshot("atlasNodes", "n2a"));
  db.recycle("atlasNode", bookId, snapshot("atlasNodes", "n2b"));
  db.recycle("atlasMap", bookId, snapshot("atlasMaps", "m2"));
  db.updateBook(bookId, { atlasMaps: [snapshot("atlasMaps", "m1")] });
  const backup = db.backup();
  assert.equal(backup.trash.filter((row) => row.type.startsWith("atlas")).length, 6);
  assert.equal(await restoreBackupFrom(db, backup), 1);
  const copyId = db.list().find((row) => row.id !== bookId).id;
  const copy = db.book(copyId);
  const trash = db.trash().filter((row) => row.bookId === copyId && row.type.startsWith("atlas"));
  assert.equal(trash.length, 6, "五类蓝图回收站记录都要带回副本");
  const byType = (type) => trash.filter((row) => row.type === type);
  const [mapEntry] = byType("atlasMap");
  const nodeEntries = byType("atlasNode");
  const [edgeEntry] = byType("atlasEdge");
  const [itemEntry] = byType("atlasItem");
  const [positionEntry] = byType("atlasPosition");
  // 回收站里的引用也要重映射：节点指向同批预留的地图 ID，连线/物品/位置指向预留节点 ID。
  for (const entry of nodeEntries) assert.equal(entry.item.mapId, mapEntry.item.id);
  assert.equal(mapEntry.item.parentMapId, copy.atlasMaps[0].id, "被删地图的 parentMapId 指向恢复后的父地图");
  assert.equal(edgeEntry.item.mapId, mapEntry.item.id);
  assert.deepEqual(new Set([edgeEntry.item.source, edgeEntry.item.target]), new Set(nodeEntries.map((row) => row.item.id)));
  assert.equal(itemEntry.item.nodeId, nodeEntries.find((row) => row.item.name === "钟楼").item.id);
  assert.equal(itemEntry.item.ownerCharacterId, copy.characters.find((row) => row.name === "顾舟").id);
  assert.equal(positionEntry.item.nodeId, nodeEntries.find((row) => row.item.name === "码头").item.id);
  assert.equal(positionEntry.item.characterId, copy.characters.find((row) => row.name === "顾舟").id);
  // 按依赖顺序还原：地图 → 节点 → 连线/物品/位置；每一步后都不得出现悬空引用。
  db.restoreTrash(mapEntry.id);
  for (const entry of nodeEntries) db.restoreTrash(entry.id);
  const restoredMap = db.book(copyId).atlasMaps.find((row) => row.id === mapEntry.item.id);
  assert.ok(restoredMap, "地图回收项恢复后应回到副本蓝图");
  assert.equal(restoredMap.parentMapId, copy.atlasMaps[0].id);
  db.restoreTrash(edgeEntry.id);
  db.restoreTrash(itemEntry.id);
  db.restoreTrash(positionEntry.id);
  const rebuilt = db.book(copyId);
  assert.ok(rebuilt.atlasEdges.some((row) => row.id === edgeEntry.item.id));
  assert.ok(rebuilt.atlasItems.some((row) => row.id === itemEntry.item.id && row.nodeId));
  assert.ok(rebuilt.atlasPositions.some((row) => row.id === positionEntry.item.id && row.nodeId));
  assertNoDangling(rebuilt);
});

for(const scenario of ['duplicate-place','multiple-worlds','duplicate-item'])test('同步不猜测空间或物品身份：'+scenario,t=>{
 const {db,bookId}=setup(t);
 db.saveAtlas(bookId,{maps:[mapRow(),mapRow({id:'m2',name:'另一个世界'})],nodes:[nodeRow(),nodeRow({id:'n2',mapId:'m2'})],items:scenario==='duplicate-item'?[itemRow(),itemRow({id:'i2',nodeId:'n2'})]:[]});
 const body='顾舟在旧钟楼拿着铜钥匙。';const c=db.updateChapter(db.book(bookId).chapters[0].id,{body},1);
 const change=scenario==='duplicate-place'?{kind:'position',subject:'顾舟',value:'旧钟楼'}:scenario==='multiple-worlds'?{kind:'place',subject:'新地点',value:'正文明确出现的地点'}:{kind:'item',subject:'铜钥匙',target:'顾舟',value:'顾舟'};
 const changes=sync.parse(JSON.stringify({changes:[{...change,evidence:body}]}),body);
 const before=db.book(bookId);
 db.putJob({id:'ambiguity-job',bookId,chapterId:c.id,kind:'write',output:body,status:'done',adopted:true,review:{status:'ready',bodyHash:sync.hash(body),revision:c.revision,signature:contextSignature(before,c),changes}});
 assert.throws(()=>sync.apply(db,'ambiguity-job',changes),scenario==='duplicate-place'?/地点重名/:scenario==='multiple-worlds'?/独立地图/:/物品重名/);
 assert.deepEqual(db.book(bookId).atlasPositions,before.atlasPositions);assert.deepEqual(db.book(bookId).atlasItems,before.atlasItems);assert.equal(db.book(bookId).chapters[0].status,'draft');
});
