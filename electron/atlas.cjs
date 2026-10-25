// 知识蓝图（Atlas）数据层：地图 / 节点 / 连线 / 物品归属 / 人物位置。
// 所有记录都来自作者资料或已定稿正文；planned 只表示计划，不是已经发生的事实。
const { randomUUID } = require("node:crypto");

const LIMITS = Object.freeze({
  maps: 48,
  nodes: 240,
  edges: 320,
  items: 200,
  positions: 300,
});
const MAP_KINDS = Object.freeze(["world", "region", "site", "building", "floor"]);
const NODE_KINDS = Object.freeze([
  "region",
  "settlement",
  "landmark",
  "building",
  "room",
  "object",
]);
const EDGE_KINDS = Object.freeze(["contain", "route", "portal", "link"]);
const STATUSES = Object.freeze(["fixed", "provisional", "planned"]);
const POSITION_STATUSES = Object.freeze(["present", "mentioned", "planned"]);
const THEMES = Object.freeze(["ink", "parchment", "nocturne", "frost"]);
const COLLECTIONS = Object.freeze({
  maps: { field: "atlasMaps", label: "地图", limit: LIMITS.maps },
  nodes: { field: "atlasNodes", label: "节点", limit: LIMITS.nodes },
  edges: { field: "atlasEdges", label: "连线", limit: LIMITS.edges },
  items: { field: "atlasItems", label: "物品", limit: LIMITS.items },
  positions: { field: "atlasPositions", label: "人物位置", limit: LIMITS.positions },
});
const ATLAS_FIELDS = Object.freeze(Object.values(COLLECTIONS).map((meta) => meta.field));

const fail = (message) => {
  throw Error(message);
};
const isObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const arr = (value) => (Array.isArray(value) ? value : []);

