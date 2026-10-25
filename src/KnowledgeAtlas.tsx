/* 知识蓝图：可切换、可回看的 SVG 代码渲染地图。
 *
 * 数据全部来自 book.atlas*，组件不做 API 调用、不生成图片；
 * 每次写入都通过 onChange 提交整数组补丁，再用 flush 等待保存。
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  ArrowsOut,
  CheckCircle,
  Link as LinkIcon,
  MagnifyingGlass,
  MapTrifold,
  Minus,
  PencilSimple,
  Plus,
  SquaresFour,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { tr, useLanguage } from "./i18n";
import { Button, Field, IconButton, Modal } from "./ui";
import type {
  AtlasEdge,
  AtlasItem,
  AtlasMap,
  AtlasNode,
  AtlasNodeKind,
  AtlasPosition,
  AtlasStatus,
  Book,
} from "./types";
import {
  ATLAS_COORD_MAX,
  ATLAS_EDGE_KIND_LABELS,
  ATLAS_EDGE_KINDS,
  ATLAS_LIMITS,
  ATLAS_MAP_KINDS,
  ATLAS_MAP_KIND_LABELS,
  ATLAS_NODE_KINDS,
  ATLAS_NODE_KIND_LABELS,
  ATLAS_NODE_SIZES,
  ATLAS_POSITION_STATUS_LABELS,
  ATLAS_STATE_LABELS,
  ATLAS_STATUS_LABELS,
  ATLAS_THEMES,
  ATLAS_THEME_LABELS,
  autoLayoutNodes,
  clampAtlasCoord,
  defaultNodePosition,
  descendantMapIds,
  mapLineage,
  mergeAtlasSeed,
  nodeInvolvesChapter,
  onMapLinked,
  resolveAtlas,
  type AtlasEffectiveState,
  type AtlasEdgeView,
  type AtlasItemView,
  type AtlasMapView,
  type AtlasNodeView,
  type AtlasPositionView,
  type AtlasTheme,
} from "./atlasModel";
import "./knowledge-atlas.css";
import AtlasScopeView from './AtlasScopeView';
import ChapterSyncStatus from './ChapterSyncStatus';
import {atlasScope} from './atlasScope';

export type KnowledgeAtlasProps = {
  book: Book;
  chapterId: string;
  disabled?: boolean;
  onChange: (patch: Partial<Book>) => void;
  flush: () => Promise<void>;
  notify: (message: string) => void;
  onReviewChapter?: (id:string)=>void;
};

type MapViewport = { x: number; y: number; zoom: number };
type Selection = { kind: "node" | "edge"; id: string } | null;
type EditorState =
  | { kind: "map"; draft: AtlasMap; isNew: boolean }
  | { kind: "node"; draft: AtlasNode; isNew: boolean }
  | { kind: "edge"; draft: AtlasEdge; isNew: boolean }
  | { kind: "item"; draft: AtlasItem; isNew: boolean }
  | { kind: "position"; draft: AtlasPosition; isNew: boolean };
type ConfirmState = { title: string; message: string; action: () => void };
type DragState = {
  pointerId: number;
  mode: "node" | "pan";
  nodeId?: string;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  startWorldX?: number;
  startWorldY?: number;
  moved: boolean;
};

const ZOOM_MIN = 0.35;
const ZOOM_MAX = 3;
const NODE_LABEL_LENGTH = 13;
const MAP_PADDING = 64;

const newId = (prefix: string) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`}`;

const themeOf = (value: string): AtlasTheme =>
  (ATLAS_THEMES as readonly string[]).includes(value) ? (value as AtlasTheme) : "ink";

const textOr = (value: string, limit: number) => {
  const text = (value || "").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

const mapDraftOf = (map: AtlasMap): AtlasMap => ({
  id: map.id,
  name: map.name,
  kind: map.kind,
  parentMapId: map.parentMapId || "",
  entryNodeId: map.entryNodeId || "",
  description: map.description || "",
  theme: map.theme || "ink",
  status: map.status,
  chapterId: map.chapterId || "",
  order: map.order,
});

const nodeDraftOf = (node: AtlasNode): AtlasNode => ({
  id: node.id,
  mapId: node.mapId,
  parentId: node.parentId || "",
  kind: node.kind,
  name: node.name,
  description: node.description || "",
  x: node.x,
  y: node.y,
  status: node.status,
  chapterId: node.chapterId || "",
  ...(node.stale ? { stale: true } : {}),
});

const edgeDraftOf = (edge: AtlasEdge): AtlasEdge => ({
  id: edge.id,
  mapId: edge.mapId,
  source: edge.source,
  target: edge.target,
  kind: edge.kind,
  label: edge.label || "",
  status: edge.status,
  chapterId: edge.chapterId || "",
  ...(edge.stale ? { stale: true } : {}),
});

const itemDraftOf = (item: AtlasItem): AtlasItem => ({
  id: item.id,
  name: item.name,
  description: item.description || "",
  nodeId: item.nodeId || "",
  ownerCharacterId: item.ownerCharacterId || "",
  status: item.status,
  chapterId: item.chapterId || "",
  ...(item.stale ? { stale: true } : {}),
});

const positionDraftOf = (position: AtlasPosition): AtlasPosition => ({
  id: position.id,
  characterId: position.characterId,
  nodeId: position.nodeId || "",
  chapterId: position.chapterId || "",
  status: position.status,
  note: position.note || "",
  ...(position.stale ? { stale: true } : {}),
});

const descendantNodeIds = (nodes: AtlasNode[], nodeId: string): string[] => {
  const result: string[] = [];
  const queue = [nodeId];
  const seen = new Set<string>([nodeId]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const node of nodes) {
      if (node.parentId !== current || seen.has(node.id)) continue;
      seen.add(node.id);
      result.push(node.id);
      queue.push(node.id);
    }
  }
  return result;
};

const nextKindForMap = (kind: AtlasMap["kind"] | undefined): AtlasMap["kind"] => {
  switch (kind) {
    case undefined:
      // 第一张根地图默认是「世界」；子地图按层级逐步细分。
      return "world";
    case "world":
      return "region";
    case "region":
      return "site";
    case "site":
      return "building";
    case "building":
      return "floor";
    default:
      return "floor";
  }
};

/* 节点的几何图形：不使用图片，全部由路径绘制。 */
function NodeShape({ kind }: { kind: AtlasNodeKind }) {
  switch (kind) {
    case "region":
      return (
        <polygon
          className="ka-shape"
          points="-95,-20 -70,-43 70,-43 95,-20 95,20 70,43 -70,43 -95,20"
        />
      );
    case "settlement":
      return <ellipse className="ka-shape" rx={84} ry={39} />;
    case "landmark":
      return <polygon className="ka-shape" points="0,-42 84,0 0,42 -84,0" />;
    case "building":
      return <path className="ka-shape" d="M-84 -6 0 -37 84 -6 84 37 -84 37Z" />;
    case "room":
      return <rect className="ka-shape" x={-66} y={-32} width={132} height={64} rx={5} />;
    case "object":
      return (
        <path className="ka-shape" d="M-60 -10 -36 -29 36 -29 60 -10 36 29 -36 29Z" />
      );
    default:
      return <rect className="ka-shape" x={-66} y={-32} width={132} height={64} rx={5} />;
  }
}

function NodeGlyph({ kind }: { kind: AtlasNodeKind }) {
  switch (kind) {
    case "region":
      return <path className="ka-glyph" d="M-18 7 -7 -7 0 2 8 -8 18 7Z" />;
    case "settlement":
      return (
        <path
          className="ka-glyph"
          d="M-15 7 -15 -1 -7 -7 1 -1 1 7ZM5 7 5 1 11 -4 17 1 17 7ZM-2 7 1 4 5 7Z"
        />
      );
    case "landmark":
      return (
        <path
          className="ka-glyph"
          d="M0 -10 3 -3 11 -3 5 2 7 10 0 5 -7 10 -5 2 -11 -3 -3 -3Z"
        />
      );
    case "building":
      return (
        <path
          className="ka-glyph"
          d="M-12 7 -12 -3 0 -10 12 -3 12 7 4 7 4 0 -4 0 -4 7Z"
        />
      );
    case "room":
      return <path className="ka-glyph" d="M-10 7 -10 -7 10 -7 10 7 3 7 3 -1 -3 -1 -3 7Z" />;
    case "object":
      return (
        <path
          className="ka-glyph"
          d="M-4 -8 6 -8 11 0 6 8 -4 8 -9 0Z M-4 -8 -4 8 M6 -8 6 8"
        />
      );
    default:
      return <circle className="ka-glyph-dot" r={5} />;
  }
}

const nodeInk = (state: AtlasEffectiveState) => `ka-state-${state}`;

function chapterLabel(book: Book, chapterId: string): string {
  if (!chapterId) return tr("作者初始资料");
  return book.chapters.find((chapter) => chapter.id === chapterId)?.title || tr("来源章节已删除");
}

function characterName(book: Book, id: string): string {
  return book.characters.find((person) => person.id === id)?.name || tr("已删除人物");
}

function nodeNameOf(nodes: AtlasNode[], id: string): string {
  return nodes.find((node) => node.id === id)?.name || "";
}

