/* 知识蓝图（Atlas）纯函数层。
 *
 * 这里只做「从 Book 资料投影出可渲染的地图数据」与「从现有资料归纳初始蓝图」，
 * 不读写磁盘、不调用 AI、不修改传入的 Book。组件与 Node 单测都直接使用这些函数。
 *
 * 时间线规则与 canvasModel.ts 一致：
 * - 没有来源章节的资料 = 作者固定设定，始终有效；
 * - 来源章节在截至章节之前（含）且已定稿 = 已确认；
 * - 来源章节在未来 / 计划中（planned）= 计划，只有 showPlans 打开时才显示；
 * - 来源章节缺失、未定稿，或资料被标记 stale = 待复核，单独建状态并计数；
 * - 待确认（provisional）与已确认区分，但属于已经写下的资料，不算「未来」。
 */
import type {
  AtlasEdge,
  AtlasItem,
  AtlasMap,
  AtlasMapKind,
  AtlasNode,
  AtlasNodeKind,
  AtlasPosition,
  AtlasPositionStatus,
  AtlasStatus,
  Book,
} from "./types";

/* ------------------------------------------------------------------ 常量 */

export const ATLAS_LIMITS = {
  maps: 48,
  nodes: 240,
  nodesPerMap: 120,
  edges: 320,
  edgesPerMap: 160,
  items: 200,
  positions: 300,
  name: 60,
  description: 800,
  label: 80,
  note: 160,
} as const;

/** 地图坐标空间：0–1000 的正方形，渲染时按 viewBox 缩放。 */
export const ATLAS_COORD_MIN = 0;
export const ATLAS_COORD_MAX = 1000;
/** 节点外接盒尺寸（SVG 本地坐标，中心点即节点坐标）。 */
export const ATLAS_NODE_WIDTH = 168;
export const ATLAS_NODE_HEIGHT = 72;
export const ATLAS_NODE_SIZES: Record<AtlasNodeKind, { width: number; height: number }> = {
  region: { width: 190, height: 86 },
  settlement: { width: 168, height: 78 },
  landmark: { width: 168, height: 84 },
  building: { width: 168, height: 74 },
  room: { width: 132, height: 64 },
  object: { width: 120, height: 58 },
};
/** 自动落位时留给节点边缘的空白，避免标签贴到地图边框。 */
export const ATLAS_LAYOUT_PADDING = 150;
export const ATLAS_LAYOUT_COLUMNS = 4;
/** 判断「位置已被占用」的最小中心距。 */
const ATLAS_SLOT_DISTANCE = 118;

export const ATLAS_THEMES = ["ink", "parchment", "nocturne", "frost"] as const;
export type AtlasTheme = (typeof ATLAS_THEMES)[number];

export const ATLAS_MAP_KINDS = ["world", "region", "site", "building", "floor"] as const;
export const ATLAS_NODE_KINDS = ["region", "settlement", "landmark", "building", "room", "object"] as const;
export const ATLAS_EDGE_KINDS = ["contain", "route", "portal", "link"] as const;

/* 中文标签常量。组件通过 tr(标签) 显示，英文由 en.ts 统一补充；
   这里不直接调用 tr()，保持纯函数可被 Node 单测直接加载。 */
export const ATLAS_MAP_KIND_LABELS: Record<AtlasMapKind, string> = {
  world: "世界",
  region: "区域",
  site: "地点",
  building: "建筑",
  floor: "楼层",
};
export const ATLAS_NODE_KIND_LABELS: Record<AtlasNodeKind, string> = {
  region: "区域",
  settlement: "聚落",
  landmark: "地标",
  building: "建筑",
  room: "房间",
  object: "物件",
};
export const ATLAS_EDGE_KIND_LABELS: Record<AtlasEdge["kind"], string> = {
  contain: "从属",
  route: "路线",
  portal: "通道",
  link: "关联",
};
export const ATLAS_STATUS_LABELS: Record<AtlasStatus, string> = {
  fixed: "固定资料",
  provisional: "待确认资料",
  planned: "计划",
};
export const ATLAS_POSITION_STATUS_LABELS: Record<AtlasPositionStatus, string> = {
  present: "在场",
  mentioned: "提及",
  planned: "计划",
};
export const ATLAS_THEME_LABELS: Record<AtlasTheme, string> = {
  ink: "墨色",
  parchment: "羊皮纸",
  nocturne: "夜曲",
  frost: "霜色",
};