function optionalText(value, max, message) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > max) fail(message);
  return value;
}
function requiredText(value, max, message) {
  const text = optionalText(value, max, message).trim();
  if (!text) fail(message);
  return text;
}
function enumValue(value, list, fallback, message) {
  if (value === undefined || value === null || value === "") return fallback;
  if (!list.includes(value)) fail(message);
  return value;
}
function integer(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}
function clampCoordinate(value) {
  return Math.min(1000, Math.max(0, Math.round(value * 100) / 100));
}
function coordinate(value, axis) {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail("节点 " + axis + " 坐标必须是 0–1000 之间的有限数字");
  return clampCoordinate(value);
}
function rowId(raw, label) {
  if (raw.id === undefined || raw.id === null || raw.id === "") return randomUUID();
  const id = optionalText(raw.id, 100, label + "编号格式不正确");
  return id.trim() ? id : randomUUID();
}
function byId(rows) {
  return new Map(
    arr(rows)
      .filter(isObject)
      .map((row) => [row.id, row]),
  );
}
// 「新建节点自动落位」：在 0–1000 画布上找空位，满格后用黄金角散开。
function autoPosition(nodes, mapId) {
  const placed = arr(nodes).filter(
    (node) => node && node.mapId === mapId && Number.isFinite(node.x) && Number.isFinite(node.y),
  );
  const occupied = new Set(
    placed.map((node) => Math.round(node.x / 120) + "," + Math.round(node.y / 120)),
  );
  for (let row = 0; row < 8; row += 1)
    for (let column = 0; column < 8; column += 1) {
      const x = 100 + column * 115;
      const y = 100 + row * 110;
      const key = Math.round(x / 120) + "," + Math.round(y / 120);
      if (!occupied.has(key)) return { x, y };
    }
  const index = placed.length;
  const angle = index * 2.399963229728653;
  const radius = 150 + 42 * Math.sqrt(index);
  return {
    x: clampCoordinate(500 + Math.cos(angle) * radius),
    y: clampCoordinate(500 + Math.sin(angle) * radius),
  };
}
// 来源章节必须存在；修改/删除章节前由 invalidateAtlas 标 stale。
// 作者可以先给记录标上尚未定稿的章节（界面默认「截至章节」），这类记录仍可保存，
// 但生成上下文会按「来源未定稿」排除并计入 staleCount，定稿后才作为事实生效。
function checkSource(row, oldRow, chapterById, label) {
  if (!row.chapterId || !chapterById) return;
  const sameRef = !!oldRow && oldRow.chapterId === row.chapterId;
  if (!chapterById.has(row.chapterId)) {
    if (sameRef) {
      row.stale = true;
      return;
    }
    fail(label + "的来源章节不存在，请重新选择来源章节或清空来源");
  }
}
function normalizeMaps(rows, strict, oldRows, chapterById) {
  const oldById = byId(oldRows);
  const result = [];
  const ids = new Set();
  for (const raw of rows) {
    if (!isObject(raw)) fail("地图数据格式无效");
    const id = rowId(raw, "地图");
    if (ids.has(id)) fail("地图编号重复：" + id);
    ids.add(id);
    const row = {
      id,
      name: requiredText(raw.name, 60, "地图名称不能为空且不超过 60 字"),
      kind: enumValue(
        raw.kind,
        MAP_KINDS,
        "world",
        "地图类型无效，请选择世界/区域/场景/建筑/楼层",
      ),
      parentMapId: optionalText(raw.parentMapId, 100, "上级地图编号格式不正确"),
      entryNodeId: optionalText(raw.entryNodeId, 100, "入口地点编号格式不正确"),
      description: optionalText(raw.description, 800, "地图描述最多 800 字"),
      theme: enumValue(raw.theme, THEMES, "ink", "地图主题无效，请选择 ink/parchment/nocturne/frost"),
      status: enumValue(raw.status, STATUSES, "fixed", "地图状态无效，请选择 fixed/provisional/planned"),
      chapterId: optionalText(raw.chapterId, 100, "地图来源章节编号格式不正确"),
      order: integer(raw.order, result.length),
      stale: raw.stale === true,
    };
    if (raw.evidence !== undefined)
      row.evidence = optionalText(raw.evidence, 200000, "地图证据格式不正确");
    checkSource(row, oldById.get(id), chapterById, "地图");
    result.push(row);
  }
  const mapById = new Map(result.map((row) => [row.id, row]));
  for (const row of result) {
    if (!row.parentMapId) continue;
    if (row.parentMapId === row.id) fail("地图不能以自己为上级地图");
    if (!mapById.has(row.parentMapId)) {
      const old = oldById.get(row.id);
      if (strict && !(old && old.parentMapId === row.parentMapId))
        fail("上级地图不存在：" + row.parentMapId);
      row.parentMapId = "";
    }
  }
  for (const row of result) {
    const seen = new Set([row.id]);
    let parent = row.parentMapId ? mapById.get(row.parentMapId) : null;
    while (parent) {
      if (seen.has(parent.id)) fail("地图上下级关系不能循环，请调整上级地图");
      seen.add(parent.id);
      parent = parent.parentMapId ? mapById.get(parent.parentMapId) : null;
    }
  }
  return result;
}
function normalizeNodes(rows, strict, oldRows, mapIds, chapterById) {
  const oldById = byId(oldRows);
  const result = [];
  const ids = new Set();
  for (const raw of rows) {
    if (!isObject(raw)) fail("节点数据格式无效");
    const id = rowId(raw, "节点");
    if (ids.has(id)) fail("节点编号重复：" + id);
    ids.add(id);
    const old = oldById.get(id);
    const mapId = optionalText(raw.mapId, 100, "节点所属地图编号格式不正确");
    if (!mapId || !mapIds.has(mapId)) {
      if (strict && !(old && old.mapId === mapId))
        fail("节点所属地图不存在，请先创建或选择地图");
      // 地图连同节点一起删除时级联移除节点。
      continue;
    }
    const row = {
      id,
      mapId,
      parentId: optionalText(raw.parentId, 100, "上级节点编号格式不正确"),
      kind: enumValue(
        raw.kind,
        NODE_KINDS,
        "landmark",
        "节点类型无效，请选择区域/聚落/地标/建筑/房间/物件",
      ),
      name: requiredText(raw.name, 60, "节点名称不能为空且不超过 60 字"),
      description: optionalText(raw.description, 800, "节点描述最多 800 字"),
      status: enumValue(raw.status, STATUSES, "fixed", "节点状态无效，请选择 fixed/provisional/planned"),
      chapterId: optionalText(raw.chapterId, 100, "节点来源章节编号格式不正确"),
      stale: raw.stale === true,
    };
    const hasX = raw.x !== undefined && raw.x !== null && raw.x !== "";
    const hasY = raw.y !== undefined && raw.y !== null && raw.y !== "";
    if (hasX || hasY) {
      if (hasX !== hasY) fail("节点坐标必须同时提供 x 和 y");
      row.x = coordinate(raw.x, "x");
      row.y = coordinate(raw.y, "y");
    }
    if (raw.evidence !== undefined)
      row.evidence = optionalText(raw.evidence, 200000, "节点证据格式不正确");
    checkSource(row, old, chapterById, "节点");
    result.push(row);
  }
  for (const row of result) if (row.x === undefined) {
    const spot = autoPosition(result.filter((item) => item.x !== undefined), row.mapId);
    row.x = spot.x;
    row.y = spot.y;
  }
  const nodeById = new Map(result.map((row) => [row.id, row]));
  for (const row of result) {
    if (!row.parentId) continue;
    const old = oldById.get(row.id);
    const sameRef = !!old && old.parentId === row.parentId;
    if (row.parentId === row.id) fail("节点不能以自己为上级节点");
    const parent = nodeById.get(row.parentId);
    if (!parent) {
      if (strict && !sameRef) fail("上级节点不存在：" + row.parentId);
      row.parentId = "";
      continue;
    }
    if (parent.mapId !== row.mapId) {
      if (strict && !sameRef) fail("上级节点必须与当前节点位于同一张地图");
      row.parentId = "";
    }
  }
  for (const row of result) {
    const seen = new Set([row.id]);
    let parent = row.parentId ? nodeById.get(row.parentId) : null;
    while (parent) {
      if (seen.has(parent.id)) fail("节点上下级关系不能循环，请调整上级节点");
      seen.add(parent.id);
      parent = parent.parentId ? nodeById.get(parent.parentId) : null;
    }
  }
  return result;
}
function normalizeEdges(rows, strict, oldRows, mapIds, nodeById, chapterById) {
  const oldById = byId(oldRows);
  const result = [];
  const ids = new Set();
  const seenEdges = new Set();
  for (const raw of rows) {
    if (!isObject(raw)) fail("连线数据格式无效");
    const id = rowId(raw, "连线");
    if (ids.has(id)) fail("连线编号重复：" + id);
    ids.add(id);
    const old = oldById.get(id);
    const sourceId = optionalText(raw.source, 100, "连线起点编号格式不正确");
    const targetId = optionalText(raw.target, 100, "连线终点编号格式不正确");
    if (!sourceId || !targetId) {
      if (strict) fail("连线必须指定起点和终点");
      continue;
    }
    if (sourceId === targetId) fail("连线的起点和终点不能是同一个节点");
    const sourceNode = nodeById.get(sourceId);
    const targetNode = nodeById.get(targetId);
    const sameRef = !!old && old.source === sourceId && old.target === targetId;
    if (!sourceNode || !targetNode) {
      if (strict && !sameRef)
        fail("连线端点不存在，请先创建或选择有效节点");
      continue;
    }
    const mapId = optionalText(raw.mapId, 100, "连线所属地图编号格式不正确");
    const mapKey = mapId || sourceNode.mapId;
    if (!mapIds.has(mapKey)) {
      if (strict && !(old && old.mapId === mapKey))
        fail("连线所属地图不存在");
      continue;
    }
    if (
      sourceNode.mapId !== mapKey ||
      targetNode.mapId !== mapKey
    ) {
      if (strict && !(sameRef && old && old.mapId === mapKey))
        fail("连线两端必须位于同一张地图");
      continue;
    }
    const kind = enumValue(
      raw.kind,
      EDGE_KINDS,
      "link",
      "连线类型无效，请选择 contain/route/portal/link",
    );
    const dedupeKey = [mapKey, sourceId, targetId, kind].join("\0");
    if (seenEdges.has(dedupeKey)) continue;
    seenEdges.add(dedupeKey);
    const row = {
      id,
      mapId: mapKey,
      source: sourceId,
      target: targetId,
      kind,
      label: optionalText(raw.label, 80, "连线标签最多 80 字"),
      status: enumValue(raw.status, STATUSES, "fixed", "连线状态无效，请选择 fixed/provisional/planned"),
      chapterId: optionalText(raw.chapterId, 100, "连线来源章节编号格式不正确"),
      stale: raw.stale === true,
    };
    if (raw.evidence !== undefined)
      row.evidence = optionalText(raw.evidence, 200000, "连线证据格式不正确");
    checkSource(row, old, chapterById, "连线");
    result.push(row);
  }
  return result;
}
function normalizeItems(rows, strict, oldRows, nodeById, characterIds, chapterById) {
  const oldById = byId(oldRows);
  const result = [];
  const ids = new Set();
  for (const raw of rows) {
    if (!isObject(raw)) fail("物品数据格式无效");
    const id = rowId(raw, "物品");
    if (ids.has(id)) fail("物品编号重复：" + id);
    ids.add(id);
    const old = oldById.get(id);
    let nodeId = optionalText(raw.nodeId, 100, "物品所在节点编号格式不正确");
    if (nodeId && !nodeById.has(nodeId)) {
      const sameRef = !!old && old.nodeId === nodeId;
      if (strict && !sameRef)
        fail("物品所在节点不存在：" + nodeId);
      nodeId = "";
    }
    let ownerCharacterId = optionalText(
      raw.ownerCharacterId,
      100,
      "物品保管人编号格式不正确",
    );
    if (ownerCharacterId && characterIds && !characterIds.has(ownerCharacterId)) {
      const sameRef = !!old && old.ownerCharacterId === ownerCharacterId;
      if (strict && !sameRef)
        fail("物品保管人不存在，请先创建或选择人物");
      ownerCharacterId = "";
    }
    const row = {
      id,
      name: requiredText(raw.name, 60, "物品名称不能为空且不超过 60 字"),
      description: optionalText(raw.description, 800, "物品描述最多 800 字"),
      nodeId,
      ownerCharacterId,
      status: enumValue(raw.status, STATUSES, "fixed", "物品状态无效，请选择 fixed/provisional/planned"),
      chapterId: optionalText(raw.chapterId, 100, "物品来源章节编号格式不正确"),
      stale: raw.stale === true,
    };
    if (raw.evidence !== undefined)
      row.evidence = optionalText(raw.evidence, 200000, "物品证据格式不正确");
    checkSource(row, old, chapterById, "物品");
    result.push(row);
  }
  return result;
}
function normalizePositions(rows, strict, oldRows, nodeById, characterIds, chapterById) {
  const oldById = byId(oldRows);
  const result = [];
  const ids = new Set();
  for (const raw of rows) {
    if (!isObject(raw)) fail("人物位置数据格式无效");
    const id = rowId(raw, "人物位置");
    if (ids.has(id)) fail("人物位置编号重复：" + id);
    ids.add(id);
    const old = oldById.get(id);
    const characterId = optionalText(raw.characterId, 100, "人物位置的人物编号格式不正确");
    const nodeId = optionalText(raw.nodeId, 100, "人物位置的地点编号格式不正确");
    const sameRef = !!old && old.characterId === characterId && old.nodeId === nodeId;
    if (!characterId) {
      if (strict) fail("人物位置必须指定人物");
      continue;
    }
    if (characterIds && !characterIds.has(characterId)) {
      if (strict && !(old && old.characterId === characterId))
        fail("人物位置引用的人物不存在，请先创建或选择人物");
      continue;
    }
    if (!nodeId || !nodeById.has(nodeId)) {
      if (strict && !(old && old.nodeId === nodeId))
        fail("人物位置引用的地点不存在，请先创建或选择节点");
      continue;
    }
    const row = {
      id,
      characterId,
      nodeId,
      chapterId: optionalText(raw.chapterId, 100, "人物位置来源章节编号格式不正确"),
      status: enumValue(
        raw.status,
        POSITION_STATUSES,
        "present",
        "人物位置状态无效，请选择 present/mentioned/planned",
      ),
      note: optionalText(raw.note, 160, "人物位置备注最多 160 字"),
      stale: raw.stale === true,
    };
    if (raw.evidence !== undefined)
      row.evidence = optionalText(raw.evidence, 200000, "人物位置证据格式不正确");
    checkSource(row, old, chapterById, "人物位置");
    result.push({ row, sameRef });
  }
  // 同一人物的同一章节只保留最后一次位置记录。
  const merged = [];
  const at = new Map();
  for (const item of result) {
    const key = item.row.characterId + "\0" + item.row.chapterId;
    if (at.has(key)) merged[at.get(key)] = item.row;
    else {
      at.set(key, merged.length);
      merged.push(item.row);
    }
  }
  return merged;
}
function readProvided(patch) {
  if (!isObject(patch)) fail("知识蓝图数据格式无效");
  const provided = new Set();
  for (const [short, meta] of Object.entries(COLLECTIONS)) {
    for (const key of new Set([short, meta.field])) {
      if (!Object.hasOwn(patch, key)) continue;
      if (!Array.isArray(patch[key])) fail(meta.label + "数据必须是数组");
      if (patch[key].length > meta.limit)
        fail(meta.label + "数量超过上限 " + meta.limit);
      provided.add(short);
    }
  }
  if (!provided.size) fail("没有需要保存的知识蓝图数据");
  return provided;
}
function patchRows(patch, short) {
  const meta = COLLECTIONS[short];
  if (Object.hasOwn(patch, meta.field)) return patch[meta.field];
  return patch[short];
}
// 严格规范化一份知识蓝图补丁；返回五个集合的完整数组。
// 显式提交的坏引用报中文错误；仅因其他集合删除而悬空的引用做级联修复。
function normalize(book, patch, options = {}) {
  const source = isObject(book) ? book : {};
  const provided = readProvided(patch);
  const strict = options.strict !== false;
  const chapters = Array.isArray(options.chapters)
    ? options.chapters
    : Array.isArray(source.chapters)
      ? source.chapters
      : null;
  const chapterById = chapters
    ? new Map(chapters.filter(isObject).map((row) => [row.id, row]))
    : null;
  const characters = Array.isArray(options.characters)
    ? options.characters
    : Array.isArray(source.characters)
      ? source.characters
      : null;
  const characterIds = characters
    ? new Set(characters.filter(isObject).map((row) => row.id))
    : null;
  const old = Object.fromEntries(
    Object.entries(COLLECTIONS).map(([short, meta]) => [
      short,
      Array.isArray(source[meta.field]) ? source[meta.field] : [],
    ]),
  );
  const values = {};
  for (const [short, meta] of Object.entries(COLLECTIONS))
    values[short] = provided.has(short) ? patchRows(patch, short) : old[short];
  const maps = normalizeMaps(
    values.maps,
    provided.has("maps"),
    old.maps,
    chapterById,
  );
  const mapIds = new Set(maps.map((row) => row.id));
  const nodes = normalizeNodes(
    values.nodes,
    provided.has("nodes"),
    old.nodes,
    mapIds,
    chapterById,
  );
  const nodeById = new Map(nodes.map((row) => [row.id, row]));
  for (const map of maps) {
    if (!map.entryNodeId) continue;
    const entry = nodeById.get(map.entryNodeId);
    if (!entry || entry.mapId !== map.parentMapId) {
      const previous = old.maps.find(row => row.id === map.id);
      if (provided.has('maps') && previous?.entryNodeId !== map.entryNodeId) fail('入口地点必须属于上级地图');
      map.entryNodeId = '';
    }
  }

  const edges = normalizeEdges(
    values.edges,
    provided.has("edges"),
    old.edges,
    mapIds,
    nodeById,
    chapterById,
  );
  const items = normalizeItems(
    values.items,
    provided.has("items"),
    old.items,
    nodeById,
    characterIds,
    chapterById,
  );
  const positions = normalizePositions(
    values.positions,
    provided.has("positions"),
    old.positions,
    nodeById,
    characterIds,
    chapterById,
  );
  return {
    atlasMaps: maps,
    atlasNodes: nodes,
    atlasEdges: edges,
    atlasItems: items,
    atlasPositions: positions,
  };
}
function normalizeState(book, options = {}) {
  const source = isObject(book) ? book : {};
  return normalize(
    source,
    Object.fromEntries(
      Object.values(COLLECTIONS).map((meta) => [meta.field, arr(source[meta.field])]),
    ),
    options,
  );
}
// 修改/删除章节后，把来源章节 order >= 当前章 order 的记录标 stale。
function invalidateAtlas(book, chapter, order) {
  if (!isObject(book) || !isObject(chapter)) return;
  const scope =
    order && typeof order.get === "function"
      ? order
      : Array.isArray(book.chapters)
        ? new Map(book.chapters.map((row) => [row.id, row.order]))
        : null;
  if (!scope) return;
  const cutoff = Number(chapter.order);
  if (!Number.isFinite(cutoff)) return;
  const affected = (chapterId) =>
    !!chapterId && (scope.get(chapterId) ?? -1) >= cutoff;
  for (const meta of Object.values(COLLECTIONS)) {
    const rows = book[meta.field];
    if (!Array.isArray(rows)) continue;
    book[meta.field] = rows.map((row) =>
      isObject(row) && affected(row.chapterId) ? { ...row, stale: true } : row,
    );
  }
}
// 生成上下文：只返回截至本章有效、且引用完整的资料；planned 单独列出。
// includeCurrent=false 用于正文变化分析：只看本章开始前已经生效的记录。
function context(book, chapter, options = {}) {
  const source = isObject(book) ? book : {};
  const includeCurrent = options.includeCurrent !== false;
  const chapters = new Map(
    arr(source.chapters)
      .filter(isObject)
      .map((row) => [row.id, row]),
  );
  const currentOrder = Number(chapter && chapter.order);
  const cutoff = Number.isFinite(currentOrder) ? currentOrder : Number.POSITIVE_INFINITY;
  const classify = (row) => {
    if (!isObject(row)) return "stale";
    if (row.stale === true) return "stale";
    const planned = row.status === "planned";
    if (!row.chapterId) return "active";
    const chapterRow = chapters.get(row.chapterId);
    if (!chapterRow) return "stale";
    const order = Number(chapterRow.order);
    if (Number.isFinite(order) && (includeCurrent ? order > cutoff : order >= cutoff))
      return "future";
    // 计划内容可以来自尚未定稿的章节计划；已确认资料必须来自定稿正文。
    if (!planned && chapterRow.status !== "final") return "stale";
    return "active";
  };
  let staleCount = 0;
  const state = (row) => {
    const value = classify(row);
    if (value === "stale") staleCount += 1;
    return value;
  };
  const rawMapRows = arr(source.atlasMaps).filter(isObject);
  const rawNodeRows = arr(source.atlasNodes).filter(isObject);
  const rawCharacters = new Set(
    arr(source.characters)
      .filter(isObject)
      .map((row) => row.id),
  );
  const rawNodeIds = new Set(rawNodeRows.map((row) => row.id));
  const mapRowById = new Map(rawMapRows.map((row) => [row.id, row]));
  const nodeRowById = new Map(rawNodeRows.map((row) => [row.id, row]));

  // 祖先链继承：planned/stale 沿 parentMapId、parentId 向下传递，循环引用安全。
  const inherit = (value, parentState) => {
    if (value === "stale" || parentState === "stale") return "stale";
    if (parentState === "planned" && value === "active") return "planned";
    if (parentState === "future" && value === "active") return "future";
    return value;
  };
  const mapResolved = new Map();
  const resolvingMaps = new Set();
  const resolveMapState = (id) => {
    if (!id || !mapRowById.has(id)) return null;
    if (mapResolved.has(id)) return mapResolved.get(id);
    if (resolvingMaps.has(id)) return null;
    const row = mapRowById.get(id);
    resolvingMaps.add(id);
    let own = classify(row);
    if (row.status === "planned" && own === "active") own = "planned";
    const parent = resolveMapState(row.parentMapId);
    const result = { row, state: parent ? inherit(own, parent.state) : own };
    resolvingMaps.delete(id);
    mapResolved.set(id, result);
    return result;
  };
  for (const row of rawMapRows) resolveMapState(row.id);

  const maps = [];
  const plannedMaps = [];
  const mapState = new Map();
  for (const row of rawMapRows) {
    const value = mapResolved.get(row.id)?.state || "stale";
    mapState.set(row.id, value);
    if (value === "stale") {
      staleCount += 1;
      continue;
    }
    if (value === "future") continue;
    const copy = { ...row };
    if (copy.parentMapId && !mapRowById.has(copy.parentMapId)) copy.parentMapId = "";
    if (value === "planned") plannedMaps.push(copy);
    else maps.push(copy);
  }

  const nodeResolved = new Map();
  const resolvingNodes = new Set();
  const resolveNodeState = (id) => {
    if (!id || !nodeRowById.has(id)) return null;
    if (nodeResolved.has(id)) return nodeResolved.get(id);
    if (resolvingNodes.has(id)) return null;
    const row = nodeRowById.get(id);
    resolvingNodes.add(id);
    let own = classify(row);
    if (row.status === "planned" && own === "active") own = "planned";
    const parent = resolveNodeState(row.parentId);
    let state = parent ? inherit(own, parent.state) : own;
    // 地图是节点的祖先：计划/过期地图下的节点不能当作事实。
    const mapValue = mapState.get(row.mapId);
    if (!mapRowById.has(row.mapId) || mapValue === "stale") state = "stale";
    else state = inherit(state, mapValue);
    resolvingNodes.delete(id);
    const result = { row, state };
    nodeResolved.set(id, result);
    return result;
  };
  for (const row of rawNodeRows) resolveNodeState(row.id);

  const nodes = [];
  const plannedNodes = [];
  const nodeState = new Map();
  const activeNodeById = new Map();
  const plannedNodeById = new Map();
  for (const row of rawNodeRows) {
    const value = nodeResolved.get(row.id)?.state || "stale";
    nodeState.set(row.id, value);
    if (value === "stale") {
      staleCount += 1;
      continue;
    }
    if (value === "future") continue;
    const copy = { ...row };
    if (copy.parentId && !rawNodeIds.has(copy.parentId)) copy.parentId = "";
    if (value === "planned") {
      plannedNodes.push(copy);
      plannedNodeById.set(copy.id, copy);
    } else {
      nodes.push(copy);
      activeNodeById.set(copy.id, copy);
    }
  }

  const edges = [];
  const plannedEdges = [];
  for (const row of arr(source.atlasEdges)) {
    if (!isObject(row)) continue;
    let own = classify(row);
    if (row.status === "planned" && own === "active") own = "planned";
    const mapValue = mapState.get(row.mapId);
    if (!mapRowById.has(row.mapId) || mapValue === "stale") {
      if (!mapRowById.has(row.mapId) || mapValue !== "future") staleCount += 1;
      continue;
    }
    if (mapValue === "future") continue;
    let value = inherit(own, mapValue);
    const sourceState = nodeState.get(row.source);
    const targetState = nodeState.get(row.target);
    if (!sourceState || !targetState) value = "stale";
    else {
      value = inherit(value, sourceState);
      value = inherit(value, targetState);
    }
    if (value === "stale") {
      staleCount += 1;
      continue;
    }
    if (value === "future") continue;
    if (value === "planned") plannedEdges.push({ ...row });
    else edges.push({ ...row });
  }

  const items = [];
  const plannedItems = [];
  for (const row of arr(source.atlasItems)) {
    if (!isObject(row)) continue;
    let own = classify(row);
    if (row.status === "planned" && own === "active") own = "planned";
    if (own === "stale") {
      staleCount += 1;
      continue;
    }
    if (own === "future") continue;
    const copy = { ...row };
    let value = own;
    if (copy.nodeId) {
      const node = nodeResolved.get(copy.nodeId);
      if (node) value = inherit(value, node.state);
      else copy.nodeId = "";
    }
    if (copy.ownerCharacterId && !rawCharacters.has(copy.ownerCharacterId))
      copy.ownerCharacterId = "";
    if (value === "stale") {
      // 物品本身可能仍有独立证据：保留物品，但不再定位到待复核地点。
      // 被排除的是“位置归属”而不是物品本身，因此不计入 staleCount。
      copy.nodeId = "";
      items.push(copy);
      continue;
    }
    if (value === "future") continue;
    if (value === "planned") plannedItems.push(copy);
    else items.push(copy);
  }

  const positions = [];
  const plannedPositions = [];
  for (const row of arr(source.atlasPositions)) {
    if (!isObject(row)) continue;
    let own = classify(row);
    if (row.status === "planned" && own === "active") own = "planned";
    if (own === "stale" || !rawCharacters.has(row.characterId)) {
      staleCount += 1;
      continue;
    }
    if (own === "future") continue;
    const node = nodeResolved.get(row.nodeId);
    if (!node) {
      if (!rawNodeIds.has(row.nodeId)) staleCount += 1;
      continue;
    }
    const value = inherit(own, node.state);
    if (value === "stale") {
      staleCount += 1;
      continue;
    }
    if (value === "future") continue;
    if (value === "planned") plannedPositions.push({ ...row });
    else positions.push({ ...row });
  }
  const planned = {
    maps: plannedMaps,
    nodes: plannedNodes,
    edges: plannedEdges,
    items: plannedItems,
    positions: plannedPositions,
  };
  return {
    maps,
    nodes,
    edges,
    items,
    positions,
    planned,
    staleCount,
    count: maps.length + nodes.length + edges.length + items.length + positions.length,
    plannedCount:
      plannedMaps.length +
      plannedNodes.length +
      plannedEdges.length +
      plannedItems.length +
      plannedPositions.length,
  };
}
function backupText(value, max, fallback = "") {
  return typeof value === "string" && value.length <= max ? value : fallback;
}
function assertBackup(source) {
  const book = isObject(source) ? source : {};
  for (const meta of Object.values(COLLECTIONS)) {
    const rows = book[meta.field];
    if (rows === undefined) continue;
    if (!Array.isArray(rows) || rows.length > meta.limit)
      fail("知识蓝图备份格式无效：" + meta.label + "数量超过限制");
    if (rows.some((row) => !isObject(row)))
      fail("知识蓝图备份格式无效：" + meta.label + "数据损坏");
  }
  return true;
}
// 备份恢复：为五个集合重新生成 ID，并重映射 map/node/character/chapter 引用。
// 断引用按「清空 / 标 stale / 丢弃」处理，旧书或旧备份不会导致恢复失败。
function restoreAtlas(source, maps = {}) {
  const book = isObject(source) ? source : {};
  const chapterMap =
    maps.chapterMap && typeof maps.chapterMap.get === "function"
      ? maps.chapterMap
      : new Map();
  const characterMap =
    maps.characterMap && typeof maps.characterMap.get === "function"
      ? maps.characterMap
      : new Map();
  const mapIdMap = new Map();
  const nodeIdMap = new Map();
  const result = {
    atlasMaps: [],
    atlasNodes: [],
    atlasEdges: [],
    atlasItems: [],
    atlasPositions: [],
  };
  const mapPairs = [];
  for (const raw of arr(book.atlasMaps)) {
    if (!isObject(raw)) continue;
    const id = randomUUID();
    if (typeof raw.id === "string" && raw.id && !mapIdMap.has(raw.id))
      mapIdMap.set(raw.id, id);
    const chapterId = chapterMap.get(raw.chapterId) || "";
    const next = {
      id,
      name: requiredBackupName(raw.name, "未命名地图", 60),
      kind: MAP_KINDS.includes(raw.kind) ? raw.kind : "world",
      parentMapId: "",
      description: backupText(raw.description, 800),
      theme: THEMES.includes(raw.theme) ? raw.theme : "ink",
      status: STATUSES.includes(raw.status) ? raw.status : "fixed",
      chapterId,
      order: integer(raw.order, result.atlasMaps.length),
      stale: raw.stale === true || (!!raw.chapterId && !chapterId),
    };
    if (typeof raw.evidence === "string")
      next.evidence = backupText(raw.evidence, 200000);
    result.atlasMaps.push(next);
    mapPairs.push({ raw, next });
  }
  for (const { raw, next } of mapPairs) {
    const parent = mapIdMap.get(raw.parentMapId);
    next.parentMapId = parent || "";
    if (next.parentMapId === next.id) next.parentMapId = "";
  }
  const nodePairs = [];
  const nodeById = new Map();
  for (const raw of arr(book.atlasNodes)) {
    if (!isObject(raw)) continue;
    const mapId = mapIdMap.get(raw.mapId);
    if (!mapId) continue;
    const id = randomUUID();
    if (typeof raw.id === "string" && raw.id && !nodeIdMap.has(raw.id))
      nodeIdMap.set(raw.id, id);
    const chapterId = chapterMap.get(raw.chapterId) || "";
    let x = Number(raw.x);
    let y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const spot = autoPosition(result.atlasNodes, mapId);
      x = spot.x;
      y = spot.y;
    }
    const next = {
      id,
      mapId,
      parentId: "",
      kind: NODE_KINDS.includes(raw.kind) ? raw.kind : "landmark",
      name: requiredBackupName(raw.name, "未命名地点", 60),
      description: backupText(raw.description, 800),
      x: clampCoordinate(x),
      y: clampCoordinate(y),
      status: STATUSES.includes(raw.status) ? raw.status : "fixed",
      chapterId,
      stale: raw.stale === true || (!!raw.chapterId && !chapterId),
    };
    if (typeof raw.evidence === "string")
      next.evidence = backupText(raw.evidence, 200000);
    result.atlasNodes.push(next);
    nodeById.set(next.id, next);
    nodePairs.push({ raw, next });
  }
  for (const { raw, next } of nodePairs) {
    const parent = nodeById.get(nodeIdMap.get(raw.parentId));
    next.parentId = parent && parent.mapId === next.mapId ? parent.id : "";
  }
  for (const {raw,next} of mapPairs) {
    const entry = nodeById.get(nodeIdMap.get(raw.entryNodeId));
    next.entryNodeId = entry && entry.mapId === next.parentMapId ? entry.id : '';
  }
  const seenEdges = new Set();
  for (const raw of arr(book.atlasEdges)) {
    if (!isObject(raw)) continue;
    const mapId = mapIdMap.get(raw.mapId);
    const sourceId = nodeIdMap.get(raw.source);
    const targetId = nodeIdMap.get(raw.target);
    const sourceNode = sourceId ? nodeById.get(sourceId) : null;
    const targetNode = targetId ? nodeById.get(targetId) : null;
    if (!mapId || !sourceNode || !targetNode) continue;
    if (
      sourceNode.mapId !== mapId ||
      targetNode.mapId !== mapId ||
      sourceNode.id === targetNode.id
    )
      continue;
    const kind = EDGE_KINDS.includes(raw.kind) ? raw.kind : "link";
    const key = [mapId, sourceNode.id, targetNode.id, kind].join("\0");
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    const chapterId = chapterMap.get(raw.chapterId) || "";
    const next = {
      id: randomUUID(),
      mapId,
      source: sourceNode.id,
      target: targetNode.id,
      kind,
      label: backupText(raw.label, 80),
      status: STATUSES.includes(raw.status) ? raw.status : "fixed",
      chapterId,
      stale: raw.stale === true || (!!raw.chapterId && !chapterId),
    };
    if (typeof raw.evidence === "string")
      next.evidence = backupText(raw.evidence, 200000);
    result.atlasEdges.push(next);
  }
  for (const raw of arr(book.atlasItems)) {
    if (!isObject(raw)) continue;
    const nodeId = nodeIdMap.get(raw.nodeId) || "";
    const ownerCharacterId = characterMap.get(raw.ownerCharacterId) || "";
    const chapterId = chapterMap.get(raw.chapterId) || "";
    const next = {
      id: randomUUID(),
      name: requiredBackupName(raw.name, "未命名物品", 60),
      description: backupText(raw.description, 800),
      nodeId: nodeById.has(nodeId) ? nodeId : "",
      ownerCharacterId,
      status: STATUSES.includes(raw.status) ? raw.status : "fixed",
      chapterId,
      stale: raw.stale === true || (!!raw.chapterId && !chapterId),
    };
    if (typeof raw.evidence === "string")
      next.evidence = backupText(raw.evidence, 200000);
    result.atlasItems.push(next);
  }
  const positions = [];
  const positionAt = new Map();
  for (const raw of arr(book.atlasPositions)) {
    if (!isObject(raw)) continue;
    const characterId = characterMap.get(raw.characterId);
    const nodeId = nodeIdMap.get(raw.nodeId);
    if (!characterId || !nodeId || !nodeById.has(nodeId)) continue;
    const chapterId = chapterMap.get(raw.chapterId) || "";
    const next = {
      id: randomUUID(),
      characterId,
      nodeId,
      chapterId,
      status: POSITION_STATUSES.includes(raw.status) ? raw.status : "present",
      note: backupText(raw.note, 160),
      stale: raw.stale === true || (!!raw.chapterId && !chapterId),
    };
    if (typeof raw.evidence === "string")
      next.evidence = backupText(raw.evidence, 200000);
    const key = characterId + "\0" + chapterId;
    if (positionAt.has(key)) positions[positionAt.get(key)] = next;
    else {
      positionAt.set(key, positions.length);
      positions.push(next);
    }
  }
  result.atlasPositions = positions;
  // 供备份恢复同步处理回收站里的蓝图记录：老 ID → 新 ID。
  // 不可枚举：恢复出的书字段仍只有五个集合，旧测试/备份结构不受影响。
  Object.defineProperty(result, "idMaps", {
    value: { mapIdMap, nodeIdMap },
    enumerable: false,
  });
  return result;
}
function requiredBackupName(value, fallback, max) {
  const text = (typeof value === "string" ? value : "").trim().slice(0, max);
  return text || fallback;
}
function installAtlas(Store) {
  Object.assign(Store.prototype, {
    saveAtlas(bookId, patch) {
      const book = this.rawBook(bookId);
      if (book.deletedAt) fail("请先从回收站恢复作品");
      const fields = normalize(book, patch, {
        chapters: this.chapters(bookId),
        characters: book.characters || [],
      });
      Object.assign(book, fields);
      this.putBook(book);
      return this.book(bookId);
    },
  });
}
module.exports = {
  LIMITS,
  MAP_KINDS,
  NODE_KINDS,
  EDGE_KINDS,
  STATUSES,
  POSITION_STATUSES,
  THEMES,
  COLLECTIONS,
  ATLAS_FIELDS,
  normalize,
  normalizeState,
  invalidateAtlas,
  context,
  restoreAtlas,
  assertBackup,
  autoPosition,
  installAtlas,
};
