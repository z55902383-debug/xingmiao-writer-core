const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveAtlas,
  buildAtlasSeed,
  mergeAtlasSeed,
  autoLayoutNodes,
  defaultNodePosition,
  mapLineage,
  onMapLinked,
  descendantMapIds,
  nodeInvolvesChapter,
  clampAtlasCoord,
  ATLAS_COORD_MIN,
  ATLAS_COORD_MAX,
  ATLAS_LIMITS,
  ATLAS_MAP_KIND_LABELS,
  ATLAS_NODE_KIND_LABELS,
  ATLAS_EDGE_KIND_LABELS,
  ATLAS_STATUS_LABELS,
  ATLAS_POSITION_STATUS_LABELS,
  ATLAS_THEMES,
} = require("../src/atlasModel.ts");

const baseBook = () => ({
  id: "book",
  title: "雾港",
  genre: "悬疑",
  premise: "雾里的港口。",
  outline: "",
  world: "雾港是一座被海雾包围的港城。",
  style: "",
  reference: "",
  referenceName: "",
  target: 0,
  archived: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  candidates: [],
  characters: [
    { id: "c-a", name: "甲", role: "", description: "" },
    { id: "c-b", name: "乙", role: "", description: "" },
  ],
  chapters: [
    { id: "ch1", bookId: "book", title: "第一章", outline: "", body: "", status: "final", revision: 1, order: 1, updatedAt: "" },
    { id: "ch2", bookId: "book", title: "第二章", outline: "", body: "", status: "draft", revision: 1, order: 2, updatedAt: "" },
    { id: "ch3", bookId: "book", title: "第三章", outline: "", body: "", status: "final", revision: 1, order: 3, updatedAt: "" },
  ],
  // 记忆：甲在第一章出现在雾港；乙在（未定稿的）第二章守在灯塔；第三条对象不是地点。
  memories: [
    { id: "m1", subject: "甲", relation: "位置", object: "雾港", evidence: "甲走进雾港。", sourceChapterId: "ch1", sourceRevision: 1, stale: false, createdAt: "" },
    { id: "m2", subject: "乙", relation: "所在", object: "灯塔", evidence: "乙守在灯塔。", sourceChapterId: "ch2", sourceRevision: 1, stale: false, createdAt: "" },
    { id: "m3", subject: "甲", relation: "位置", object: "青铜钥匙", evidence: "", sourceChapterId: "", sourceRevision: 0, stale: false, createdAt: "" },
  ],
  worldRecords: [
    { id: "w1", category: "城市", title: "雾港", description: "港口城市。", certainty: "fixed" },
    { id: "w2", category: "建筑", title: "灯塔", description: "港口灯塔。", certainty: "provisional" },
    { id: "w3", category: "物品", title: "青铜钥匙", description: "开旧城门的钥匙。", certainty: "fixed" },
    { id: "w4", category: "规则", title: "潮汐规则", description: "涨潮时封路。", certainty: "fixed" },
  ],
  atlasMaps: [],
  atlasNodes: [],
  atlasEdges: [],
  atlasItems: [],
  atlasPositions: [],
});