/* -------------------------------------------------------------- 投影类型 */

/** 投影后的有效状态：作者固定、已确认、待确认、计划、待复核。 */
export type AtlasEffectiveState = "fixed" | "confirmed" | "provisional" | "planned" | "stale";

export const ATLAS_STATE_LABELS: Record<AtlasEffectiveState, string> = {
  fixed: "初始资料",
  confirmed: "已确认",
  provisional: "待确认",
  planned: "计划",
  stale: "待复核",
};

export type AtlasMapView = AtlasMap & {
  state: AtlasEffectiveState;
  sourceOrder: number;
  sourceChapterTitle: string;
};
export type AtlasNodeView = AtlasNode & {
  state: AtlasEffectiveState;
  sourceOrder: number;
  sourceChapterTitle: string;
};
export type AtlasEdgeView = AtlasEdge & {
  state: AtlasEffectiveState;
  sourceOrder: number;
  sourceChapterTitle: string;
};
export type AtlasItemView = AtlasItem & {
  state: AtlasEffectiveState;
  sourceOrder: number;
  sourceChapterTitle: string;
};
export type AtlasPositionView = AtlasPosition & {
  state: AtlasEffectiveState;
  sourceOrder: number;
  sourceChapterTitle: string;
};

export type AtlasStats = {
  maps: number;
  nodes: number;
  edges: number;
  items: number;
  positions: number;
  /** 当前截至章节下可见的计划资料。 */
  plannedMaps: number;
  plannedNodes: number;
  plannedEdges: number;
  plannedItems: number;
  plannedPositions: number;
  /** 可见的待复核资料，单独计数，界面上必须与已确认区分。 */
  staleMaps: number;
  staleNodes: number;
  staleEdges: number;
  staleItems: number;
  stalePositions: number;
  /** 来源章节晚于截至章节的资料数（不论 showPlans 是否打开都统计）。 */
  futureMaps: number;
  futureNodes: number;
  futureEdges: number;
  futureItems: number;
  futurePositions: number;
  /** 被过滤掉、当前不可见的资料数（未来/计划/所属地图不可见）。 */
  hiddenMaps: number;
  hiddenNodes: number;
  hiddenEdges: number;
  hiddenItems: number;
  hiddenPositions: number;
};

export type AtlasProjection = {
  cutoff: number;
  chapterId: string;
  chapterTitle: string;
  maps: AtlasMapView[];
  nodes: AtlasNodeView[];
  edges: AtlasEdgeView[];
  items: AtlasItemView[];
  positions: AtlasPositionView[];
  /** 根地图（parentMapId 为空或父地图不可见）。 */
  roots: AtlasMapView[];
  stats: AtlasStats;
};

export type ResolveAtlasOptions = { showPlans?: boolean };

const excerpt = (value: string | undefined, limit: number) => {
  const text = (value || "").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};
const finite = (value: number, fallback = ATLAS_COORD_MAX / 2) =>
  Number.isFinite(value) ? value : fallback;
export const clampAtlasCoord = (value: number) =>
  Math.min(ATLAS_COORD_MAX, Math.max(ATLAS_COORD_MIN, Math.round(finite(value))));

type ChapterIndex = Map<string, { order: number; status: string; title: string }>;

function chapterIndex(book: Book): ChapterIndex {
  const index: ChapterIndex = new Map();
  for (const chapter of book.chapters || []) {
    if (!chapter || typeof chapter.id !== "string") continue;
    index.set(chapter.id, {
      order: Number.isFinite(chapter.order) ? chapter.order : 0,
      status: chapter.status === "final" ? "final" : "draft",
      title: chapter.title || "",
    });
  }
  return index;
}

type Effective = { state: AtlasEffectiveState; future: boolean };

/**
 * 单条资料的有效状态。
 * `status` 是作者标记（fixed/provisional/planned），`stale` 是后端失效标记。
 */
function effectiveOf(
  sourceChapterId: string,
  status: AtlasStatus,
  stale: boolean | undefined,
  chapters: ChapterIndex,
  cutoff: number,
): Effective {
  if (status === "planned") return { state: "planned", future: false };
  const chapter = sourceChapterId ? chapters.get(sourceChapterId) : undefined;
  if (sourceChapterId && chapter && chapter.order > cutoff)
    return { state: "planned", future: true };
  if (stale || (sourceChapterId && (!chapter || chapter.status !== "final")))
    return { state: "stale", future: false };
  if (status === "provisional") return { state: "provisional", future: false };
  return { state: sourceChapterId ? "confirmed" : "fixed", future: false };
}