export default function KnowledgeAtlas({
  book,
  chapterId,
  onReviewChapter,
  disabled,
  onChange,
  flush,
  notify,
}: KnowledgeAtlasProps) {
  useLanguage();
  const rawMaps = book.atlasMaps ?? [];
  const rawNodes = book.atlasNodes ?? [];
  const rawEdges = book.atlasEdges ?? [];
  const rawItems = book.atlasItems ?? [];
  const rawPositions = book.atlasPositions ?? [];
  const bookChapters = useMemo(
    () => [...book.chapters].sort((a, b) => a.order - b.order),
    [book.chapters],
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragPositionRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const aliveRef = useRef(true);
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gridId = `ka-grid-${rawId}`;
  const contourId = `ka-contour-${rawId}`;
  const roomId = `ka-room-${rawId}`;
  const gradientId = `ka-gradient-${rawId}`;
  const arrowId = `ka-arrow-${rawId}`;
  const warningArrowId = `ka-arrow-warning-${rawId}`;

  const [at, setAt] = useState(chapterId);
  const [showPlans, setShowPlans] = useState(false);
  const [onlyChapter, setOnlyChapter] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [lens, setLens] = useState<"combined"|"places"|"people"|"items">("combined");
  const [includeDescendants,setIncludeDescendants] = useState(true);
  const [inspectorOpen,setInspectorOpen] = useState(false);
  const viewCache = useRef(new Map<string, MapViewport>());
  const [query, setQuery] = useState("");
  const [mapId, setMapId] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  const [viewport, setViewport] = useState<MapViewport>({ x: 0, y: 0, zoom: 1 });
  const [dragPosition, setDragPosition] = useState<{ id: string; x: number; y: number } | null>(null);
  const [connect, setConnect] = useState<{ source: string | null } | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [saving, setSaving] = useState(false);

  const projection = useMemo(
    () => resolveAtlas(book, at, { showPlans }),
    [book, at, showPlans],
  );
  const locked = !!disabled || saving;
  const mapById = useMemo(() => new Map(projection.maps.map((map) => [map.id, map])), [projection.maps]);
  const currentMap = mapId ? mapById.get(mapId) : undefined;
  const navigate = (id: string) => {
    viewCache.current.set(mapId, viewport);
    setMapId(id); setViewport(viewCache.current.get(id) || {x:0,y:0,zoom:1});
    setSelection(null); setConnect(null); setQuery(''); setInspectorOpen(false);
  };
  const scope = useMemo(()=>atlasScope(projection,mapId,includeDescendants,onlyChapter),[projection,mapId,includeDescendants,onlyChapter]);
  const childMaps = projection.maps.filter(map=>map.parentMapId===mapId);
  const enteredMaps = (nodeId:string)=>projection.maps.filter(map=>map.parentMapId===mapId&&map.entryNodeId===nodeId);
  const nodeScopeIds = (nodeId:string) => {
    const ids=new Set([nodeId]);
    if(includeDescendants){
      for(const id of descendantNodeIds(projection.nodes,nodeId))ids.add(id);
      for(const child of enteredMaps(nodeId))for(const node of atlasScope(projection,child.id,true).nodes)ids.add(node.id);
    }
    return ids;
  };
  const isLens = !mapId || lens==='people' || lens==='items';
  const currentTheme = themeOf(currentMap?.theme || "ink");
  const showRoomPattern = currentMap?.kind === "building" || currentMap?.kind === "floor";

  /* 当前地图上的节点；包含搜索、只看本章两份筛选。 */
  const mapNodes = useMemo(
    () => projection.nodes.filter((node) => node.mapId === mapId),
    [projection.nodes, mapId],
  );
  const involvedNodeIds = useMemo(() => {
    if (!onlyChapter) return null;
    const result = new Set<string>();
    for (const node of mapNodes) {
      if ((node.chapterId || "") === at) result.add(node.id);
      else if (at && nodeInvolvesChapter(node.id, at, projection.items, projection.positions))
        result.add(node.id);
    }
    for (const item of projection.items)
      if ((item.chapterId || "") === at && item.nodeId) result.add(item.nodeId);
    for (const position of projection.positions)
      if ((position.chapterId || "") === at && position.nodeId) result.add(position.nodeId);
    return result;
  }, [onlyChapter, at, mapNodes, projection.items, projection.positions]);
  const searchTerm = query.trim().toLocaleLowerCase();
  const nodes = useMemo(() => {
    let list = mapNodes;
    if (involvedNodeIds) list = list.filter((node) => involvedNodeIds.has(node.id));
    if (searchTerm)
      list = list.filter((node) =>
        `${node.name} ${node.description}`.toLocaleLowerCase().includes(searchTerm),
      );
    return list;
  }, [mapNodes, involvedNodeIds, searchTerm]);
  const nodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const edges = useMemo(
    () =>
      projection.edges.filter(
        (edge) => edge.mapId === mapId && nodeIds.has(edge.source) && nodeIds.has(edge.target),
      ),
    [projection.edges, mapId, nodeIds],
  );
  const excludedNodes = useMemo(
    () =>
      involvedNodeIds
        ? mapNodes.filter((node) => !involvedNodeIds.has(node.id))
        : [],
    [involvedNodeIds, mapNodes],
  );

  const selectedNode: AtlasNodeView | undefined =
    selection?.kind === "node" ? projection.nodes.find((node) => node.id === selection.id) : undefined;
  const selectedEdge: AtlasEdgeView | undefined =
    selection?.kind === "edge" ? projection.edges.find((edge) => edge.id === selection.id) : undefined;
  const positionOf = useCallback(
    (node: AtlasNode | AtlasNodeView) => {
      const draft = dragPositionRef.current;
      if (draft && draft.id === node.id) return { x: draft.x, y: draft.y };
      return { x: node.x, y: node.y };
    },
    [],
  );

  /* --------------------------------------------------------------- 基础状态 */

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  useEffect(() => {
    setAt(chapterId);
  }, [book.id, chapterId]);
  useEffect(() => {
    viewCache.current.clear(); setMapId(""); setLens("combined");
    setQuery("");
    setSelection(null);
    setConnect(null);
    setEditor(null);
    setConfirm(null);
    setViewport({ x: 0, y: 0, zoom: 1 });
  }, [book.id]);
  useEffect(() => {
    if(mapId&&!mapById.has(mapId)) navigate('');
  }, [projection.maps, mapId]);
  useEffect(() => {
    if (selection?.kind === "node" && !projection.nodes.some((node) => node.id === selection.id))
      setSelection(null);
    if (selection?.kind === "edge" && !projection.edges.some((edge) => edge.id === selection.id))
      setSelection(null);
  }, [projection.nodes, projection.edges, selection]);
  useEffect(() => {
    setDragPosition(null);
    dragPositionRef.current = null;
  }, [mapId, at]);

  const setDrag = useCallback((next: { id: string; x: number; y: number } | null) => {
    dragPositionRef.current = next;
    setDragPosition(next);
  }, []);

  /* --------------------------------------------------------------- 写操作 */

  const commit = useCallback(
    (patch: Partial<Book>, message?: string) => {
      if (disabled) return;
      onChange(patch);
      setSaving(true);
      void flush()
        .then(() => {
          if (message && aliveRef.current) notify(message);
        })
        .catch((error: unknown) => {
          if (aliveRef.current)
            notify(
              tr("知识蓝图保存失败：{0}", {
                0: error instanceof Error ? error.message : String(error),
              }),
            );
        })
        .finally(() => {
          if (aliveRef.current) setSaving(false);
        });
    },
    [disabled, flush, notify, onChange],
  );

  /* --------------------------------------------------------------- 缩放平移 */

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const world = point.matrixTransform(matrix.inverse());
    return { x: world.x, y: world.y };
  }, []);

  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const anchor = clientX != null && clientY != null ? toWorld(clientX, clientY) : null;
      setViewport((current) => {
        const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current.zoom * factor));
        const size = ATLAS_COORD_MAX / current.zoom;
        const point = anchor
          ? anchor
          : { x: current.x + size / 2, y: current.y + size / 2 };
        const fractionX = (point.x - current.x) / size,
          fractionY = (point.y - current.y) / size;
        const nextSize = ATLAS_COORD_MAX / zoom;
        return {
          zoom,
          x: point.x - fractionX * nextSize,
          y: point.y - fractionY * nextSize,
        };
      });
    },
    [toWorld],
  );

  const fitToNodes = useCallback(() => {
    const stage = stageRef.current;
    const source = nodes.length ? nodes : mapNodes;
    if (!stage || !source.length) {
      setViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const points = source.map((node) => {
      const position = positionOf(node);
      const size = ATLAS_NODE_SIZES[node.kind] || { width: 168, height: 72 };
      return {
        minX: position.x - size.width / 2,
        maxX: position.x + size.width / 2,
        minY: position.y - size.height / 2 - 18,
        maxY: position.y + size.height / 2 + 34,
      };
    });
    const minX = Math.min(...points.map((point) => point.minX)) - MAP_PADDING;
    const maxX = Math.max(...points.map((point) => point.maxX)) + MAP_PADDING;
    const minY = Math.min(...points.map((point) => point.minY)) - MAP_PADDING;
    const maxY = Math.max(...points.map((point) => point.maxY)) + MAP_PADDING;
    const span = Math.max(180, maxX - minX, maxY - minY);
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (ATLAS_COORD_MAX * 0.92) / span));
    const size = ATLAS_COORD_MAX / zoom;
    setViewport({
      zoom,
      x: (minX + maxX) / 2 - size / 2,
      y: (minY + maxY) / 2 - size / 2,
    });
  }, [mapNodes, nodes, positionOf]);
  const fitRef = useRef(fitToNodes);
  fitRef.current = fitToNodes;
  const [fitToken, setFitToken] = useState(0);
  useEffect(() => {
    if (!fitToken) return;
    const frame = requestAnimationFrame(() => fitRef.current());
    return () => cancelAnimationFrame(frame);
  }, [fitToken]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as Element)?.closest("button,input,select,textarea,.ka-scope-view")) return;
      event.preventDefault();
      zoomAt(Math.exp(-event.deltaY * 0.0014), event.clientX, event.clientY);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const stageKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("input,textarea,select")) return;
    if (event.key === "Escape") {
      setConnect(null);
      setSelection(null);
      setEditor(null);
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomAt(1.2);
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      zoomAt(1 / 1.2);
      return;
    }
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      fitToNodes();
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      setViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const step = 48;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      setViewport((current) => {
        const size = ATLAS_COORD_MAX / current.zoom;
        return {
          ...current,
          x: current.x + (event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0) / current.zoom,
          y: current.y + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0) / current.zoom,
        };
      });
    }
  };

  /* --------------------------------------------------------------- 指针交互 */

  const pickNode = (id: string) => {
    if (connect) {
      if (!connect.source) {
        setConnect({ source: id });
        setSelection({ kind: "node", id });
        return;
      }
      if (connect.source === id) return;
      openEdgeForm(connect.source, id);
      setConnect(null);
      return;
    }
    setSelection({ kind: "node", id });
  };

  const beginNodeDrag = (event: PointerEvent<SVGGElement>, node: AtlasNodeView) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    setSelection({ kind: "node", id: node.id });
    // 连线模式下只处理点击，不启动拖动。
    if (locked || connect) return;
    const world = toWorld(event.clientX, event.clientY);
    if (!world) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      mode: "node",
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: node.x,
      originY: node.y,
      startWorldX: world.x,
      startWorldY: world.y,
      moved: false,
    };
  };

  const beginPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest("[data-atlas-node-id],[data-atlas-edge-id],button,input,select,textarea,.ka-scope-view")) return;
    event.preventDefault();
    stageRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      mode: "pan",
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
      moved: false,
    };
    setSelection(null);
  };

  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startClientX;
    const dy = event.clientY - current.startClientY;
    if (!current.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    current.moved = true;
    if (current.mode === "node" && current.nodeId) {
      const world = toWorld(event.clientX, event.clientY);
      if (!world || current.startWorldX == null || current.startWorldY == null) return;
      setDrag({
        id: current.nodeId,
        x: clampAtlasCoord(current.originX + world.x - current.startWorldX),
        y: clampAtlasCoord(current.originY + world.y - current.startWorldY),
      });
      return;
    }
    const rect = stageRef.current?.getBoundingClientRect();
    const scale =
      rect && viewport.zoom ? (Math.min(rect.width, rect.height) * viewport.zoom) / ATLAS_COORD_MAX : 1;
    setViewport((previous) => ({
      ...previous,
      x: current.originX - dx / scale,
      y: current.originY - dy / scale,
    }));
  };

  const endPointer = (event: PointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current) return;
    dragRef.current = null;
    if (stageRef.current?.hasPointerCapture(event.pointerId))
      stageRef.current.releasePointerCapture(event.pointerId);
    if (
      current.mode === "node" &&
      current.nodeId &&
      current.moved &&
      dragPositionRef.current &&
      dragPositionRef.current.id === current.nodeId &&
      !disabled
    ) {
      const position = dragPositionRef.current;
      const next = rawNodes.map((node) =>
        node.id === position.id ? { ...node, x: position.x, y: position.y } : node,
      );
      commit({ atlasNodes: next }, tr("知识蓝图已保存"));
    }
    setDrag(null);
  };

  /* --------------------------------------------------------------- 表单打开 */

  const openMapForm = (map?: AtlasMap, entryNode?: AtlasNode) => {
    if (!disabled && !map && rawMaps.length >= ATLAS_LIMITS.maps) {
      notify(tr("地图数量已达到上限。"));
      return;
    }
    const currentKind = currentMap?.kind;
    const order = rawMaps.reduce((max, item) => Math.max(max, item.order || 0), 0) + 1;
    const draft: AtlasMap = map
      ? mapDraftOf(map)
      : {
          id: newId("atlas-map"),
          name: entryNode?.name || "",
          entryNodeId: entryNode?.id || "",
          kind: nextKindForMap(currentKind),
          parentMapId: currentMap?.id || "",
          description: "",
          theme: currentMap?.theme || "ink",
          status: "fixed",
          // 地图本身是作者背景资料：默认不绑定某一章，避免手建地图在定稿前被排除。
          chapterId: "",
          order,
        };
    setEditor({ kind: "map", draft, isNew: !map });
  };

  const openNodeForm = (node?: AtlasNode) => {
    if (!mapId) {
      notify(tr("请先新建一张地图。"));
      return;
    }
    if (!disabled && !node && rawNodes.length >= ATLAS_LIMITS.nodes) {
      notify(tr("节点数量已达到上限。"));
      return;
    }
    const draft: AtlasNode = node
      ? nodeDraftOf(node)
      : {
          id: newId("atlas-node"),
          mapId,
          parentId: "",
          kind: "landmark",
          name: "",
          description: "",
          ...defaultNodePosition(rawNodes, mapId),
          status: "fixed",
          // 地点是背景设定：默认始终可用；要记录某章才出现的地点，可在来源章节里选择。
          chapterId: "",
        };
    setEditor({ kind: "node", draft, isNew: !node });
  };

  const openEdgeForm = (source?: string, target?: string) => {
    if (!mapId || mapNodes.length < 2) {
      notify(tr("至少需要两个节点才能新建连线。"));
      return;
    }
    const draft: AtlasEdge = {
      id: newId("atlas-edge"),
      mapId,
      source: source || mapNodes[0].id,
      target: target || mapNodes.find((node) => node.id !== (source || mapNodes[0].id))?.id || mapNodes[1].id,
      kind: "link",
      label: "",
      status: "fixed",
      chapterId: "",
    };
    setEditor({ kind: "edge", draft, isNew: true });
  };

  const openEdgeEdit = (edge: AtlasEdge) => {
    setEditor({ kind: "edge", draft: edgeDraftOf(edge), isNew: false });
  };

  const openItemForm = (item?: AtlasItem) => {
    if (!mapId) return;
    const draft: AtlasItem = item
      ? itemDraftOf(item)
      : {
          id: newId("atlas-item"),
          name: "",
          description: "",
          nodeId: selectedNode?.id || "",
          ownerCharacterId: "",
          status: "fixed",
          chapterId: "",
        };
    setEditor({ kind: "item", draft, isNew: !item });
  };

  const openItemEdit = (item: AtlasItem) => {
    setEditor({ kind: "item", draft: itemDraftOf(item), isNew: false });
  };

  const openPositionForm = (position?: AtlasPosition) => {
    if (!mapId) return;
    const draft: AtlasPosition = position
      ? positionDraftOf(position)
      : {
          id: newId("atlas-position"),
          characterId: book.characters[0]?.id || "",
          nodeId: selectedNode?.id || mapNodes[0]?.id || "",
          chapterId: at,
          status: "present",
          note: "",
        };
    setEditor({ kind: "position", draft, isNew: !position });
  };

  const openPositionEdit = (position: AtlasPosition) => {
    setEditor({ kind: "position", draft: positionDraftOf(position), isNew: false });
  };

  const updateEditor = <T extends EditorState["kind"]>(kind: T, patch: Record<string, unknown>) => {
    setEditor((current) => {
      if (!current || current.kind !== kind) return current;
      return { ...current, draft: { ...current.draft, ...patch } } as EditorState;
    });
  };

  /* --------------------------------------------------------------- 保存表单 */

  const saveEditor = () => {
    if (!editor) return;
    const name = "name" in editor.draft ? editor.draft.name.trim() : "";
    if (editor.kind === "map") {
      if (!name) {
        notify(tr("地图还没有名称。"));
        return;
      }
      // 作者亲手保存过即视为确认资料：清除来源变更留下的待复核标记。
      const draft: AtlasMap = { ...editor.draft, name, stale: false };
      const next = editor.isNew
        ? [...rawMaps, draft]
        : rawMaps.map((map) => (map.id === draft.id ? draft : map));
      setMapId(draft.id);
      setEditor(null);
      commit({ atlasMaps: next }, tr("知识蓝图已保存"));
      return;
    }
    if (editor.kind === "node") {
      if (!name) {
        notify(tr("节点还没有名称。"));
        return;
      }
      const draft: AtlasNode = { ...editor.draft, name, stale: false };
      const next = editor.isNew
        ? [...rawNodes, draft]
        : rawNodes.map((node) => (node.id === draft.id ? draft : node));
      setSelection({ kind: "node", id: draft.id });
      setEditor(null);
      commit({ atlasNodes: next }, tr("知识蓝图已保存"));
      return;
    }
    if (editor.kind === "edge") {
      if (editor.draft.source === editor.draft.target) {
        notify(tr("连线需要两个不同的节点。"));
        return;
      }
      const draft: AtlasEdge = { ...editor.draft, stale: false };
      const next = editor.isNew
        ? [...rawEdges, draft]
        : rawEdges.map((edge) => (edge.id === draft.id ? draft : edge));
      setSelection({ kind: "edge", id: draft.id });
      setEditor(null);
      commit({ atlasEdges: next }, tr("知识蓝图已保存"));
      return;
    }
    if (editor.kind === "item") {
      if (!name) {
        notify(tr("物品还没有名称。"));
        return;
      }
      const draft: AtlasItem = { ...editor.draft, name, stale: false };
      const next = editor.isNew
        ? [...rawItems, draft]
        : rawItems.map((item) => (item.id === draft.id ? draft : item));
      setEditor(null);
      commit({ atlasItems: next }, tr("知识蓝图已保存"));
      return;
    }
    if (!editor.draft.characterId || !editor.draft.nodeId) {
      notify(tr("人物位置需要选择人物和地点。"));
      return;
    }
    const draft: AtlasPosition = { ...editor.draft, stale: false };
    const next = editor.isNew
      ? [...rawPositions, draft]
      : rawPositions.map((position) => (position.id === draft.id ? draft : position));
    setEditor(null);
    commit({ atlasPositions: next }, tr("知识蓝图已保存"));
  };

  /** 作者核对来源章节后，手动确认一条待复核资料仍然有效。 */
  const confirmRow = (
    kind: "map" | "node" | "edge" | "item" | "position",
    id: string,
  ) => {
    if (disabled) return;
    const clear = <T extends { id: string; stale?: boolean }>(rows: T[]) =>
      rows.map((row) => (row.id === id ? { ...row, stale: false } : row));
    const message = tr("已确认这条资料仍然有效");
    if (kind === "map") commit({ atlasMaps: clear(rawMaps) }, message);
    else if (kind === "node") commit({ atlasNodes: clear(rawNodes) }, message);
    else if (kind === "edge") commit({ atlasEdges: clear(rawEdges) }, message);
    else if (kind === "item") commit({ atlasItems: clear(rawItems) }, message);
    else commit({ atlasPositions: clear(rawPositions) }, message);
  };

  /* --------------------------------------------------------------- 删除资料 */

  const confirmDelete = (title: string, message: string, action: () => void) =>
    setConfirm({ title, message, action });

  const deleteMap = () => {
    if (!currentMap) return;
    const removedMaps = new Set([currentMap.id, ...descendantMapIds(rawMaps, currentMap.id)]);
    const removedNodes = new Set(rawNodes.filter((node) => removedMaps.has(node.mapId)).map((node) => node.id));
    confirmDelete(
      tr("删除地图？"),
      tr("删除后，这张地图、下级地图、节点与连线都会一并删除，物品会变为未定位，且无法恢复。"),
      () => {
        setMapId("");
        setSelection(null);
        setConfirm(null);
        commit(
          {
            atlasMaps: rawMaps.filter((map) => !removedMaps.has(map.id)),
            atlasNodes: rawNodes.filter((node) => !removedNodes.has(node.id)),
            atlasEdges: rawEdges.filter(
              (edge) => !removedMaps.has(edge.mapId) && !removedNodes.has(edge.source) && !removedNodes.has(edge.target),
            ),
            atlasItems: rawItems.map((item) =>
              removedNodes.has(item.nodeId) ? { ...item, nodeId: "" } : item,
            ),
            atlasPositions: rawPositions.filter((position) => !removedNodes.has(position.nodeId)),
          },
          tr("知识蓝图已删除"),
        );
      },
    );
  };

  const deleteNode = (node: AtlasNode) => {
    const removed = new Set([node.id, ...descendantNodeIds(rawNodes, node.id)]);
    confirmDelete(
      tr("删除节点？"),
      tr("相关连线与人物位置会一并删除，物品会变为未定位。删除后无法恢复。"),
      () => {
        setSelection(null);
        setConfirm(null);
        commit(
          {
            atlasNodes: rawNodes.filter((item) => !removed.has(item.id)),
            atlasEdges: rawEdges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
            atlasItems: rawItems.map((item) => (removed.has(item.nodeId) ? { ...item, nodeId: "" } : item)),
            atlasPositions: rawPositions.filter((position) => !removed.has(position.nodeId)),
          },
          tr("知识蓝图已删除"),
        );
      },
    );
  };

  const deleteEdge = (edge: AtlasEdge) =>
    confirmDelete(tr("删除连线？"), tr("删除后无法恢复。"), () => {
      setSelection(null);
      setConfirm(null);
      commit(
        { atlasEdges: rawEdges.filter((item) => item.id !== edge.id) },
        tr("知识蓝图已删除"),
      );
    });

  const deleteItem = (item: AtlasItem) =>
    confirmDelete(tr("删除物品？"), tr("删除后无法恢复。"), () => {
      setConfirm(null);
      commit(
        { atlasItems: rawItems.filter((entry) => entry.id !== item.id) },
        tr("知识蓝图已删除"),
      );
    });

  const deletePosition = (position: AtlasPosition) =>
    confirmDelete(tr("删除人物位置？"), tr("删除后无法恢复。"), () => {
      setConfirm(null);
      commit(
        { atlasPositions: rawPositions.filter((entry) => entry.id !== position.id) },
        tr("知识蓝图已删除"),
      );
    });

  /* --------------------------------------------------------------- 整理与归纳 */

  const arrange = () => {
    if (!mapId || !mapNodes.length) return;
    const next = autoLayoutNodes(rawNodes, mapId);
    commit({ atlasNodes: next }, tr("已整理，锁定位置保留"));
    setFitToken((token) => token + 1);
  };

  const seedFromMaterials = () => {
    const existed = {
      maps: rawMaps.length,
      nodes: rawNodes.length,
      items: rawItems.length,
      positions: rawPositions.length,
    };
    const patch = mergeAtlasSeed(book);
    const added =
      patch.atlasMaps.length - existed.maps +
      patch.atlasNodes.length - existed.nodes +
      patch.atlasItems.length - existed.items +
      patch.atlasPositions.length - existed.positions;
    if (added <= 0) {
      notify(tr("现有资料里还没有可归纳的地图资料。"));
      return;
    }
    commit(patch, tr("已从现有资料归纳知识蓝图"));
    setFitToken((token) => token + 1);
  };

  /* --------------------------------------------------------------- 选择辅助 */

  const mapTrail = useMemo(() => {
    const trail: AtlasMapView[] = [];
    const guard = new Set<string>();
    let cursor = mapId ? mapById.get(mapId) : undefined;
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      trail.unshift(cursor);
      cursor = cursor.parentMapId ? mapById.get(cursor.parentMapId) : undefined;
    }
    return trail;
  }, [mapById, mapId]);
  const relatedMaps = useMemo(
    () => (mapId ? onMapLinked(projection.maps, mapId) : []),
    [projection.maps, mapId],
  );
  const lineage = useMemo(() => mapLineage(projection.maps), [projection.maps]);
  const groupedLineage = useMemo(() => {
    const groups = new Map<string, typeof lineage>();
    for (const entry of lineage) {
      const list = groups.get(entry.rootId) || [];
      list.push(entry);
      groups.set(entry.rootId, list);
    }
    return [...groups.entries()];
  }, [lineage]);
  const nodeItems = useMemo(
    () => (selectedNode ? projection.items.filter((item) => item.nodeId === selectedNode.id) : []),
    [projection.items, selectedNode],
  );
  const nodePositions = useMemo(
    () => (selectedNode ? projection.positions.filter((position) => position.nodeId === selectedNode.id) : []),
    [projection.positions, selectedNode],
  );
  const nodeEdges = useMemo(
    () =>
      selectedNode
        ? projection.edges.filter(
            (edge) => edge.source === selectedNode.id || edge.target === selectedNode.id,
          )
        : [],
    [projection.edges, selectedNode],
  );
  const staleCount =
    projection.stats.staleMaps +
    projection.stats.staleNodes +
    projection.stats.staleEdges +
    projection.stats.staleItems +
    projection.stats.stalePositions;
  const staleNodes = useMemo(
    () => [...projection.nodes, ...projection.edges, ...projection.items, ...projection.positions].filter(
      (entry) => entry.state === "stale",
    ),
    [projection],
  );
  const staleEntryLabel = (
    entry: AtlasNodeView | AtlasEdgeView | AtlasItemView | AtlasPositionView,
  ) => {
    if ("name" in entry) return entry.name;
    if ("label" in entry) return entry.label || tr(ATLAS_EDGE_KIND_LABELS[entry.kind]);
    return characterName(book, entry.characterId);
  };
  const chapterItems = useMemo(
    () => (at ? projection.items.filter((item) => item.chapterId === at) : []),
    [projection.items, at],
  );
  const chapterPositions = useMemo(
    () => (at ? projection.positions.filter((position) => position.chapterId === at) : []),
    [projection.positions, at],
  );
  const edgePath = (edge: AtlasEdge) => {
    const source = nodeIds.has(edge.source) ? mapNodes.find((node) => node.id === edge.source) : undefined;
    const target = nodeIds.has(edge.target) ? mapNodes.find((node) => node.id === edge.target) : undefined;
    if (!source || !target) return null;
    const from = { ...positionOf(source) };
    const to = { ...positionOf(target) };
    const fromSize = ATLAS_NODE_SIZES[source.kind] || { width: 168, height: 72 };
    const toSize = ATLAS_NODE_SIZES[target.kind] || { width: 168, height: 72 };
    const dx = to.x - from.x,
      dy = to.y - from.y;
    if (!dx && !dy) return null;
    const startScale = Math.min(
      dx ? fromSize.width / 2 / Math.abs(dx) : Infinity,
      dy ? fromSize.height / 2 / Math.abs(dy) : Infinity,
    );
    const endScale = Math.min(
      dx ? toSize.width / 2 / Math.abs(dx) : Infinity,
      dy ? toSize.height / 2 / Math.abs(dy) : Infinity,
    );
    const start = { x: from.x + dx * startScale, y: from.y + dy * startScale };
    const end = { x: to.x - dx * endScale, y: to.y - dy * endScale };
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    if (edge.kind === "contain") {
      return { d: `M${start.x} ${start.y}L${end.x} ${end.y}`, mid };
    }
    const bend = Math.min(160, Math.max(28, Math.hypot(dx, dy) * 0.16));
    const control = {
      x: mid.x - dy * 0.001 * bend * 8,
      y: mid.y + dx * 0.001 * bend * 8,
    };
    return {
      d: `M${start.x} ${start.y}Q${control.x} ${control.y} ${end.x} ${end.y}`,
      mid: {
        x: (start.x + 2 * control.x + end.x) / 4,
        y: (start.y + 2 * control.y + end.y) / 4,
      },
    };
  };

  /* --------------------------------------------------------------- 渲染工具 */

  const statusLabel = (state: AtlasEffectiveState) => tr(ATLAS_STATE_LABELS[state]);
  const stateClass = (state: AtlasEffectiveState) => nodeInk(state);
  const dateLabel = (chapter: string) => chapterLabel(book, chapter);
  const nodeLabel = (node: AtlasNode) =>
    textOr(node.name || "", NODE_LABEL_LENGTH) || tr("未命名节点");

  const relatedPositionEntries = chapterPositions.map((position) => ({
    position,
    person: characterName(book, position.characterId),
    node: nodeNameOf(mapNodes, position.nodeId) || tr("未定位"),
  }));
  const relatedItemEntries = chapterItems.map((item) => ({
    item,
    node: item.nodeId ? nodeNameOf(mapNodes, item.nodeId) || tr("未定位") : tr("未定位"),
    owner: item.ownerCharacterId ? characterName(book, item.ownerCharacterId) : "",
  }));

  const viewBoxSize = ATLAS_COORD_MAX / viewport.zoom;

  /* ================================================================= 渲染 */
  return (
    <section className="knowledge-atlas" aria-label={tr("知识蓝图")}>
      <header className="ka-toolbar">
        <div className="ka-toolbar-row">
          <div className="ka-map-switch">
            <MapTrifold size={17} aria-hidden />
            <select
              className="ka-map-select"
              aria-label={tr("切换地图")}
              value={mapId}
              disabled={!projection.maps.length}
              onChange={(event) => {
                navigate(event.target.value);
              }}
            >
              <option value="">{tr("全书世界")}</option>
              {groupedLineage.map(([rootId, entries]) => (
                <optgroup
                  key={rootId}
                  label={entries[0]?.rootName || tr("蓝图地图")}
                >
                  {entries.map((entry) => (
                    <option key={entry.map.id} value={entry.map.id}>
                      {`${"　".repeat(entry.depth)}${entry.map.name || tr("未命名地图")}`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          {(
            <nav className="ka-breadcrumb" aria-label={tr("地图层级")}>
              <button type="button" aria-current={!mapId?"page":undefined} onClick={()=>navigate("")}>{tr("全书世界")}</button>
              {mapTrail.map((map, index) => (
                <span key={map.id}>
                  <span aria-hidden>›</span>
                  <button
                    type="button"
                    className={map.id === mapId ? "is-current" : ""}
                    aria-current={map.id === mapId ? "page" : undefined}
                    onClick={() => navigate(map.id)}
                  >
                    {map.name || tr("未命名地图")}
                  </button>
                </span>
              ))}
            </nav>
          )}
          {projection.maps.length>0&&<select className="ka-peer-select" aria-label={tr('切换同级地图')} value={mapId} onChange={event=>navigate(event.target.value)}><option value="">{tr('全书世界')}</option>{projection.maps.filter(map=>map.parentMapId===(currentMap?.parentMapId||'')).map(map=><option key={map.id} value={map.id}>{map.name}</option>)}</select>}
          <div className="ka-lens-tabs" role="group" aria-label={tr('蓝图展示类型')}>
            {([['combined','综合'],['places','地点'],['people','人物'],['items','物品']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={lens===id} onClick={()=>{setLens(id);setSelection(null);setConnect(null);}}>{tr(label)}</button>)}
          </div>
          <details className="ka-tools"><summary>{tr('地图管理')}</summary><div className="ka-toolbar-actions">
            <Button
              variant="primary-soft"
              disabled={locked}
              aria-label={tr("新建地图")}
              onClick={() => openMapForm()}
            >
              <Plus size={15} />{tr("新建地图")}
            </Button>
            <Button
              disabled={!currentMap || locked}
              aria-label={tr("编辑当前地图")}
              onClick={() => (currentMap ? openMapForm(currentMap) : undefined)}
            >
              <PencilSimple size={15} />{tr("编辑当前地图")}
            </Button>
            <Button
              disabled={!currentMap || locked}
              aria-label={tr("删除地图")}
              onClick={deleteMap}
            >
              <Trash size={15} />{tr("删除地图")}
            </Button>
          </div></details>
        </div>
        <div className="ka-toolbar-row ka-toolbar-filters">
          <label className="ka-field-inline">
            <span>{tr("截至章节")}</span>
            <select
              aria-label={tr("截至章节")}
              value={at}
              onChange={(event) => setAt(event.target.value)}
            >
              <option value="">{tr("故事开始前")}</option>
              {bookChapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.title}{" "}{tr("· 章末")}
                </option>
              ))}
            </select>
          </label>
          <label className="ka-check">
            <input
              type="checkbox"
              checked={showPlans}
              onChange={(event) => setShowPlans(event.target.checked)}
            />
            {tr("显示计划")}
          </label>
          <label className="ka-check">
            <input
              type="checkbox"
              checked={onlyChapter}
              onChange={(event) => setOnlyChapter(event.target.checked)}
            />
            {tr("只看本章涉及")}
          </label>
          <select aria-label={tr('查看范围')} value={includeDescendants?'descendants':'level'} onChange={event=>setIncludeDescendants(event.target.value==='descendants')}><option value="descendants">{tr('包含下级空间')}</option><option value="level">{tr('仅本层空间')}</option></select>
          <details className="ka-tools"><summary>{tr('添加与整理')}</summary><div className="ka-tool-popover">
          <span className="ka-toolbar-divider" aria-hidden />
          <Button disabled={!mapId || locked} onClick={() => openNodeForm()}>
            <Plus size={15} />{tr("新建节点")}
          </Button>
          <Button
            disabled={!mapId || locked || mapNodes.length < 2}
            onClick={() => (connect ? setConnect(null) : setConnect({ source: null }))}
            aria-pressed={!!connect}
            className={connect ? "active" : ""}
          >
            <LinkIcon size={15} />{tr("新建边")}
          </Button>
          <Button disabled={!currentMap || locked} onClick={() => openItemForm()}>
            <Plus size={15} />{tr("添加物品")}
          </Button>
          <Button
            disabled={!currentMap || locked || !book.characters.length}
            onClick={() => openPositionForm()}
          >
            <Plus size={15} />{tr("添加人物位置")}
          </Button>
          <Button disabled={!mapId || locked || !mapNodes.length} onClick={arrange}>
            <SquaresFour size={15} />{tr("自动整理")}
          </Button>
          {projection.maps.length > 0 && (
            <Button
              disabled={!currentMap || locked}
              onClick={seedFromMaterials}
              aria-label={tr("从现有资料归纳")}
            >
              {tr("从现有资料归纳")}
            </Button>
          )}
          </div></details>
          <label className="ka-search">
            <MagnifyingGlass size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tr(lens==="people"?"搜索人物":lens==="items"?"搜索物品":"搜索节点")}
              aria-label={tr("搜索蓝图资料")}
            />
          </label>
          <Button aria-pressed={inspectorOpen} onClick={()=>{setInspectorOpen(!inspectorOpen);setSelection(null);}}>{tr('详情')}</Button>
          <Button
            className={showReference ? "active" : ""}
            aria-pressed={showReference}
            onClick={() => setShowReference(!showReference)}
          >
            {showReference ? tr("隐藏参考板块") : tr("显示参考板块")}
          </Button>
        </div>
        {connect && (
          <div className="ka-connect-hint" role="status">
            <LinkIcon size={15} />
            {connect.source
              ? tr("再点选另一个节点完成连线。")
              : tr("点选一个节点作为连线起点。")}
            <Button onClick={() => setConnect(null)}>{tr("取消连线")}</Button>
          </div>
        )}
      </header>

      <ChapterSyncStatus book={book} chapterId={at} onReview={onReviewChapter}/>
      {mapId&&childMaps.length>0&&<div className="ka-child-nav" aria-label={tr('下级地图入口')}><span>{tr('进入下级')}</span>{childMaps.map(map=><button type="button" key={map.id} onClick={()=>navigate(map.id)}>{map.name} →</button>)}</div>}
      <div className="ka-body">
        <div
          ref={stageRef}
          className={`ka-stage${connect ? " is-connecting" : ""}${isLens?" is-lens":""}`}
          data-testid="knowledge-atlas-stage"
          tabIndex={0}
          aria-label={tr("地图画布：拖动空白平移，滚轮缩放，拖动节点调整位置，双击节点编辑。")}
          onPointerDown={beginPan}
          onPointerMove={movePointer}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onKeyDown={stageKeyDown}
        >
          {isLens&&projection.maps.length>0&&<AtlasScopeView book={book} projection={projection} mapId={mapId} descendants={includeDescendants} onlyChapter={onlyChapter} mode={lens==='people'?'people':lens==='items'?'items':'overview'} query={query} onMap={navigate} onNode={id=>{const node=projection.nodes.find(n=>n.id===id);if(node){navigate(node.mapId);setLens('places');setSelection({kind:'node',id});}}} onItem={id=>{const item=projection.items.find(i=>i.id===id);if(item)openItemEdit(item);}}/>}
          {!isLens&&selectedNode&&<div className="ka-node-entry">{enteredMaps(selectedNode.id).length?enteredMaps(selectedNode.id).map(map=><Button key={map.id} onClick={()=>navigate(map.id)}>{tr('进入')} {map.name} →</Button>):<Button disabled={locked} onClick={()=>openMapForm(undefined,selectedNode)}>{tr('建立内部地图')}</Button>}</div>}
          <svg
            ref={svgRef}
            className="ka-svg"
            viewBox={`${viewport.x} ${viewport.y} ${viewBoxSize} ${viewBoxSize}`}
            preserveAspectRatio="xMidYMid meet"
            data-atlas-theme={currentTheme}
            role="group"
            aria-label={tr("知识蓝图地图")}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                <stop className="ka-grad-start" offset="0" />
                <stop className="ka-grad-end" offset="1" />
              </linearGradient>
              <pattern id={gridId} width={64} height={64} patternUnits="userSpaceOnUse">
                <path className="ka-grid-line" d="M64 0H0V64" />
              </pattern>
              <pattern id={contourId} width={380} height={380} patternUnits="userSpaceOnUse">
                <path className="ka-contour-line" d="M-40 150Q60 96 170 150T400 150" />
                <path className="ka-contour-line" d="M-40 260Q70 206 180 260T410 260" />
                <path className="ka-contour-line" d="M-40 350Q80 300 190 350T420 350" />
              </pattern>
              <pattern id={roomId} width={200} height={120} patternUnits="userSpaceOnUse">
                <rect className="ka-room-line" x={14} y={14} width={172} height={92} rx={3} />
                <path className="ka-room-line" d="M100 14V106" />
              </pattern>
              <marker
                id={arrowId}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path className="ka-arrow" d="M0 0 10 5 0 10Z" />
              </marker>
              <marker
                id={warningArrowId}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path className="ka-arrow ka-arrow-warning" d="M0 0 10 5 0 10Z" />
              </marker>
            </defs>
            <rect className="ka-bg" width={ATLAS_COORD_MAX} height={ATLAS_COORD_MAX} fill={`url(#${gradientId})`} />
            <rect
              className="ka-grid"
              width={ATLAS_COORD_MAX}
              height={ATLAS_COORD_MAX}
              fill={`url(#${gridId})`}
            />
            <rect
              className="ka-contour"
              width={ATLAS_COORD_MAX}
              height={ATLAS_COORD_MAX}
              fill={`url(#${contourId})`}
            />
            {showRoomPattern && (
              <rect
                className="ka-rooms"
                width={ATLAS_COORD_MAX}
                height={ATLAS_COORD_MAX}
                fill={`url(#${roomId})`}
              />
            )}
            <rect className="ka-border" x={18} y={18} width={ATLAS_COORD_MAX - 36} height={ATLAS_COORD_MAX - 36} rx={16} />
            <text className="ka-map-name" x={40} y={58}>
              {currentMap?.name || tr("知识蓝图")}
            </text>
            <text className="ka-map-kind" x={40} y={84}>
              {currentMap ? tr(ATLAS_MAP_KIND_LABELS[currentMap.kind]) : tr("还没有地图")}
            </text>
            <g
              transform={`translate(${viewport.x + viewBoxSize - 54} ${viewport.y + 42})`}
              aria-hidden
            >
              <path className="ka-compass" d="M0 -22 7 6 0 1 -7 6Z" />
              <text className="ka-compass-label" y={22} textAnchor="middle">N</text>
            </g>
            <g className="ka-edges" aria-label={tr("地点关系")}>
              {edges.map((edge) => {
                const path = edgePath(edge);
                if (!path) return null;
                const warning = edge.state === "stale" || edge.state === "provisional";
                const selected = selection?.kind === "edge" && selection.id === edge.id;
                const label = edge.label || tr(ATLAS_EDGE_KIND_LABELS[edge.kind]);
                return (
                  <g
                    key={edge.id}
                    className={`ka-edge ka-edge-${edge.kind} ${stateClass(edge.state)}${selected ? " is-selected" : ""}`}
                    data-atlas-edge-id={edge.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${label}，${tr(ATLAS_EDGE_KIND_LABELS[edge.kind])}，${statusLabel(edge.state)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (connect) {
                        setConnect(null);
                        return;
                      }
                      setSelection({ kind: "edge", id: edge.id });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        setSelection({ kind: "edge", id: edge.id });
                      }
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      if (!disabled) openEdgeEdit(edge);
                    }}
                  >
                    <title>{`${label} · ${statusLabel(edge.state)}`}</title>
                    <path className="ka-edge-hit" d={path.d} />
                    <path
                      className="ka-edge-line"
                      d={path.d}
                      markerEnd={
                        edge.kind === "contain" ? undefined : `url(#${warning ? warningArrowId : arrowId})`
                      }
                    />
                    {edge.kind === "portal" && <path className="ka-edge-dash" d={path.d} />}
                    {label && (
                      <g className="ka-edge-label" transform={`translate(${path.mid.x},${path.mid.y})`}>
                        <rect x={-Math.max(34, label.length * 9) / 2} y={-11} width={Math.max(34, label.length * 9)} height={22} rx={5} />
                        <text textAnchor="middle" dominantBaseline="central">{label}</text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
            <g className="ka-nodes">
              {nodes.map((node) => {
                const position = positionOf(node);
                const size = ATLAS_NODE_SIZES[node.kind] || { width: 168, height: 72 };
                const selected = selection?.kind === "node" && selection.id === node.id;
                const label = nodeLabel(node);
                return (
                  <g
                    key={node.id}
                    className={`ka-node ka-kind-${node.kind} ${stateClass(node.state)}${selected ? " is-selected" : ""}`}
                    data-atlas-node-id={node.id}
                    transform={`translate(${position.x},${position.y})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.name || tr("未命名节点")}，${tr(ATLAS_NODE_KIND_LABELS[node.kind])}，${statusLabel(node.state)}`}
                    aria-pressed={selected}
                    onClick={(event) => {
                      event.stopPropagation();
                      pickNode(node.id);
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      if (!connect) {
                        const child=enteredMaps(node.id)[0];
                        if(child)navigate(child.id);else if(!disabled)openNodeForm(node);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        pickNode(node.id);
                      } else if ((event.key === "e" || event.key === "E" || event.key === "F2") && !disabled) {
                        event.preventDefault();
                        event.stopPropagation();
                        openNodeForm(node);
                      }
                    }}
                    onPointerDown={(event) => beginNodeDrag(event, node)}
                  >
                    <title>{node.name || tr("未命名节点")}</title>
                    {connect?.source && connect.source !== node.id && (
                      <circle className="ka-connect-target" r={Math.max(size.width, size.height) * 0.5 + 18} />
                    )}
                    <NodeShape kind={node.kind} />
                    <NodeGlyph kind={node.kind} />
                    <text className="ka-node-name" y={size.height / 2 + 17} textAnchor="middle">
                      {label}
                    </text>
                    {node.state !== "fixed" && node.state !== "confirmed" && (
                      <text className="ka-node-badge" y={size.height / 2 + 32} textAnchor="middle">
                        {statusLabel(node.state)}
                      </text>
                    )}
                    {enteredMaps(node.id).length>0&&<text className="ka-node-entry-label" y={-size.height/2-12} textAnchor="middle">{tr('可进入')} →</text>}
                    {lens==='combined'&&<text className="ka-node-entry-label" y={size.height/2+46} textAnchor="middle">{scope.positions.filter(p=>nodeScopeIds(node.id).has(p.nodeId)).length} {tr('人物')} · {scope.items.filter(item=>nodeScopeIds(node.id).has(item.nodeId)).length} {tr('物品')}</text>}
                    {node.stale && <circle className="ka-node-warning" cx={size.width / 2 - 8} cy={-size.height / 2 + 8} r={5} />}
                  </g>
                );
              })}
            </g>
          </svg>

          {!projection.maps.length && (
            <div className="ka-empty" role="status">
              <MapTrifold size={32} />
              <strong>{tr("还没有地图")}</strong>
              <p>{tr("新建第一张地图，或从现有资料归纳已有的地点、人物和物品。")}</p>
              <div className="ka-empty-actions">
                <Button variant="primary" disabled={locked} onClick={() => openMapForm()}>
                  <Plus size={15} />{tr("新建第一张地图")}
                </Button>
                <Button disabled={locked} onClick={seedFromMaterials}>
                  {tr("从现有资料归纳")}
                </Button>
              </div>
              <p className="ka-empty-note">
                {tr("归纳只使用现有世界资料、人物和事实记忆，不推断新内容。")}
              </p>
            </div>
          )}
          {!isLens && projection.maps.length > 0 && !!currentMap && !nodes.length && (
            <div className="ka-empty" role="status">
              <MapTrifold size={30} />
              <strong>
                {searchTerm ? tr("没有找到匹配的节点") : tr("这张地图还没有节点")}
              </strong>
              <p>
                {searchTerm
                  ? tr("试试其他关键词，或清空搜索。")
                  : onlyChapter
                    ? tr("本章还没有涉及这张地图上的节点。")
                    : tr("新建节点，或从现有资料归纳初始地图。")}
              </p>
              <div className="ka-empty-actions">
                <Button
                  variant="primary"
                  disabled={locked}
                  onClick={() => openNodeForm()}
                >
                  <Plus size={15} />{tr("新建第一个节点")}
                </Button>
                {searchTerm && (
                  <Button onClick={() => setQuery("")}>{tr("清空搜索")}</Button>
                )}
              </div>
            </div>
          )}

          <div className="ka-zoom">
            <IconButton label={tr("缩小地图")} onClick={() => zoomAt(1 / 1.2)}>
              <Minus size={15} />
            </IconButton>
            <output aria-label={tr("地图缩放比例")}>{Math.round(viewport.zoom * 100)}%</output>
            <IconButton label={tr("放大地图")} onClick={() => zoomAt(1.2)}>
              <Plus size={15} />
            </IconButton>
            <IconButton label={tr("适应地图")} disabled={!mapNodes.length} onClick={fitToNodes}>
              <ArrowsOut size={16} />
            </IconButton>
          </div>
          <div className="ka-legend">
            {ATLAS_EDGE_KINDS.map((kind) => (
              <span key={kind}>
                <i className={`ka-legend-line ka-edge-${kind}`} />
                {tr(ATLAS_EDGE_KIND_LABELS[kind])}
              </span>
            ))}
            <span>
              <i className="ka-legend-dot is-planned" />
              {tr("计划")}
            </span>
            <span>
              <i className="ka-legend-dot is-stale" />
              {tr("待复核")}
            </span>
          </div>
          <div className="ka-stage-hint">
            {connect
              ? connect.source
                ? tr("再点选另一个节点完成连线。")
                : tr("点选一个节点作为连线起点。")
              : tr("拖动空白平移 · 滚轮缩放 · 双击进入子地图，无子地图时编辑")}
          </div>
        </div>

        {(inspectorOpen||selection)&&<aside className="ka-inspector" aria-label={tr("知识蓝图检查器")}>
          <header className="ka-inspector-head">
            <strong>
              {selectedNode
                ? tr("节点详情")
                : selectedEdge
                  ? tr("连线详情")
                  : tr("地图详情")}
            </strong>
            <div className="ka-inspector-head-actions">
              {saving && <span className="ka-saving">{tr("正在保存…")}</span>}
              {(selectedNode || selectedEdge) && (
                <IconButton label={tr("关闭")} onClick={() => {setSelection(null);setInspectorOpen(false);}}>
                  <X size={16} />
                </IconButton>
              )}
            </div>
          </header>

          {selectedNode ? (
            <div className="ka-detail">
              <span className={`ka-state ${stateClass(selectedNode.state)}`}>
                {statusLabel(selectedNode.state)}
              </span>
              <h3>{selectedNode.name || tr("未命名节点")}</h3>
              <dl className="ka-meta">
                <div>
                  <dt>{tr("类型")}</dt>
                  <dd>{tr(ATLAS_NODE_KIND_LABELS[selectedNode.kind])}</dd>
                </div>
                <div>
                  <dt>{tr("来源章节")}</dt>
                  <dd>{dateLabel(selectedNode.chapterId)}</dd>
                </div>
                {selectedNode.parentId && (
                  <div>
                    <dt>{tr("上级地点")}</dt>
                    <dd>{nodeNameOf(mapNodes, selectedNode.parentId) || "—"}</dd>
                  </div>
                )}
              </dl>
              {(selectedNode.state === "stale" || selectedNode.stale) && (
                <p className="ka-warning" role="status">
                  <WarningCircle size={15} />
                  {tr("来源已失效，请回到来源章节核对后再确认。")}
                  <Button disabled={locked} onClick={() => confirmRow("node", selectedNode.id)}>
                    {tr("确认有效")}
                  </Button>
                </p>
              )}
              <p className="ka-description">
                {selectedNode.description || tr("尚未填写内容。")}
              </p>
              {selectedNode.state === "planned" && (
                <p className="ka-note">{tr("这是后续计划，尚未发生")}</p>
              )}
              <div className="ka-detail-actions">
                <Button disabled={locked} onClick={() => openNodeForm(selectedNode)}>
                  <PencilSimple size={14} />{tr("编辑节点")}
                </Button>
                <Button disabled={locked || mapNodes.length < 2} onClick={() => setConnect({ source: selectedNode.id })}>
                  <LinkIcon size={14} />{tr("从此节点连线")}
                </Button>
                <Button disabled={locked} onClick={() => openItemForm()}>
                  <Plus size={14} />{tr("在此节点添加物品")}
                </Button>
                <Button
                  disabled={locked || !book.characters.length}
                  onClick={() => openPositionForm()}
                >
                  <Plus size={14} />{tr("在此节点添加人物位置")}
                </Button>
                <Button disabled={locked} onClick={() => deleteNode(selectedNode)}>
                  <Trash size={14} />{tr("删除节点")}
                </Button>
              </div>

              <section className="ka-subsection">
                <h4>{tr("人物位置")}</h4>
                {nodePositions.length ? (
                  <ul className="ka-list">
                    {nodePositions.map((position) => (
                      <li key={position.id} className={position.state === "stale" ? "is-stale" : ""}>
                        <span className="ka-list-main">
                          {characterName(book, position.characterId)}
                          <em>{tr(ATLAS_POSITION_STATUS_LABELS[position.status])}</em>
                          {position.state === "stale" && <em className="is-warning">{tr("待复核")}</em>}
                        </span>
                        <span className="ka-list-note">
                          {dateLabel(position.chapterId)}
                          {position.note ? ` · ${position.note}` : ""}
                        </span>
                        <span className="ka-list-actions">
                          <button type="button" disabled={locked} onClick={() => openPositionEdit(position)}>
                            {tr("编辑")}
                          </button>
                          {position.state === "stale" && (
                            <button type="button" disabled={locked} onClick={() => confirmRow("position", position.id)}>
                              {tr("确认有效")}
                            </button>
                          )}
                          <button type="button" disabled={locked} onClick={() => deletePosition(position)}>
                            {tr("删除")}
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ka-placeholder">—</p>
                )}
              </section>

              <section className="ka-subsection">
                <h4>{tr("物品归属")}</h4>
                {nodeItems.length ? (
                  <ul className="ka-list">
                    {nodeItems.map((item) => (
                      <li key={item.id} className={item.state === "stale" ? "is-stale" : ""}>
                        <span className="ka-list-main">
                          {item.name}
                          <em>
                            {item.ownerCharacterId ? characterName(book, item.ownerCharacterId) : tr("无明确归属")}
                          </em>
                          {item.state === "stale" && <em className="is-warning">{tr("待复核")}</em>}
                        </span>
                        <span className="ka-list-actions">
                          <button type="button" disabled={locked} onClick={() => openItemEdit(item)}>
                            {tr("编辑")}
                          </button>
                          {item.state === "stale" && (
                            <button type="button" disabled={locked} onClick={() => confirmRow("item", item.id)}>
                              {tr("确认有效")}
                            </button>
                          )}
                          <button type="button" disabled={locked} onClick={() => deleteItem(item)}>
                            {tr("删除")}
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ka-placeholder">—</p>
                )}
              </section>

              <section className="ka-subsection">
                <h4>{tr("地点关系")}</h4>
                {nodeEdges.length ? (
                  <ul className="ka-list">
                    {nodeEdges.map((edge) => (
                      <li key={edge.id} className={edge.state === "stale" ? "is-stale" : ""}>
                        <button
                          type="button"
                          className="ka-list-link"
                          onClick={() => setSelection({ kind: "edge", id: edge.id })}
                        >
                          {edge.label || tr(ATLAS_EDGE_KIND_LABELS[edge.kind])}
                          <span>
                            → {nodeNameOf(mapNodes, edge.source === selectedNode.id ? edge.target : edge.source) || "—"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ka-placeholder">—</p>
                )}
              </section>
            </div>
          ) : selectedEdge ? (
            <div className="ka-detail">
              <span className={`ka-state ${stateClass(selectedEdge.state)}`}>
                {statusLabel(selectedEdge.state)}
              </span>
              <h3>{selectedEdge.label || tr(ATLAS_EDGE_KIND_LABELS[selectedEdge.kind])}</h3>
              <dl className="ka-meta">
                <div>
                  <dt>{tr("类型")}</dt>
                  <dd>{tr(ATLAS_EDGE_KIND_LABELS[selectedEdge.kind])}</dd>
                </div>
                <div>
                  <dt>{tr("连线起点")}</dt>
                  <dd>{nodeNameOf(mapNodes, selectedEdge.source) || "—"}</dd>
                </div>
                <div>
                  <dt>{tr("连线终点")}</dt>
                  <dd>{nodeNameOf(mapNodes, selectedEdge.target) || "—"}</dd>
                </div>
                <div>
                  <dt>{tr("来源章节")}</dt>
                  <dd>{dateLabel(selectedEdge.chapterId)}</dd>
                </div>
              </dl>
              {selectedEdge.state === "stale" && (
                <p className="ka-warning" role="status">
                  <WarningCircle size={15} />
                  {tr("来源已失效，请回到来源章节核对后再确认。")}
                  <Button disabled={locked} onClick={() => confirmRow("edge", selectedEdge.id)}>
                    {tr("确认有效")}
                  </Button>
                </p>
              )}
              <div className="ka-detail-actions">
                <Button disabled={locked} onClick={() => openEdgeEdit(selectedEdge)}>
                  <PencilSimple size={14} />{tr("编辑连线")}
                </Button>
                <Button disabled={locked} onClick={() => deleteEdge(selectedEdge)}>
                  <Trash size={14} />{tr("删除连线")}
                </Button>
              </div>
            </div>
          ) : currentMap ? (
            <div className="ka-detail">
              <span className={`ka-state ${stateClass(currentMap.state)}`}>
                {statusLabel(currentMap.state)}
              </span>
              <h3>{currentMap.name || tr("未命名地图")}</h3>
              <dl className="ka-meta">
                <div>
                  <dt>{tr("类型")}</dt>
                  <dd>{tr(ATLAS_MAP_KIND_LABELS[currentMap.kind])}</dd>
                </div>
                <div>
                  <dt>{tr("地图主题")}</dt>
                  <dd>{tr(ATLAS_THEME_LABELS[themeOf(currentMap.theme)])}</dd>
                </div>
                <div>
                  <dt>{tr("来源章节")}</dt>
                  <dd>{dateLabel(currentMap.chapterId)}</dd>
                </div>
                {currentMap.parentMapId && mapById.get(currentMap.parentMapId) && (
                  <div>
                    <dt>{tr("上级地图")}</dt>
                    <dd>{mapById.get(currentMap.parentMapId)?.name || "—"}</dd>
                  </div>
                )}
              </dl>
              {(currentMap.state === "stale" || currentMap.stale) && (
                <p className="ka-warning" role="status">
                  <WarningCircle size={15} />
                  {tr("来源已失效，请回到来源章节核对后再确认。")}
                  <Button disabled={locked} onClick={() => confirmRow("map", currentMap.id)}>
                    {tr("确认有效")}
                  </Button>
                </p>
              )}
              <p className="ka-description">
                {currentMap.description || tr("尚未填写内容。")}
              </p>
              <div className="ka-stat-grid">
                <span>{tr("蓝图地图")} <b>{projection.stats.maps}</b></span>
                <span>{tr("地点节点")} <b>{projection.stats.nodes}</b></span>
                <span>{tr("地点关系")} <b>{projection.stats.edges}</b></span>
                <span>{tr("物品归属")} <b>{projection.stats.items}</b></span>
                <span>{tr("人物位置")} <b>{projection.stats.positions}</b></span>
                <span className="is-warning">{tr("待复核")} <b>{staleCount}</b></span>
              </div>
              <div className="ka-detail-actions">
                <Button disabled={locked} onClick={() => openMapForm(currentMap)}>
                  <PencilSimple size={14} />{tr("编辑地图")}
                </Button>
              </div>
              {relatedMaps.length > 0 && (
                <section className="ka-subsection">
                  <h4>{tr("关联地图")}</h4>
                  <div className="ka-chip-row">
                    {relatedMaps.map((map) => (
                      <button
                        key={map.id}
                        type="button"
                        className="ka-chip"
                        onClick={() => {
                          navigate(map.id);
                        }}
                      >
                        {map.name || tr("未命名地图")}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {projection.positions.length > 0 && (
                <section className="ka-subsection" aria-label={tr("人物位置")}>
                  <h4>{tr("人物位置")}</h4>
                  <ul className="ka-list">
                    {scope.positions.slice(0, 20).map((position) => (
                      <li key={position.id} className={position.state === "stale" ? "is-stale" : ""}>
                        <span className="ka-list-main">
                          {characterName(book, position.characterId)}
                          <em>{tr(ATLAS_POSITION_STATUS_LABELS[position.status])}</em>
                          {position.state === "stale" && <em className="is-warning">{tr("待复核")}</em>}
                        </span>
                        <span className="ka-list-note">
                          {projection.nodes.find((node) => node.id === position.nodeId)?.name || tr("未定位")}
                        </span>
                        <span className="ka-list-actions">
                          <button type="button" disabled={locked} onClick={() => openPositionEdit(position)}>
                            {tr("编辑")}
                          </button>
                          {position.state === "stale" && (
                            <button type="button" disabled={locked} onClick={() => confirmRow("position", position.id)}>
                              {tr("确认有效")}
                            </button>
                          )}
                          <button type="button" disabled={locked} onClick={() => deletePosition(position)}>
                            {tr("删除")}
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {projection.items.length > 0 && (
                <section className="ka-subsection" aria-label={tr("物品归属")}>
                  <h4>{tr("物品归属")}</h4>
                  <ul className="ka-list">
                    {scope.items.slice(0, 20).map((item) => (
                      <li key={item.id} className={item.state === "stale" ? "is-stale" : ""}>
                        <span className="ka-list-main">
                          {item.name}
                          <em>
                            {item.ownerCharacterId
                              ? characterName(book, item.ownerCharacterId)
                              : tr("无明确归属")}
                          </em>
                          {item.state === "stale" && <em className="is-warning">{tr("待复核")}</em>}
                        </span>
                        <span className="ka-list-note">
                          {projection.nodes.find((node) => node.id === item.nodeId)?.name || tr("未定位")}
                        </span>
                        <span className="ka-list-actions">
                          <button type="button" disabled={locked} onClick={() => openItemEdit(item)}>
                            {tr("编辑")}
                          </button>
                          {item.state === "stale" && (
                            <button type="button" disabled={locked} onClick={() => confirmRow("item", item.id)}>
                              {tr("确认有效")}
                            </button>
                          )}
                          <button type="button" disabled={locked} onClick={() => deleteItem(item)}>
                            {tr("删除")}
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {showReference && (
                <>
                  <section className="ka-subsection" aria-label={tr("时间线参考")}>
                    <h4>{tr("时间线参考")}</h4>

                    {relatedPositionEntries.length > 0 && (
                      <ul className="ka-list">
                        {relatedPositionEntries.map((entry) => (
                          <li key={entry.position.id}>
                            <span className="ka-list-main">
                              {entry.person}
                              <em>{tr(ATLAS_POSITION_STATUS_LABELS[entry.position.status])}</em>
                            </span>
                            <span className="ka-list-note">{entry.node}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {relatedItemEntries.length > 0 && (
                      <ul className="ka-list">
                        {relatedItemEntries.map((entry) => (
                          <li key={entry.item.id}>
                            <span className="ka-list-main">{entry.item.name}</span>
                            <span className="ka-list-note">
                              {entry.node}
                              {entry.owner ? ` · ${entry.owner}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  {onlyChapter && excludedNodes.length > 0 && (
                    <section className="ka-subsection" aria-label={tr("不涉及资料")}>
                      <h4>{tr("不涉及资料")}</h4>
                      <div className="ka-chip-row">
                        {excludedNodes.slice(0, 20).map((node) => (
                          <button
                            key={node.id}
                            type="button"
                            className="ka-chip is-muted"
                            onClick={() => {
                              setOnlyChapter(false);
                              setSelection({ kind: "node", id: node.id });
                            }}
                          >
                            {node.name || tr("未命名节点")}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  {staleNodes.length > 0 && (
                    <section className="ka-subsection" aria-label={tr("待复核资料")}>
                      <h4>{tr("待复核资料")}</h4>
                      <ul className="ka-list">
                        {staleNodes.slice(0, 12).map((entry) => (
                          <li key={entry.id} className="is-stale">
                            <span className="ka-list-main">
                              {staleEntryLabel(entry)}
                              <em className="is-warning">{statusLabel(entry.state)}</em>
                            </span>
                            <span className="ka-list-note">{tr("来源变化 · 待复核")}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="ka-detail ka-detail-empty">
              <MapTrifold size={26} />
              <p>{tr("选择一张地图或节点，查看它的资料与位置。")}</p>
            </div>
          )}
        </aside>}
      </div>

      <footer className="ka-statusbar">
        <span>
          {tr("蓝图地图")} {projection.stats.maps} · {tr("地点节点")} {projection.stats.nodes} ·{" "}
          {tr("地点关系")} {projection.stats.edges}
        </span>
        <span className={staleCount ? "is-warning" : ""}>
          {staleCount ? <WarningCircle size={13} /> : <CheckCircle size={13} />}
          {tr("待复核")} {staleCount}
        </span>
      </footer>

      {/* ------------------------------------------------------------- 表单弹窗 */}
      {editor && (
        <Modal
          title={
            editor.kind === "map"
              ? editor.isNew
                ? tr("新建地图")
                : tr("编辑地图")
              : editor.kind === "node"
                ? editor.isNew
                  ? tr("新建节点")
                  : tr("编辑节点")
                : editor.kind === "edge"
                  ? editor.isNew
                    ? tr("新建连线")
                    : tr("编辑连线")
                  : editor.kind === "item"
                    ? editor.isNew
                      ? tr("添加物品")
                      : tr("编辑物品")
                    : editor.isNew
                      ? tr("添加人物位置")
                      : tr("编辑人物位置")
          }
          onClose={() => setEditor(null)}
        >
          <form
            className="ka-form"
            onSubmit={(event) => {
              event.preventDefault();
              saveEditor();
            }}
          >
            <div className="modal-body">
              {editor.kind === "map" && (
                <>
                  <Field label={tr("名称")}>
                    <input
                      value={editor.draft.name}
                      maxLength={ATLAS_LIMITS.name}
                      autoFocus
                      onChange={(event) => updateEditor("map", { name: event.target.value })}
                    />
                  </Field>
                  <div className="ka-field-row">
                    <Field label={tr("类型")}>
                      <select
                        value={editor.draft.kind}
                        onChange={(event) =>
                          updateEditor("map", { kind: event.target.value as AtlasMap["kind"] })
                        }
                      >
                        {ATLAS_MAP_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {tr(ATLAS_MAP_KIND_LABELS[kind])}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={tr("状态")}>
                      <select
                        value={editor.draft.status}
                        onChange={(event) =>
                          updateEditor("map", { status: event.target.value as AtlasStatus })
                        }
                      >
                        {(Object.keys(ATLAS_STATUS_LABELS) as AtlasStatus[]).map((status) => (
                          <option key={status} value={status}>
                            {tr(ATLAS_STATUS_LABELS[status])}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="ka-field-row">
                    <Field label={tr("上级地图")}>
                      <select
                        value={editor.draft.parentMapId}
                        onChange={(event) => updateEditor("map", { parentMapId: event.target.value,entryNodeId:"" })}
                      >
                        <option value="">—</option>
                        {lineage
                          .filter((entry) => {
                            if (entry.map.id === editor.draft.id) return false;
                            const blocked = new Set([
                              editor.draft.id,
                              ...descendantMapIds(rawMaps, editor.draft.id),
                            ]);
                            return !blocked.has(entry.map.id);
                          })
                          .map((entry) => (
                            <option key={entry.map.id} value={entry.map.id}>
                              {`${"　".repeat(entry.depth)}${entry.map.name || tr("未命名地图")}`}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label={tr("地图主题")}>
                      <select
                        value={themeOf(editor.draft.theme)}
                        onChange={(event) => updateEditor("map", { theme: event.target.value })}
                      >
                        {ATLAS_THEMES.map((theme) => (
                          <option key={theme} value={theme}>
                            {tr(ATLAS_THEME_LABELS[theme])}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  {editor.draft.parentMapId&&<Field label={tr('上级地图中的入口地点')}><select value={editor.draft.entryNodeId||''} onChange={event=>updateEditor('map',{entryNodeId:event.target.value})}><option value="">{tr('未关联入口，可从下级地图列表进入')}</option>{rawNodes.filter(node=>node.mapId===editor.draft.parentMapId).map(node=><option key={node.id} value={node.id}>{node.name}</option>)}</select></Field>}
                  <Field label={tr("来源章节")}>
                    <select
                      value={editor.draft.chapterId}
                      onChange={(event) => updateEditor("map", { chapterId: event.target.value })}
                    >
                      <option value="">{tr("作者初始资料")}</option>
                      {bookChapters.map((chapter) => (
                        <option key={chapter.id} value={chapter.id}>
                          {chapter.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={tr("描述")}>
                    <textarea
                      rows={3}
                      value={editor.draft.description}
                      maxLength={ATLAS_LIMITS.description}
                      onChange={(event) => updateEditor("map", { description: event.target.value })}
                    />
                  </Field>
                </>
              )}
              {editor.kind === "node" && (
                <>
                  <Field label={tr("名称")}>
                    <input
                      value={editor.draft.name}
                      maxLength={ATLAS_LIMITS.name}
                      autoFocus
                      onChange={(event) => updateEditor("node", { name: event.target.value })}
                    />
                  </Field>
                  <div className="ka-field-row">
                    <Field label={tr("类型")}>
                      <select
                        value={editor.draft.kind}
                        onChange={(event) =>
                          updateEditor("node", { kind: event.target.value as AtlasNodeKind })
                        }
                      >
                        {ATLAS_NODE_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {tr(ATLAS_NODE_KIND_LABELS[kind])}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={tr("状态")}>
                      <select
                        value={editor.draft.status}
                        onChange={(event) =>
                          updateEditor("node", { status: event.target.value as AtlasStatus })
                        }
                      >
                        {(Object.keys(ATLAS_STATUS_LABELS) as AtlasStatus[]).map((status) => (
                          <option key={status} value={status}>
                            {tr(ATLAS_STATUS_LABELS[status])}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="ka-field-row">
                    <Field label={tr("上级地点")}>
                      <select
                        value={editor.draft.parentId}
                        onChange={(event) => updateEditor("node", { parentId: event.target.value })}
                      >
                        <option value="">—</option>
                        {mapNodes
                          .filter(
                            (node) =>
                              node.id !== editor.draft.id &&
                              !descendantNodeIds(rawNodes, editor.draft.id).includes(node.id),
                          )
                          .map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.name || tr("未命名节点")}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label={tr("来源章节")}>
                      <select
                        value={editor.draft.chapterId}
                        onChange={(event) => updateEditor("node", { chapterId: event.target.value })}
                      >
                        <option value="">{tr("作者初始资料")}</option>
                        {bookChapters.map((chapter) => (
                          <option key={chapter.id} value={chapter.id}>
                            {chapter.title}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label={tr("描述")}>
                    <textarea
                      rows={3}
                      value={editor.draft.description}
                      maxLength={ATLAS_LIMITS.description}
                      onChange={(event) => updateEditor("node", { description: event.target.value })}
                    />
                  </Field>
                </>
              )}
              {editor.kind === "edge" && (
                <>
                  <div className="ka-field-row">
                    <Field label={tr("连线起点")}>
                      <select
                        value={editor.draft.source}
                        onChange={(event) => updateEditor("edge", { source: event.target.value })}
                      >
                        {mapNodes.map((node) => (
                          <option key={node.id} value={node.id}>
                            {node.name || tr("未命名节点")}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={tr("连线终点")}>
                      <select
                        value={editor.draft.target}
                        onChange={(event) => updateEditor("edge", { target: event.target.value })}
                      >
                        {mapNodes.map((node) => (
                          <option key={node.id} value={node.id}>
                            {node.name || tr("未命名节点")}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="ka-field-row">
                    <Field label={tr("类型")}>
                      <select
                        value={editor.draft.kind}
                        onChange={(event) =>
                          updateEditor("edge", { kind: event.target.value as AtlasEdge["kind"] })
                        }
                      >
                        {ATLAS_EDGE_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {tr(ATLAS_EDGE_KIND_LABELS[kind])}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={tr("状态")}>
                      <select
                        value={editor.draft.status}
                        onChange={(event) =>
                          updateEditor("edge", { status: event.target.value as AtlasStatus })
                        }
                      >
                        {(Object.keys(ATLAS_STATUS_LABELS) as AtlasStatus[]).map((status) => (
                          <option key={status} value={status}>
                            {tr(ATLAS_STATUS_LABELS[status])}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label={tr("连线名称")}>
                    <input
                      value={editor.draft.label}
                      maxLength={ATLAS_LIMITS.label}
                      onChange={(event) => updateEditor("edge", { label: event.target.value })}
                    />
                  </Field>
                  <Field label={tr("来源章节")}>
                    <select
                      value={editor.draft.chapterId}
                      onChange={(event) => updateEditor("edge", { chapterId: event.target.value })}
                    >
                      <option value="">{tr("作者初始资料")}</option>
                      {bookChapters.map((chapter) => (
                        <option key={chapter.id} value={chapter.id}>
                          {chapter.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
              {editor.kind === "item" && (
                <>
                  <Field label={tr("名称")}>
                    <input
                      value={editor.draft.name}
                      maxLength={ATLAS_LIMITS.name}
                      autoFocus
                      onChange={(event) => updateEditor("item", { name: event.target.value })}
                    />
                  </Field>
                  <div className="ka-field-row">
                    <Field label={tr("所在地点")}>
                      <select
                        value={editor.draft.nodeId}
                        onChange={(event) => updateEditor("item", { nodeId: event.target.value })}
                      >
                        <option value="">{tr("未定位")}</option>
                        {mapNodes.map((node) => (
                          <option key={node.id} value={node.id}>
                            {node.name || tr("未命名节点")}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={tr("保管人")}>
                      <select
                        value={editor.draft.ownerCharacterId}
                        onChange={(event) =>
                          updateEditor("item", { ownerCharacterId: event.target.value })
                        }
                      >
                        <option value="">{tr("无明确归属")}</option>
                        {book.characters.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="ka-field-row">
                    <Field label={tr("状态")}>
                      <select
                        value={editor.draft.status}
                        onChange={(event) =>
                          updateEditor("item", { status: event.target.value as AtlasStatus })
                        }
                      >
                        {(Object.keys(ATLAS_STATUS_LABELS) as AtlasStatus[]).map((status) => (
                          <option key={status} value={status}>
                            {tr(ATLAS_STATUS_LABELS[status])}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={tr("来源章节")}>
                      <select
                        value={editor.draft.chapterId}
                        onChange={(event) => updateEditor("item", { chapterId: event.target.value })}
                      >
                        <option value="">{tr("作者初始资料")}</option>
                        {bookChapters.map((chapter) => (
                          <option key={chapter.id} value={chapter.id}>
                            {chapter.title}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label={tr("描述")}>
                    <textarea
                      rows={2}
                      value={editor.draft.description}
                      maxLength={ATLAS_LIMITS.description}
                      onChange={(event) => updateEditor("item", { description: event.target.value })}
                    />
                  </Field>
                </>
              )}
              {editor.kind === "position" && (
                <>
                  <div className="ka-field-row">
                    <Field label={tr("人物")}>
                      <select
                        value={editor.draft.characterId}
                        onChange={(event) => updateEditor("position", { characterId: event.target.value })}
                      >
                        <option value="">{tr("选择人物")}</option>
                        {book.characters.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={tr("所在地点")}>
                      <select
                        value={editor.draft.nodeId}
                        onChange={(event) => updateEditor("position", { nodeId: event.target.value })}
                      >
                        <option value="">{tr("未定位")}</option>
                        {mapNodes.map((node) => (
                          <option key={node.id} value={node.id}>
                            {node.name || tr("未命名节点")}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="ka-field-row">
                    <Field label={tr("位置状态")}>
                      <select
                        value={editor.draft.status}
                        onChange={(event) =>
                          updateEditor("position", {
                            status: event.target.value as AtlasPosition["status"],
                          })
                        }
                      >
                        {(Object.keys(ATLAS_POSITION_STATUS_LABELS) as AtlasPosition["status"][]).map(
                          (status) => (
                            <option key={status} value={status}>
                              {tr(ATLAS_POSITION_STATUS_LABELS[status])}
                            </option>
                          ),
                        )}
                      </select>
                    </Field>
                    <Field label={tr("来源章节")}>
                      <select
                        value={editor.draft.chapterId}
                        onChange={(event) =>
                          updateEditor("position", { chapterId: event.target.value })
                        }
                      >
                        <option value="">{tr("作者初始资料")}</option>
                        {bookChapters.map((chapter) => (
                          <option key={chapter.id} value={chapter.id}>
                            {chapter.title}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label={tr("备注")}>
                    <textarea
                      rows={2}
                      value={editor.draft.note}
                      maxLength={ATLAS_LIMITS.note}
                      onChange={(event) => updateEditor("position", { note: event.target.value })}
                    />
                  </Field>
                </>
              )}
            </div>
            <div className="modal-actions">
              <Button type="button" onClick={() => setEditor(null)}>
                {tr("取消")}
              </Button>
              <Button type="submit" variant="primary" disabled={locked}>
                {tr("保存")}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <div className="modal-body">
            <p className="ka-confirm-message">{confirm.message}</p>
          </div>
          <div className="modal-actions">
            <Button type="button" onClick={() => setConfirm(null)}>
              {tr("取消")}
            </Button>
            <Button type="button" variant="primary" disabled={locked} onClick={confirm.action}>
              {tr("确认删除")}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