const atlasBook = () => {
  const book = baseBook();
  return {
        ...book,
        atlasMaps: [
          { id: "map-world", name: "世界", kind: "world", parentMapId: "", description: "", theme: "ink", status: "fixed", chapterId: "", order: 0 },
          { id: "map-region", name: "雾港城区", kind: "region", parentMapId: "map-world", description: "", theme: "parchment", status: "fixed", chapterId: "ch1", order: 1 },
          { id: "map-future", name: "旧城", kind: "site", parentMapId: "map-world", description: "", theme: "nocturne", status: "fixed", chapterId: "ch3", order: 2 },
          { id: "map-orphan", name: "独立板块", kind: "world", parentMapId: "missing-parent", description: "", theme: "frost", status: "fixed", chapterId: "", order: 3 },
        ],
        atlasNodes: [
          { id: "n-fixed", mapId: "map-world", parentId: "", kind: "region", name: "雾港", description: "", x: 200, y: 200, status: "fixed", chapterId: "" },
          { id: "n-confirmed", mapId: "map-world", parentId: "n-fixed", kind: "settlement", name: "码头", description: "", x: 400, y: 200, status: "fixed", chapterId: "ch1" },
          { id: "n-future", mapId: "map-world", parentId: "", kind: "landmark", name: "旧城", description: "", x: 600, y: 200, status: "fixed", chapterId: "ch3" },
          { id: "n-planned", mapId: "map-world", parentId: "", kind: "building", name: "计划中的塔", description: "", x: 800, y: 200, status: "planned", chapterId: "" },
          { id: "n-provisional", mapId: "map-world", parentId: "", kind: "building", name: "临时住处", description: "", x: 200, y: 400, status: "provisional", chapterId: "" },
          { id: "n-stale-flag", mapId: "map-world", parentId: "", kind: "room", name: "旧仓库", description: "", x: 400, y: 400, status: "fixed", chapterId: "", stale: true },
          { id: "n-draft", mapId: "map-region", parentId: "", kind: "room", name: "未定稿的房间", description: "", x: 600, y: 400, status: "fixed", chapterId: "ch2" },
          { id: "n-lost-chapter", mapId: "map-world", parentId: "", kind: "object", name: "失去来源的物件", description: "", x: 800, y: 400, status: "fixed", chapterId: "deleted-chapter" },
          { id: "n-hidden-map", mapId: "map-future", parentId: "", kind: "settlement", name: "旧城街区", description: "", x: 200, y: 600, status: "fixed", chapterId: "" },
        ],
        atlasEdges: [
          { id: "e-confirmed", mapId: "map-world", source: "n-fixed", target: "n-confirmed", kind: "contain", label: "包含", status: "fixed", chapterId: "ch1" },
          { id: "e-future", mapId: "map-world", source: "n-fixed", target: "n-future", kind: "route", label: "通往", status: "fixed", chapterId: "ch3" },
          { id: "e-dangling", mapId: "map-world", source: "n-fixed", target: "n-missing", kind: "link", label: "悬空", status: "fixed", chapterId: "" },
          { id: "e-stale", mapId: "map-world", source: "n-stale-flag", target: "n-fixed", kind: "portal", label: "后门", status: "fixed", chapterId: "", stale: true },
        ],
        atlasItems: [
          { id: "i-confirmed", name: "信", description: "", nodeId: "n-fixed", ownerCharacterId: "", status: "fixed", chapterId: "ch1" },
          { id: "i-unlocated", name: "未定位物品", description: "", nodeId: "", ownerCharacterId: "c-a", status: "fixed", chapterId: "" },
          { id: "i-planned", name: "计划物品", description: "", nodeId: "n-fixed", ownerCharacterId: "", status: "planned", chapterId: "" },
          { id: "i-future", name: "未来物品", description: "", nodeId: "n-fixed", ownerCharacterId: "", status: "fixed", chapterId: "ch3" },
          { id: "i-hidden-node", name: "旧城物品", description: "", nodeId: "n-future", ownerCharacterId: "", status: "fixed", chapterId: "" },
        ],
        atlasPositions: [
          { id: "p-present", characterId: "c-a", nodeId: "n-fixed", chapterId: "ch1", status: "present", note: "" },
          { id: "p-future", characterId: "c-b", nodeId: "n-future", chapterId: "ch3", status: "present", note: "" },
          { id: "p-planned", characterId: "c-b", nodeId: "n-fixed", chapterId: "", status: "planned", note: "" },
          { id: "p-stale", characterId: "c-a", nodeId: "n-stale-flag", chapterId: "", status: "present", note: "", stale: true },
        ],
      };
};

const ids = (items) => items.map((item) => item.id).sort();