function visibleState(state: AtlasEffectiveState, showPlans: boolean) {
  return state !== "planned" || showPlans;
}

/**
 * 子资料继承上级地图/地点的时效：计划中的地图里的固定地点仍是计划，
 * 待复核地图里的地点也不能当作当前有效资料。
 */
function inheritedState(
  own: AtlasEffectiveState,
  parent?: AtlasEffectiveState,
): AtlasEffectiveState {
  if (own === "stale" || parent === "stale") return "stale";
  if (parent === "planned") return "planned";
  return own;
}

/* -------------------------------------------------------------- 时间线投影 */

/**
 * 计算截至 `chapterId` 章末的地图有效状态。
 * - `chapterId` 为空字符串表示故事开始前，只保留作者初始资料；
 * - `showPlans` 默认关闭，打开后计划/未来资料进入结果，状态为 planned；
 * - 计划与未来资料永远不会被标记成 confirmed；stale 单独计数。
 */
export function resolveAtlas(
  book: Book,
  chapterId: string,
  options: ResolveAtlasOptions = {},
): AtlasProjection {
  const showPlans = !!options.showPlans;
  const chapters = chapterIndex(book);
  const target = chapterId ? chapters.get(chapterId) : undefined;
  const cutoff = chapterId ? (target?.order ?? -1) : 0;
  const chapterTitle = chapterId ? (target?.title ?? "") : "";

  const stats: AtlasStats = {
    maps: 0, nodes: 0, edges: 0, items: 0, positions: 0,
    plannedMaps: 0, plannedNodes: 0, plannedEdges: 0, plannedItems: 0, plannedPositions: 0,
    staleMaps: 0, staleNodes: 0, staleEdges: 0, staleItems: 0, stalePositions: 0,
    futureMaps: 0, futureNodes: 0, futureEdges: 0, futureItems: 0, futurePositions: 0,
    hiddenMaps: 0, hiddenNodes: 0, hiddenEdges: 0, hiddenItems: 0, hiddenPositions: 0,
  };

  const sourceChapterTitle = (id: string) => (id ? (chapters.get(id)?.title ?? "") : "");
  const sourceOrder = (id: string) => (id ? (chapters.get(id)?.order ?? -1) : 0);

  const mapRows = (book.atlasMaps || []).filter(
    (map): map is AtlasMap => !!map && typeof map.id === "string",
  );
  const mapById = new Map(mapRows.map((map) => [map.id, map]));
  const mapResolved = new Map<string, AtlasEffectiveState>();
  const resolvingMaps = new Set<string>();
  /** 计划/待复核沿 parentMapId 祖先链向下传递，循环引用安全。 */
  const resolveMapState = (id: string): AtlasEffectiveState | undefined => {
    if (!id || !mapById.has(id)) return undefined;
    if (mapResolved.has(id)) return mapResolved.get(id);
    if (resolvingMaps.has(id)) return undefined;
    resolvingMaps.add(id);
    const map = mapById.get(id)!;
    const own = effectiveOf(map.chapterId || "", map.status, map.stale, chapters, cutoff).state;
    const parent = resolveMapState(map.parentMapId);
    const state = parent ? inheritedState(own, parent) : own;
    resolvingMaps.delete(id);
    mapResolved.set(id, state);
    return state;
  };
  const maps: AtlasMapView[] = [];
  for (const map of mapRows) {
    const { state: ownState, future } = effectiveOf(map.chapterId || "", map.status, map.stale, chapters, cutoff);
    const state = resolveMapState(map.id) ?? ownState;
    if (future) stats.futureMaps++;
    if (!visibleState(state, showPlans)) {
      stats.hiddenMaps++;
      continue;
    }
    maps.push({ ...map, state, sourceOrder: sourceOrder(map.chapterId), sourceChapterTitle: sourceChapterTitle(map.chapterId) });
    stats.maps++;
    if (state === "planned") stats.plannedMaps++;
    if (state === "stale") stats.staleMaps++;
  }
  const visibleMaps = new Set(maps.map((map) => map.id));

  const nodeRows = (book.atlasNodes || []).filter(
    (node): node is AtlasNode => !!node && typeof node.id === "string",
  );
  const nodeById = new Map(nodeRows.map((node) => [node.id, node]));
  const nodeResolved = new Map<string, AtlasEffectiveState>();
  const resolvingNodes = new Set<string>();
  /** 继承上级节点，再继承所属地图的时效。 */
  const resolveNodeState = (id: string): AtlasEffectiveState | undefined => {
    if (!id || !nodeById.has(id)) return undefined;
    if (nodeResolved.has(id)) return nodeResolved.get(id);
    if (resolvingNodes.has(id)) return undefined;
    resolvingNodes.add(id);
    const node = nodeById.get(id)!;
    const own = effectiveOf(node.chapterId || "", node.status, node.stale, chapters, cutoff).state;
    const parent = resolveNodeState(node.parentId);
    const inherited = parent ? inheritedState(own, parent) : own;
    const state = inheritedState(inherited, mapResolved.get(node.mapId));
    resolvingNodes.delete(id);
    nodeResolved.set(id, state);
    return state;
  };

  const nodes: AtlasNodeView[] = [];
  for (const node of nodeRows) {
    const { state: ownState, future } = effectiveOf(node.chapterId || "", node.status, node.stale, chapters, cutoff);
    const state = resolveNodeState(node.id) ?? ownState;
    if (future) stats.futureNodes++;
    if (!visibleState(state, showPlans) || !visibleMaps.has(node.mapId)) {
      stats.hiddenNodes++;
      continue;
    }
    nodes.push({ ...node, state, sourceOrder: sourceOrder(node.chapterId), sourceChapterTitle: sourceChapterTitle(node.chapterId) });
    stats.nodes++;
    if (state === "planned") stats.plannedNodes++;
    if (state === "stale") stats.staleNodes++;
  }
  const visibleNodes = new Set(nodes.map((node) => node.id));

  const edges: AtlasEdgeView[] = [];
  for (const edge of book.atlasEdges || []) {
    if (!edge || typeof edge.id !== "string") continue;
    const { state: ownState, future } = effectiveOf(edge.chapterId || "", edge.status, edge.stale, chapters, cutoff);
    let state = inheritedState(ownState, mapResolved.get(edge.mapId));
    const sourceState = nodeResolved.get(edge.source);
    const targetState = nodeResolved.get(edge.target);
    if (!sourceState || !targetState) state = "stale";
    else {
      state = inheritedState(state, sourceState);
      state = inheritedState(state, targetState);
    }
    if (future) stats.futureEdges++;
    if (
      !visibleState(state, showPlans) ||
      !visibleMaps.has(edge.mapId) ||
      !visibleNodes.has(edge.source) ||
      !visibleNodes.has(edge.target)
    ) {
      stats.hiddenEdges++;
      continue;
    }
    edges.push({ ...edge, state, sourceOrder: sourceOrder(edge.chapterId), sourceChapterTitle: sourceChapterTitle(edge.chapterId) });
    stats.edges++;
    if (state === "planned") stats.plannedEdges++;
    if (state === "stale") stats.staleEdges++;
  }

  const items: AtlasItemView[] = [];
  for (const item of book.atlasItems || []) {
    if (!item || typeof item.id !== "string") continue;
    const { state: ownState, future } = effectiveOf(item.chapterId || "", item.status, item.stale, chapters, cutoff);
    const state = inheritedState(ownState, item.nodeId ? nodeResolved.get(item.nodeId) : undefined);
    if (future) stats.futureItems++;
    if (!visibleState(state, showPlans) || (item.nodeId && !visibleNodes.has(item.nodeId))) {
      stats.hiddenItems++;
      continue;
    }
    items.push({ ...item, state, sourceOrder: sourceOrder(item.chapterId), sourceChapterTitle: sourceChapterTitle(item.chapterId) });
    stats.items++;
    if (state === "planned") stats.plannedItems++;
    if (state === "stale") stats.staleItems++;
  }

  const positions: AtlasPositionView[] = [];
  for (const position of book.atlasPositions || []) {
    if (!position || typeof position.id !== "string") continue;
    // 人物位置的时间规则与地图资料一致，另外 position.status=planned 也只在显示计划时出现。
    const base = effectiveOf(position.chapterId || "", "fixed", position.stale, chapters, cutoff);
    const state: AtlasEffectiveState = inheritedState(
      position.status === "planned" && base.state !== "stale" ? "planned" : base.state,
      position.nodeId ? nodeResolved.get(position.nodeId) : undefined,
    );
    const future = base.future || (position.status === "planned" && !!position.chapterId && (chapters.get(position.chapterId)?.order ?? -1) > cutoff);
    if (future) stats.futurePositions++;
    if (!visibleState(state, showPlans) || (position.nodeId && !visibleNodes.has(position.nodeId))) {
      stats.hiddenPositions++;
      continue;
    }
    positions.push({ ...position, state, sourceOrder: sourceOrder(position.chapterId), sourceChapterTitle: sourceChapterTitle(position.chapterId) });
    stats.positions++;
    if (state === "planned") stats.plannedPositions++;
    if (state === "stale") stats.stalePositions++;
  }

  const roots = maps.filter((map) => {
    if (!map.parentMapId) return true;
    const parent = maps.find((item) => item.id === map.parentMapId);
    return !parent;
  });

  return { cutoff, chapterId: target ? chapterId : "", chapterTitle, maps, nodes, edges, items, positions, roots, stats };
}

/* ---------------------------------------------------------------- 地图层级 */

export type AtlasLineageEntry = {
  map: AtlasMap;
  depth: number;
  parentId: string;
  rootId: string;
  rootName: string;
};

const compareMaps = (a: AtlasMap, b: AtlasMap) =>
  finite(a.order, 0) - finite(b.order, 0) ||
  (a.name || "").localeCompare(b.name || "", "zh-Hans-CN") ||
  a.id.localeCompare(b.id);

/**
 * 把地图按「根 → 子 → 孙」拍平排序，返回带层级的数组。
 * 父地图不存在的地图当作根；循环引用不会死循环（未访问的节点按排序补在末尾）。
 */
export function mapLineage(maps: AtlasMap[]): AtlasLineageEntry[] {
  const byId = new Map<string, AtlasMap>();
  for (const map of maps || []) if (map && typeof map.id === "string") byId.set(map.id, map);
  const children = new Map<string, AtlasMap[]>();
  const roots: AtlasMap[] = [];
  for (const map of byId.values()) {
    const parentId = map.parentMapId && byId.has(map.parentMapId) ? map.parentMapId : "";
    if (!parentId) roots.push(map);
    else {
      const list = children.get(parentId) || [];
      list.push(map);
      children.set(parentId, list);
    }
  }
  roots.sort(compareMaps);
  children.forEach((list) => list.sort(compareMaps));
  const entries: AtlasLineageEntry[] = [];
  const visited = new Set<string>();
  const walk = (map: AtlasMap, depth: number, root: AtlasMap) => {
    if (visited.has(map.id)) return;
    visited.add(map.id);
    entries.push({
      map,
      depth,
      parentId: map.parentMapId && byId.has(map.parentMapId) ? map.parentMapId : "",
      rootId: root.id,
      rootName: root.name || "",
    });
    for (const child of children.get(map.id) || []) walk(child, depth + 1, root);
  };
  for (const root of roots) walk(root, 0, root);
  // 循环引用或父链断开的地图，按稳定顺序补在末尾，保证不丢数据。
  const leftover = [...byId.values()].filter((map) => !visited.has(map.id)).sort(compareMaps);
  for (const map of leftover) walk(map, 0, map);
  return entries;
}