test("截至某章：固定/已确认/待确认可见，计划与未来只在显示计划时出现", () => {
  const book = atlasBook();
  const snapshot = JSON.stringify(book);
  const view = resolveAtlas(book, "ch1");
  assert.equal(view.cutoff, 1);
  assert.equal(view.chapterTitle, "第一章");
  assert.deepEqual(ids(view.maps), ["map-orphan", "map-region", "map-world"]);
  assert.ok(!view.maps.some((map) => map.id === "map-future"));
  assert.equal(view.maps.find((map) => map.id === "map-region").state, "confirmed");
  assert.equal(view.maps.find((map) => map.id === "map-world").state, "fixed");
  assert.ok(!view.nodes.some((node) => node.id === "n-future"), "未来节点不算已发生");
  assert.ok(!view.nodes.some((node) => node.id === "n-planned"), "计划节点不算已发生");
  assert.deepEqual(ids(view.nodes), [
    "n-confirmed",
    "n-fixed",
    "n-lost-chapter",
    "n-provisional",
    "n-stale-flag",
  ]);
  assert.equal(view.nodes.find((node) => node.id === "n-fixed").state, "fixed");
  assert.equal(view.nodes.find((node) => node.id === "n-confirmed").state, "confirmed");
  assert.equal(view.nodes.find((node) => node.id === "n-provisional").state, "provisional");
  assert.equal(view.nodes.find((node) => node.id === "n-stale-flag").state, "stale");
  assert.equal(view.nodes.find((node) => node.id === "n-lost-chapter").state, "stale", "来源章节删除算待复核");
  assert.ok(!view.nodes.some((node) => node.id === "n-draft"), "第二章还未发生，属于未来资料");
  assert.equal(JSON.stringify(book), snapshot, "投影不得修改传入的 Book");
});

test("计划与待复核单独计数，悬空连线与被隐藏地图的节点不会漏出来", () => {
  const view = resolveAtlas(atlasBook(), "ch1");
  assert.equal(view.stats.nodes, 5);
  assert.equal(view.stats.staleNodes, 2);
  assert.equal(view.stats.hiddenNodes, 4, "未来节点、计划节点、未来地图下的节点、未来章节的房间");
  assert.equal(view.stats.futureNodes, 2);
  assert.equal(view.stats.plannedNodes, 0);
  assert.equal(view.stats.hiddenMaps, 1);
  assert.equal(view.stats.futureMaps, 1);
  assert.deepEqual(ids(view.edges), ["e-confirmed", "e-stale"]);
  assert.equal(view.stats.staleEdges, 1);
  assert.equal(view.stats.hiddenEdges, 2, "未来连线与悬空连线");
  assert.deepEqual(ids(view.items), ["i-confirmed", "i-unlocated"]);
  assert.equal(view.stats.hiddenItems, 3);
  assert.deepEqual(ids(view.positions), ["p-present", "p-stale"]);
  assert.equal(view.stats.stalePositions, 1);
  assert.equal(view.stats.hiddenPositions, 2);
});

test("显示计划后，计划与未来资料进入结果且状态仍为计划", () => {
  const view = resolveAtlas(atlasBook(), "ch1", { showPlans: true });
  assert.ok(view.nodes.some((node) => node.id === "n-future" && node.state === "planned"));
  assert.ok(view.nodes.some((node) => node.id === "n-planned" && node.state === "planned"));
  assert.ok(view.maps.some((map) => map.id === "map-future" && map.state === "planned"));
  assert.ok(view.nodes.some((node) => node.id === "n-hidden-map"));
  assert.ok(view.edges.some((edge) => edge.id === "e-future" && edge.state === "planned"));
  assert.ok(!view.edges.some((edge) => edge.id === "e-dangling"), "悬空连线永远不显示");
  assert.ok(view.items.some((item) => item.id === "i-planned" && item.state === "planned"));
  assert.ok(view.items.some((item) => item.id === "i-future" && item.state === "planned"));
  assert.ok(view.positions.some((position) => position.id === "p-future" && position.state === "planned"));
  assert.ok(view.positions.some((position) => position.id === "p-planned" && position.state === "planned"));
  assert.equal(view.stats.hiddenNodes, 0);
  assert.equal(view.stats.hiddenEdges, 1, "只剩悬空连线被过滤");
  assert.equal(view.stats.plannedNodes, 4, "两张计划节点 + 未来章节的房间 + 未来地图里的地点");
  assert.equal(view.stats.hiddenPositions, 0);
});