/**
 * 与指定地图同一条父子链的地图：祖先（从根到父）与所有后代（按层级顺序）。
 * 不包含地图自身。用于顶部「关联地图」与切换入口。
 */
export function onMapLinked(maps: AtlasMap[], mapId: string): AtlasMap[] {
  if (!mapId) return [];
  const byId = new Map<string, AtlasMap>();
  for (const map of maps || []) if (map && typeof map.id === "string") byId.set(map.id, map);
  if (!byId.has(mapId)) return [];
  const ancestors: AtlasMap[] = [];
  const guard = new Set<string>([mapId]);
  let cursor = byId.get(mapId)!.parentMapId;
  while (cursor && byId.has(cursor) && !guard.has(cursor)) {
    guard.add(cursor);
    ancestors.unshift(byId.get(cursor)!);
    cursor = byId.get(cursor)!.parentMapId;
  }
  const entries = mapLineage(maps);
  const index = new Map(entries.map((entry, position) => [entry.map.id, position]));
  const own = index.get(mapId) ?? -1;
  const descendants = entries
    .filter((entry) => {
      if (entry.map.id === mapId) return false;
      let parentId = entry.map.parentMapId;
      const chainGuard = new Set<string>();
      while (parentId && byId.has(parentId) && !chainGuard.has(parentId)) {
        if (parentId === mapId) return true;
        chainGuard.add(parentId);
        parentId = byId.get(parentId)!.parentMapId;
      }
      return false;
    })
    .sort((a, b) => (index.get(a.map.id) ?? 0) - (index.get(b.map.id) ?? 0))
    .map((entry) => entry.map);
  return [...ancestors, ...descendants];
}

/* ---------------------------------------------------------------- 自动落位 */

/** 第 index 个网格槽位的中心坐标；槽位按行优先、确定性地铺满 0–1000。 */
function gridSlot(index: number, count: number) {
  const columns = Math.max(1, Math.min(ATLAS_LAYOUT_COLUMNS, Math.ceil(Math.sqrt(Math.max(1, count)))));
  const rows = Math.max(1, Math.ceil(count / columns));
  const usable = ATLAS_COORD_MAX - ATLAS_LAYOUT_PADDING * 2;
  const column = index % columns;
  const row = Math.floor(index / columns);
  const x = columns === 1 ? ATLAS_COORD_MAX / 2 : ATLAS_LAYOUT_PADDING + (usable * column) / (columns - 1);
  const y = rows === 1 ? ATLAS_COORD_MAX / 2 : ATLAS_LAYOUT_PADDING + (usable * row) / (rows - 1);
  return { x: clampAtlasCoord(x), y: clampAtlasCoord(y) };
}

const compareNodeLayout = (a: AtlasNode, b: AtlasNode) =>
  ATLAS_NODE_KINDS.indexOf(a.kind) - ATLAS_NODE_KINDS.indexOf(b.kind) ||
  (a.name || "").localeCompare(b.name || "", "zh-Hans-CN") ||
  a.id.localeCompare(b.id);

/**
 * 网格自动整理：只重排 `mapId` 这张地图上的节点，其他地图的节点原样返回。
 * 排序规则稳定（先按类型，再按名称），同一输入重复调用结果一致。
 */
export function autoLayoutNodes(nodes: AtlasNode[], mapId: string): AtlasNode[] {
  const targets = (nodes || [])
    .filter((node) => node && node.mapId === mapId && typeof node.id === "string")
    .sort(compareNodeLayout);
  const positions = new Map<string, { x: number; y: number }>();
  targets.forEach((node, index) => positions.set(node.id, gridSlot(index, targets.length)));
  return (nodes || []).map((node) => {
    const position = positions.get(node.id);
    return position ? { ...node, x: position.x, y: position.y } : node;
  });
}

/**
 * 新增节点的默认落点：先在网格里找没被同地图节点占用的槽位；
 * 全部占满后用确定性的偏移继续向外找，并夹在 0–1000 内。
 */