test("截至章节靠后或为空时，状态随时间线推进", () => {
  const atThird = resolveAtlas(atlasBook(), "ch3");
  assert.equal(atThird.cutoff, 3);
  assert.equal(atThird.nodes.find((node) => node.id === "n-future").state, "confirmed");
  assert.equal(atThird.edges.find((edge) => edge.id === "e-future").state, "confirmed");
  assert.equal(atThird.nodes.find((node) => node.id === "n-draft").state, "stale", "第二章仍未定稿");
  const before = resolveAtlas(atlasBook(), "");
  assert.equal(before.cutoff, 0);
  assert.ok(!before.nodes.some((node) => node.id === "n-confirmed"), "故事开始前不显示第一章资料");
  assert.ok(before.nodes.some((node) => node.id === "n-fixed"));
  const missing = resolveAtlas(atlasBook(), "no-such-chapter");
  assert.equal(missing.cutoff, -1);
  assert.equal(missing.chapterId, "");
  assert.ok(!missing.nodes.some((node) => node.id === "n-confirmed"));
  assert.ok(missing.nodes.some((node) => node.id === "n-stale-flag"));
});

test("旧书没有 atlas 字段时投影安全返回空结果", () => {
  const legacy = {
    ...baseBook(),
    atlasMaps: undefined,
    atlasNodes: undefined,
    atlasEdges: undefined,
    atlasItems: undefined,
    atlasPositions: undefined,
  };
  const view = resolveAtlas(legacy, "ch1", { showPlans: true });
  assert.deepEqual(view.maps, []);
  assert.deepEqual(view.nodes, []);
  assert.equal(view.stats.nodes, 0);
  assert.deepEqual(view.roots, []);
});

test("从现有资料归纳：只使用已有资料、结果稳定、不编造世界资料", () => {
  const book = baseBook();
  const seed = buildAtlasSeed(book);
  assert.equal(seed.maps.length, 1);
  assert.equal(seed.maps[0].name, "世界地图");
  assert.ok(seed.maps[0].description.includes("海雾"), "地图描述来自作品世界设定");
  assert.deepEqual(seed.nodes.map((node) => node.name).sort(), ["灯塔", "雾港"]);
  assert.deepEqual(seed.items.map((item) => item.name), ["青铜钥匙"]);
  assert.ok(!seed.nodes.some((node) => node.name === "潮汐规则"), "无法归类的规则不硬塞成地点");
  assert.ok(!seed.edges.length);
  assert.deepEqual(
    seed.positions.map((position) => [position.characterId, position.nodeId, position.chapterId]),
    [
      ["c-a", seed.nodes.find((node) => node.name === "雾港").id, "ch1"],
      ["c-b", seed.nodes.find((node) => node.name === "灯塔").id, "ch2"],
    ],
  );
  assert.equal(seed.positions[0].status, "present");
  assert.ok(seed.positions[0].note.includes("甲"), "备注来自记忆证据而不是正文");
  // 节点确实落在地图坐标内，且不是全部叠在中心。
  for (const node of seed.nodes) {
    assert.ok(node.x >= ATLAS_COORD_MIN && node.x <= ATLAS_COORD_MAX);
    assert.ok(node.y >= ATLAS_COORD_MIN && node.y <= ATLAS_COORD_MAX);
  }
  const pairs = new Set(seed.nodes.map((node) => `${node.x}:${node.y}`));
  assert.equal(pairs.size, seed.nodes.length);
  // 与输入顺序无关，重复调用完全一致。
  const shuffled = {
    ...book,
    worldRecords: [...book.worldRecords].reverse(),
    memories: [...book.memories].reverse(),
  };
  assert.deepEqual(buildAtlasSeed(shuffled), seed);
  assert.deepEqual(buildAtlasSeed(book), seed);
});