export function defaultNodePosition(existing: AtlasNode[], mapId: string): { x: number; y: number } {
  const occupied = (existing || [])
    .filter((node) => node && node.mapId === mapId)
    .map((node) => ({
      x: finite(node.x, Number.NaN),
      y: finite(node.y, Number.NaN),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const free = (point: { x: number; y: number }) =>
    !occupied.some(
      (item) => Math.abs(item.x - point.x) < ATLAS_SLOT_DISTANCE && Math.abs(item.y - point.y) < ATLAS_SLOT_DISTANCE,
    );
  for (let index = 0; index < 400; index++) {
    const ring = Math.floor(index / 16);
    const column = index % 4;
    const row = Math.floor((index % 16) / 4);
    const point = {
      x: clampAtlasCoord(ATLAS_LAYOUT_PADDING + column * ((ATLAS_COORD_MAX - ATLAS_LAYOUT_PADDING * 2) / 3.4) + ring * 46),
      y: clampAtlasCoord(ATLAS_LAYOUT_PADDING + row * ((ATLAS_COORD_MAX - ATLAS_LAYOUT_PADDING * 2) / 3.4) + ring * 38),
    };
    if (free(point)) return point;
  }
  const step = (occupied.length % 7) * 12;
  return {
    x: clampAtlasCoord(ATLAS_COORD_MAX / 2 + step),
    y: clampAtlasCoord(ATLAS_COORD_MAX / 2 + step),
  };
}

/* -------------------------------------------------------------- 从资料归纳 */

export type AtlasSeed = {
  maps: AtlasMap[];
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  items: AtlasItem[];
  positions: AtlasPosition[];
};

const categoryMatchers: { pattern: RegExp; kind: AtlasNodeKind }[] = [
  { pattern: /楼|层|房|室|厅|廊|间|舱|库/, kind: "room" },
  { pattern: /建筑|宫殿|殿|塔|阁|府|宅|要塞|堡垒|教堂|寺庙|祠堂|车站|码头|桥/, kind: "building" },
  { pattern: /城|镇|村|港|聚落|街区|营地|驿站|卫所/, kind: "settlement" },
  { pattern: /地标|遗迹|广场|山谷|山峰|山|峰|河|湖|海|岛|林|沙漠|平原|谷|洞|渊|崖|峡谷/, kind: "landmark" },
  { pattern: /地点|场所|位置|地标/, kind: "landmark" },
  { pattern: /区域|地域|国家|王国|大陆|州|郡|域|北境|荒原|领地|势力范围/, kind: "region" },
];
const objectCategory = /物品|物件|法宝|武器|信物|令牌|钥匙|戒指|道具|装备/;
const locationRelations = /位置|所在|位于|身处|抵达|来到|留在|驻守|藏身/;
const mentionRelations = /提及|传闻|据说|听说|记录/;

const classifyCategory = (category: string): { kind: AtlasNodeKind } | { item: true } | null => {
  const value = (category || "").trim();
  if (!value) return null;
  if (objectCategory.test(value)) return { item: true };
  for (const matcher of categoryMatchers) if (matcher.pattern.test(value)) return { kind: matcher.kind };
  return null;
};

const findNodeByName = (nodes: AtlasNode[], value: string) => {
  const text = (value || "").trim();
  if (!text) return undefined;
  const exact = nodes.find((node) => node.name.trim() === text);
  if (exact) return exact;
  // 只在「名字完整出现在描述里」时建立联系，宁可少一条，不猜。
  return nodes
    .filter((node) => node.name.trim().length >= 2 && text.includes(node.name.trim()))
    .sort((a, b) => b.name.trim().length - a.name.trim().length || a.id.localeCompare(b.id))[0];
};

const findCharacterByName = (book: Book, value: string) => {
  const text = (value || "").trim();
  if (!text) return undefined;
  return (book.characters || []).find((person) => (person.name || "").trim() === text);
};

/**
 * 从现有资料归纳初始蓝图：世界资料卡 → 地图/节点/物品，事实记忆 → 人物位置。
 * 纯确定性：同一本书重复调用完全一致；不调用 AI、不推断、不引用正文原文。
 * 无法归类的世界资料直接跳过（例如「规则」「势力」），不硬塞成地点。
 */
export function buildAtlasSeed(book: Book): AtlasSeed {
  const map: AtlasMap = {
    id: "atlas-map-world",
    name: "世界地图",
    kind: "world",
    parentMapId: "",
    description: excerpt(book.world || book.premise || "", ATLAS_LIMITS.description),
    theme: "ink",
    status: "fixed",
    chapterId: "",
    order: 0,
  };
  const nodes: AtlasNode[] = [];
  const items: AtlasItem[] = [];
  const seenNames = new Set<string>();
  const records = [...(book.worldRecords || [])].sort((a, b) => a.id.localeCompare(b.id));
  for (const record of records) {
    if (!record || typeof record.id !== "string") continue;
    const title = (record.title || "").trim();
    if (!title || seenNames.has(title)) continue;
    const category = classifyCategory(record.category);
    if (!category) continue;
    const status: AtlasStatus = record.certainty === "provisional" ? "provisional" : "fixed";
    if ("item" in category) {
      if (items.length >= ATLAS_LIMITS.items) continue;
      seenNames.add(title);
      items.push({
        id: `atlas-item-${record.id}`,
        name: title,
        description: excerpt(record.description, ATLAS_LIMITS.description),
        nodeId: "",
        ownerCharacterId: "",
        status,
        chapterId: "",
      });
      continue;
    }
    if (nodes.length >= ATLAS_LIMITS.nodes) continue;
    seenNames.add(title);
    nodes.push({
      id: `atlas-node-${record.id}`,
      mapId: map.id,
      parentId: "",
      kind: category.kind,
      name: title,
      description: excerpt(record.description, ATLAS_LIMITS.description),
      x: ATLAS_COORD_MAX / 2,
      y: ATLAS_COORD_MAX / 2,
      status,
      chapterId: "",
    });
  }
  const laidOut = autoLayoutNodes(nodes, map.id);
  nodes.length = 0;
  nodes.push(...laidOut);

  const positions: AtlasPosition[] = [];
  const seenPositions = new Set<string>();
  const memories = [...(book.memories || [])].sort((a, b) => a.id.localeCompare(b.id));
  for (const memory of memories) {
    if (!memory || typeof memory.id !== "string") continue;
    if (positions.length >= ATLAS_LIMITS.positions) break;
    if (!locationRelations.test(memory.relation || "") && !locationRelations.test(memory.object || "")) continue;
    const person = findCharacterByName(book, memory.subject);
    const node = findNodeByName(nodes, memory.object) || findNodeByName(nodes, memory.subject);
    const characterId = person?.id || "";
    if (!characterId || !node) continue;
    const key = `${characterId}/${node.id}/${memory.sourceChapterId || ""}`;
    if (seenPositions.has(key)) continue;
    seenPositions.add(key);
    const status: AtlasPositionStatus = mentionRelations.test(memory.relation || "") ? "mentioned" : "present";
    positions.push({
      id: `atlas-position-${memory.id}`,
      characterId,
      nodeId: node.id,
      chapterId: memory.sourceChapterId || "",
      status,
      note: excerpt(memory.evidence || `${memory.subject}${memory.relation}${memory.object}`, ATLAS_LIMITS.note),
      ...(memory.stale ? { stale: true } : {}),
    });
  }

  return {
    maps: [map].slice(0, ATLAS_LIMITS.maps),
    nodes: nodes.slice(0, ATLAS_LIMITS.nodes),
    edges: [],
    items: items.slice(0, ATLAS_LIMITS.items),
    positions: positions.slice(0, ATLAS_LIMITS.positions),
  };
}

const mergeById = <T extends { id: string }>(current: T[] | undefined, incoming: T[]): T[] => {
  const source = current || [];
  const seen = new Set(source.map((item) => item.id));
  return [...source, ...incoming.filter((item) => !seen.has(item.id))];
};

/**
 * 把归纳结果并入现有蓝图：只补缺少的 id，不覆盖作者已改过的资料。
 * 重复调用返回完全相同的数据（幂等），便于「归纳」按钮安全重复点击。
 */
export function mergeAtlasSeed(book: Book, seed?: AtlasSeed): Required<Pick<Book, "atlasMaps" | "atlasNodes" | "atlasEdges" | "atlasItems" | "atlasPositions">> {
  const data = seed || buildAtlasSeed(book);
  return {
    atlasMaps: mergeById(book.atlasMaps, data.maps),
    atlasNodes: mergeById(book.atlasNodes, data.nodes),
    atlasEdges: mergeById(book.atlasEdges, data.edges),
    atlasItems: mergeById(book.atlasItems, data.items),
    atlasPositions: mergeById(book.atlasPositions, data.positions),
  };
}

/* ------------------------------------------------------------ 小型展示助手 */

/** 节点是否与某章「有关」：来源章就是该章，或该章有它的物品/人物位置。 */
export function nodeInvolvesChapter(
  nodeId: string,
  chapterId: string,
  items: AtlasItem[],
  positions: AtlasPosition[],
): boolean {
  if (!chapterId) return false;
  if ((items || []).some((item) => item.nodeId === nodeId && item.chapterId === chapterId)) return true;
  return (positions || []).some((position) => position.nodeId === nodeId && position.chapterId === chapterId);
}

/** 地图下所有后代的 id（不含自身），删除地图时需要一起清理。 */
export function descendantMapIds(maps: AtlasMap[], mapId: string): string[] {
  if (!mapId) return [];
  const result: string[] = [];
  const queue = [mapId];
  const seen = new Set<string>([mapId]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const map of maps || []) {
      if (!map || map.parentMapId !== current || seen.has(map.id)) continue;
      seen.add(map.id);
      result.push(map.id);
      queue.push(map.id);
    }
  }
  return result;
}