test("把归纳结果并入现有蓝图是幂等的，不覆盖作者已改的资料", () => {
  const book = baseBook();
  const first = mergeAtlasSeed(book);
  const second = mergeAtlasSeed({ ...book, ...first });
  assert.deepEqual(second, first);
  assert.ok(first.atlasMaps.length === 1);
  const edited = {
    ...book,
    atlasMaps: [{ ...first.atlasMaps[0], name: "作者改过的世界" }],
  };
  const merged = mergeAtlasSeed(edited, buildAtlasSeed(book));
  assert.equal(merged.atlasMaps.length, 1);
  assert.equal(merged.atlasMaps[0].name, "作者改过的世界");
  assert.equal(merged.atlasNodes.length, first.atlasNodes.length);
});

test("网格自动整理：只重排目标地图，位置在范围内且可重复", () => {
  const nodes = [
    { id: "a1", mapId: "map-a", parentId: "", kind: "room", name: "甲", description: "", x: 0, y: 0, status: "fixed", chapterId: "" },
    { id: "a2", mapId: "map-a", parentId: "", kind: "building", name: "乙", description: "", x: 0, y: 0, status: "fixed", chapterId: "" },
    { id: "a3", mapId: "map-a", parentId: "", kind: "region", name: "丙", description: "", x: 0, y: 0, status: "fixed", chapterId: "" },
    { id: "b1", mapId: "map-b", parentId: "", kind: "room", name: "丁", description: "", x: 33, y: 44, status: "fixed", chapterId: "" },
  ];
  const arranged = autoLayoutNodes(nodes, "map-a");
  const again = autoLayoutNodes(nodes, "map-a");
  assert.deepEqual(arranged, again);
  assert.deepEqual(arranged.find((node) => node.id === "b1"), nodes[3], "其他地图的节点原样返回");
  const placed = arranged.filter((node) => node.mapId === "map-a");
  for (const node of placed) {
    assert.ok(node.x >= ATLAS_COORD_MIN && node.x <= ATLAS_COORD_MAX);
    assert.ok(node.y >= ATLAS_COORD_MIN && node.y <= ATLAS_COORD_MAX);
  }
  assert.equal(new Set(placed.map((node) => `${node.x}:${node.y}`)).size, 3);
  const bounds = autoLayoutNodes(
    Array.from({ length: 120 }, (_, index) => ({
      id: `n${index}`,
      mapId: "m",
      parentId: "",
      kind: "room",
      name: `节点${index}`,
      description: "",
      x: 0,
      y: 0,
      status: "fixed",
      chapterId: "",
    })),
    "m",
  );
  assert.ok(bounds.every((node) => node.x >= 0 && node.x <= ATLAS_COORD_MAX && node.y >= 0 && node.y <= ATLAS_COORD_MAX));
});

test("新增节点默认落点避开已有节点，并保持在坐标范围内", () => {
  const nodes = [
    { id: "a", mapId: "m", parentId: "", kind: "room", name: "甲", description: "", x: 150, y: 150, status: "fixed", chapterId: "" },
    { id: "b", mapId: "m", parentId: "", kind: "room", name: "乙", description: "", x: 850, y: 150, status: "fixed", chapterId: "" },
    { id: "c", mapId: "m", parentId: "", kind: "room", name: "丙", description: "", x: 150, y: 850, status: "fixed", chapterId: "" },
  ];
  const point = defaultNodePosition(nodes, "m");
  assert.deepEqual(defaultNodePosition(nodes, "m"), point);
  assert.ok(point.x >= ATLAS_COORD_MIN && point.x <= ATLAS_COORD_MAX);
  assert.ok(point.y >= ATLAS_COORD_MIN && point.y <= ATLAS_COORD_MAX);
  assert.ok(nodes.every((node) => Math.abs(node.x - point.x) >= 10 || Math.abs(node.y - point.y) >= 10));
  const empty = defaultNodePosition([], "m");
  assert.equal(empty.x, 150);
  assert.equal(empty.y, 150);
  assert.equal(clampAtlasCoord(-20), 0);
  assert.equal(clampAtlasCoord(1200), 1000);
});

test("地图层级：父在前子在后，断链当地图根，循环引用不死循环", () => {
  const maps = [
    { id: "world", name: "世界", kind: "world", parentMapId: "", description: "", theme: "ink", status: "fixed", chapterId: "", order: 0 },
    { id: "region", name: "区域", kind: "region", parentMapId: "world", description: "", theme: "ink", status: "fixed", chapterId: "", order: 0 },
    { id: "site", name: "地点", kind: "site", parentMapId: "region", description: "", theme: "ink", status: "fixed", chapterId: "", order: 0 },
    { id: "second", name: "第二世界", kind: "world", parentMapId: "", description: "", theme: "ink", status: "fixed", chapterId: "", order: 1 },
    { id: "orphan", name: "断链", kind: "world", parentMapId: "missing", description: "", theme: "ink", status: "fixed", chapterId: "", order: 2 },
  ];
  const lineage = mapLineage(maps);
  assert.deepEqual(lineage.map((entry) => entry.map.id), ["world", "region", "site", "second", "orphan"]);
  assert.deepEqual(lineage.map((entry) => entry.depth), [0, 1, 2, 0, 0]);
  assert.equal(lineage[2].rootId, "world");
  assert.equal(lineage[2].rootName, "世界");
  const cyclic = [
    { id: "x", name: "X", kind: "region", parentMapId: "y", description: "", theme: "ink", status: "fixed", chapterId: "", order: 0 },
    { id: "y", name: "Y", kind: "region", parentMapId: "x", description: "", theme: "ink", status: "fixed", chapterId: "", order: 1 },
  ];
  assert.equal(mapLineage(cyclic).length, 2);
  assert.deepEqual(onMapLinked(maps, "region").map((map) => map.id), ["world", "site"]);
  assert.deepEqual(onMapLinked(maps, "world").map((map) => map.id), ["region", "site"]);
  assert.deepEqual(onMapLinked(maps, "second"), []);
  assert.deepEqual(onMapLinked(maps, "missing"), []);
  assert.deepEqual(descendantMapIds(maps, "world"), ["region", "site"]);
  assert.deepEqual(descendantMapIds(maps, "site"), []);
  assert.ok(nodeInvolvesChapter("node", "ch1", [], [{ id: "p", characterId: "c", nodeId: "node", chapterId: "ch1", status: "present", note: "" }]));
  assert.ok(!nodeInvolvesChapter("node", "", [], []));
});

test("中文标签常量与上限覆盖全部类型，英文由界面层翻译", () => {
  for (const [kind, label] of Object.entries(ATLAS_MAP_KIND_LABELS)) assert.ok(kind && label);
  for (const [kind, label] of Object.entries(ATLAS_NODE_KIND_LABELS)) assert.ok(kind && label);
  for (const [kind, label] of Object.entries(ATLAS_EDGE_KIND_LABELS)) assert.ok(kind && label);
  for (const [status, label] of Object.entries(ATLAS_STATUS_LABELS)) assert.ok(status && label);
  for (const [status, label] of Object.entries(ATLAS_POSITION_STATUS_LABELS)) assert.ok(status && label);
  assert.deepEqual(ATLAS_THEMES, ["ink", "parchment", "nocturne", "frost"]);
  assert.ok(ATLAS_LIMITS.nodes > 0 && ATLAS_LIMITS.maps > 0 && ATLAS_LIMITS.positions > 0);
});
