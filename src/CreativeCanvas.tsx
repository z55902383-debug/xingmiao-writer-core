import { tr, useLanguage } from "./i18n";
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
  ArrowCounterClockwise,
  ArrowSquareOut,
  ArrowsOut,
  CheckCircle,
  Link,
  Lock,
  LockOpen,
  MagnifyingGlass,
  Minus,
  PencilSimple,
  Plus,
  SquaresFour,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { api } from "./api";
import { Button, Field, IconButton, Modal } from "./ui";
import type { Book, TimelineSnapshot } from "./types";
import {
  arrangeCanvasLayout,
  buildCanvasGraph,
  CANVAS_NODE_HEIGHT,
  CANVAS_NODE_WIDTH,
  canvasViewKey,
  emptyCanvasLayout,
  mergeCanvasLayout,
  pruneCanvasLayout,
  type CanvasAnnotation,
  type CanvasEdge,
  type CanvasLayout,
  type CanvasModule,
  type CanvasNode,
} from "./canvasModel";
import "./creative-canvas.css";

export type { CanvasLayout, CanvasModule, CanvasNode } from "./canvasModel";

// Localize derived interface metadata, preserving source titles, roles and all story text.
function localizeCanvasGraph(graph: ReturnType<typeof buildCanvasGraph>, book: Book) {
  const chapterTitles = new Set(book.chapters.map(chapter => chapter.title));
  return {
    ...graph,
    nodes: graph.nodes.map(node => {
      const systemTitle = ["book:premise", "book:outline", "world:base"].includes(node.id);
      const numberedChapter = node.kind === "chapter" ? node.subtitle.match(/^第 (\d+) 章$/) : null;
      const fixedSubtitle = ["volume", "book-outline", "world-base", "memory", "foreshadow"].includes(node.kind);
      const sourceChapterTitle = chapterTitles.has(node.sourceLabel);
      return {
        ...node,
        title: systemTitle ? tr(node.title) : node.title,
        status: tr(node.status),
        subtitle: numberedChapter ? tr("第 {0} 章", {0: numberedChapter[1]}) : fixedSubtitle ? tr(node.subtitle) : node.subtitle,
        sourceLabel: sourceChapterTitle ? node.sourceLabel : tr(node.sourceLabel),
      };
    }),
    edges: graph.edges.map(edge => ({ ...edge, label: edge.id.startsWith("structure:") ? tr(edge.label) : edge.label })),
  };
}
export type CreativeCanvasProps = {
  book: Book;
  module: CanvasModule;
  tab: string;
  chapterId: string;
  snapshot?: TimelineSnapshot | null;
  onTimepointChange?: (chapterId: string) => void;
  onEdit: (node: CanvasNode) => void;
  onAdd: () => void;
  onOpenChapter: (id: string) => void;
  onEditEvent: (id: string) => void;
  notify: (message: string) => void;
  flush?: () => Promise<void>;
};
type Drag = {
  pointerId: number;
  mode: "node" | "pan";
  nodeId?: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
  initial: CanvasLayout;
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const clampZoom = (value: number) => Math.max(0.05, Math.min(1.8, value));
const moduleNames: Record<CanvasModule, string> = {
  outline: "故事大纲",
  characters: "人物档案",
  world: "世界设定",
  memory: "关系与记忆",
};
const kindNames: Record<CanvasNode["kind"], string> = {
  "book-outline": "全书总纲",
  premise: "故事简介",
  "world-base": "完整世界设定",
  volume: "卷大纲",
  "volume-detail": "卷细纲",
  chapter: "章节",
  "chapter-outline": "章节细纲",
  "chapter-summary": "章节概要",
  character: "人物",
  world: "世界资料",
  memory: "事实记忆",
  event: "变化记录",
  foreshadow: "伏笔",
};

function edgeCurve(edge: CanvasEdge, layout: CanvasLayout, lane = 0) {
  const a = layout.nodes[edge.source],
    b = layout.nodes[edge.target];
  if (!a || !b) return null;
  const sx = a.x + CANVAS_NODE_WIDTH,
    sy = a.y + CANVAS_NODE_HEIGHT / 2,
    tx = b.x,
    ty = b.y + CANVAS_NODE_HEIGHT / 2;
  const bend = Math.max(64, Math.abs(tx - sx) * 0.5);
  // A backward link takes a visible arc above its ports instead of running through the cards.
  if (tx < sx && Math.abs(ty - sy) < 70) {
    const lift = Math.min(210, 80 + Math.abs(tx - sx) * 0.14) - lane * 0.75;
    return {
      d: `M${sx} ${sy} C${sx + 80} ${sy} ${sx + 80} ${sy - lift} ${(sx + tx) / 2} ${sy - lift} C${tx - 80} ${sy - lift} ${tx - 80} ${ty} ${tx} ${ty}`,
      x: (sx + tx) / 2,
      y: sy - lift,
    };
  }
  return {
    d: `M${sx} ${sy} C${sx + bend} ${sy + lane} ${tx - bend} ${ty + lane} ${tx} ${ty}`,
    x: (sx + tx) / 2,
    y: (sy + ty) / 2 + lane * 0.75,
  };
}

export default function CreativeCanvas({
  book,
  module,
  tab,
  chapterId,
  snapshot,
  onTimepointChange,
  onEdit,
  onAdd,
  onOpenChapter,
  onEditEvent,
  notify,
  flush,
}: CreativeCanvasProps) {
  const view = canvasViewKey(module, tab),
    key = `${book.id}/${view}`;
  const sourceBook = useRef(book);
  sourceBook.current = book;
  const stage = useRef<HTMLDivElement>(null),
    graphRef = useRef<ReturnType<typeof buildCanvasGraph> | null>(null);
  const [at, setAt] = useState(chapterId),
    [showPlans, setShowPlans] = useState(module === "outline"),
    [remoteSnapshot, setRemoteSnapshot] = useState<TimelineSnapshot | null>(
      null,
    );
  const [layout, setLayout] = useState<CanvasLayout>(emptyCanvasLayout),
    layoutRef = useRef(layout);
  const [ready, setReady] = useState(false),
    readyRef = useRef(false),
    [saveState, setSaveState] = useState("正在载入布局");
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false),
    [linkStart, setLinkStart] = useState<string | null>(null),
    [annotationDraft, setAnnotationDraft] = useState<CanvasAnnotation | null>(
      null,
    );
  const [historySize, setHistorySize] = useState(0),
    history = useRef<CanvasLayout[]>([]),
    drag = useRef<Drag | null>(null),
    suppressClick = useRef(false),
    freshFit = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    pendingSave = useRef<{
      bookId: string;
      view: string;
      layout: CanvasLayout;
    } | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve()),
    scope = useRef({ bookId: book.id, view, key }),
    alive = useRef(true),
    lastWheel = useRef(0);
  const arrowId = `cc-arrow-${useId().replace(/:/g, "")}`;
  const language = useLanguage();
  const graph = useMemo(
    () =>
      localizeCanvasGraph(buildCanvasGraph(book, {
        module,
        tab,
        chapterId: at,
        showPlans,
        snapshot:
          snapshot !== undefined && at === chapterId
            ? snapshot
            : remoteSnapshot,
      }), book),
    [book, module, tab, at, showPlans, snapshot, chapterId, remoteSnapshot, language],
  );
  graphRef.current = graph;
  const nodes = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term
      ? graph.nodes.filter((node) =>
          `${node.title} ${node.body} ${node.subtitle} ${node.sourceLabel}`
            .toLocaleLowerCase()
            .includes(term),
        )
      : graph.nodes;
  }, [graph, query]);
  const visibleIds = useMemo(
    () => new Set(nodes.map((node) => node.id)),
    [nodes],
  );
  const edges = useMemo<CanvasEdge[]>(
    () =>
      [
        ...graph.edges,
        ...layout.annotations.map((annotation) => ({
          ...annotation,
          kind: "annotation" as const,
        })),
      ].filter(
        (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
      ),
    [graph, layout.annotations, visibleIds],
  );
  const edgeCurves = useMemo(() => {
    const counts = new Map<string, number>();
    return new Map(
      edges.map((edge) => {
        const pair = `${edge.source}/${edge.target}`,
          index = counts.get(pair) || 0;
        counts.set(pair, index + 1);
        const lane =
          index === 0 ? 0 : Math.ceil(index / 2) * 60 * (index % 2 ? 1 : -1);
        return [edge.id, edgeCurve(edge, layout, lane)];
      }),
    );
  }, [edges, layout]);
  const selectedNode = graph.nodes.find((node) => node.id === selected),
    selectedLink = edges.find((edge) => edge.id === selectedEdge);
  const callbacks = useRef({
    notify,
    onEdit,
    onEditEvent,
    onOpenChapter,
    flush,
  });
  callbacks.current = { notify, onEdit, onEditEvent, onOpenChapter, flush };

  const enqueueSave = useCallback(
    (payload: { bookId: string; view: string; layout: CanvasLayout }) => {
      const savedKey = `${payload.bookId}/${payload.view}`;
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(async () => {
          try {
            await callbacks.current.flush?.();
            await api<CanvasLayout>("canvas:save", {
              ...payload,
              layout:
                payload.bookId === sourceBook.current.id
                  ? pruneCanvasLayout(payload.layout, sourceBook.current)
                  : payload.layout,
            });
            if (alive.current && scope.current.key === savedKey)
              setSaveState("布局已保存");
          } catch (error) {
            if (alive.current && scope.current.key === savedKey) {
              setSaveState("保存失败");
              callbacks.current.notify(
                `画布布局保存失败：${(error as Error).message}`,
              );
            }
          }
        });
    },
    [],
  );
  const scheduleSave = useCallback(
    (next: CanvasLayout, immediate = false) => {
      if (!readyRef.current) return;
      const payload = {
        bookId: scope.current.bookId,
        view: scope.current.view,
        layout: clone(next),
      };
      pendingSave.current = payload;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveState("布局待保存");
      if (immediate) {
        pendingSave.current = null;
        enqueueSave(payload);
      } else
        saveTimer.current = setTimeout(() => {
          saveTimer.current = null;
          const pending = pendingSave.current;
          pendingSave.current = null;
          if (pending) enqueueSave(pending);
        }, 280);
    },
    [enqueueSave],
  );
  const remember = useCallback((previous = layoutRef.current) => {
    history.current.push(clone(previous));
    if (history.current.length > 40) history.current.shift();
    setHistorySize(history.current.length);
  }, []);
  const changeLayout = useCallback(
    (next: CanvasLayout, addHistory = false, persist = true) => {
      if (!readyRef.current) return;
      if (addHistory) remember();
      next = pruneCanvasLayout(next, sourceBook.current);
      layoutRef.current = next;
      setLayout(next);
      if (persist) scheduleSave(next);
      else
        pendingSave.current = {
          bookId: scope.current.bookId,
          view: scope.current.view,
          layout: clone(next),
        };
    },
    [remember, scheduleSave],
  );

  useEffect(() => {
    setAt(chapterId);
  }, [book.id, chapterId]);
  useEffect(() => {
    if (snapshot !== undefined && at === chapterId) {
      setRemoteSnapshot(snapshot);
      return;
    }
    let live = true;
    setRemoteSnapshot(null);
    api<TimelineSnapshot>("timeline:preview", {
      bookId: book.id,
      chapterId: at,
      includeCurrent: true,
    })
      .then((value) => {
        if (live) setRemoteSnapshot(value);
      })
      .catch(() => {
        /* Book already contains enough data for the identical local projection. */
      });
    return () => {
      live = false;
    };
  }, [book, at, chapterId, snapshot]);
  useEffect(() => {
    let live = true;
    readyRef.current = false;
    setReady(false);
    scope.current = { bookId: book.id, view, key };
    setSaveState("正在载入布局");
    setQuery("");
    setSelected(null);
    setSelectedEdge(null);
    setConnecting(false);
    setLinkStart(null);
    setAnnotationDraft(null);
    history.current = [];
    setHistorySize(0);
    freshFit.current = false;
    api<CanvasLayout | null>("canvas:get", { bookId: book.id, view })
      .then((saved) => {
        if (!live) return;
        const next = mergeCanvasLayout(
          saved || emptyCanvasLayout(),
          graphRef.current?.nodes || [],
        );
        layoutRef.current = next;
        setLayout(next);
        freshFit.current = !saved;
        readyRef.current = true;
        setReady(true);
        setSaveState("画布已就绪");
        if (saved && next !== saved) scheduleSave(next);
      })
      .catch((error) => {
        if (!live) return;
        const next = mergeCanvasLayout(
          emptyCanvasLayout(),
          graphRef.current?.nodes || [],
        );
        layoutRef.current = next;
        setLayout(next);
        readyRef.current = true;
        setReady(true);
        freshFit.current = true;
        setSaveState("布局未能载入");
        callbacks.current.notify(
          `画布布局载入失败：${(error as Error).message}`,
        );
      });
    return () => {
      live = false;
      readyRef.current = false;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const pending = pendingSave.current;
      pendingSave.current = null;
      if (pending) enqueueSave(pending);
    };
  }, [key, book.id, view, enqueueSave, scheduleSave]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const nodeSignature = graph.nodes.map((node) => node.id).join("|");
  useEffect(() => {
    if (!readyRef.current) return;
    const next = mergeCanvasLayout(
      pruneCanvasLayout(layoutRef.current, book),
      graph.nodes,
    );
    if (next !== layoutRef.current) {
      changeLayout(next);
      setSaveState("资料已更新，原有位置保留");
    }
  }, [book, nodeSignature, ready, changeLayout]);

  const fit = useCallback(() => {
    const host = stage.current;
    if (!host || !readyRef.current || !nodes.length) return;
    const positions = nodes
      .map((node) => layoutRef.current.nodes[node.id])
      .filter(Boolean);
    if (!positions.length) return;
    const minX = Math.min(...positions.map((position) => position.x)) - 28,
      minY = Math.min(...positions.map((position) => position.y)) - 28;
    const maxX =
        Math.max(
          ...positions.map((position) => position.x + CANVAS_NODE_WIDTH),
        ) + 28,
      maxY =
        Math.max(
          ...positions.map((position) => position.y + CANVAS_NODE_HEIGHT),
        ) + 28;
    const bounds = host.getBoundingClientRect(),
      zoom = Math.max(
        0.05,
        Math.min(
          1.05,
          (bounds.width - 40) / (maxX - minX),
          (bounds.height - 84) / (maxY - minY),
        ),
      );
    const viewport = {
      zoom,
      x: Math.max(18 - minX * zoom, (bounds.width - (maxX + minX) * zoom) / 2),
      y: Math.max(
        18 - minY * zoom,
        (bounds.height - (maxY + minY) * zoom) / 2 - 12,
      ),
    };
    changeLayout({ ...layoutRef.current, viewport });
  }, [nodes, changeLayout]);
  useEffect(() => {
    if (!ready || !freshFit.current) return;
    freshFit.current = false;
    const frame = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(frame);
  }, [ready, key, fit]);
  useEffect(() => {
    if (!query.trim() || !ready) return;
    const frame = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(frame);
  }, [query]);
  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const bounds = stage.current?.getBoundingClientRect();
      if (!bounds || !readyRef.current) return;
      const current = layoutRef.current.viewport,
        x = (clientX ?? bounds.left + bounds.width / 2) - bounds.left,
        y = (clientY ?? bounds.top + bounds.height / 2) - bounds.top;
      const zoom = clampZoom(current.zoom * factor),
        ratio = zoom / current.zoom;
      changeLayout({
        ...layoutRef.current,
        viewport: {
          zoom,
          x: x - (x - current.x) * ratio,
          y: y - (y - current.y) * ratio,
        },
      });
    },
    [changeLayout],
  );
  useEffect(() => {
    const host = stage.current;
    if (!host) return;
    const wheel = (event: WheelEvent) => {
      if (
        !readyRef.current ||
        (event.target as Element).closest("button,input,select,textarea")
      )
        return;
      event.preventDefault();
      if (Date.now() - lastWheel.current > 500) remember();
      lastWheel.current = Date.now();
      zoomAt(Math.exp(-event.deltaY * 0.001), event.clientX, event.clientY);
    };
    host.addEventListener("wheel", wheel, { passive: false });
    return () => host.removeEventListener("wheel", wheel);
  }, [zoomAt, remember]);
  const undo = () => {
    const previous = history.current.pop();
    if (!previous) return;
    setHistorySize(history.current.length);
    changeLayout(previous);
    setSaveState("已撤销画布操作");
  };
  const createLink = (id: string, port = "out") => {
    if (!linkStart) {
      setConnecting(true);
      setLinkStart(id);
      setSelected(id);
      setSelectedEdge(null);
      return;
    }
    if (linkStart === id) return;
    const reversed = port === "out";
    setAnnotationDraft({
      id: crypto.randomUUID(),
      source: reversed ? id : linkStart,
      target: reversed ? linkStart : id,
      label: "作者关联",
      note: "",
      direction: "none",
      dashed: false,
    });
    setConnecting(false);
    setLinkStart(null);
  };
  const selectNode = (node: CanvasNode) => {
    if (suppressClick.current) return;
    if (connecting) {
      createLink(node.id, "in");
      return;
    }
    setSelected(node.id);
    setSelectedEdge(null);
  };
  const selectEdge = (edge: CanvasEdge) => {
    setSelected(null);
    setSelectedEdge(edge.id);
    if (edge.kind === "annotation") setAnnotationDraft(clone(edge));
  };
  const saveAnnotation = () => {
    const draft = annotationDraft;
    if (!draft || draft.source === draft.target) return;
    const annotation: CanvasAnnotation = {
      id: draft.id,
      source: draft.source,
      target: draft.target,
      label: draft.label.trim() || "作者关联",
      note: draft.note?.trim() || "",
      direction: draft.direction,
      dashed: draft.dashed,
    };
    const current = layoutRef.current;
    changeLayout(
      {
        ...current,
        annotations: [
          ...current.annotations.filter((item) => item.id !== annotation.id),
          annotation,
        ],
      },
      true,
    );
    setAnnotationDraft(null);
    setSelectedEdge(annotation.id);
    setSaveState("作者标注已保存，正式资料未改变");
  };
  const deleteAnnotation = (id: string) => {
    changeLayout(
      {
        ...layoutRef.current,
        annotations: layoutRef.current.annotations.filter(
          (item) => item.id !== id,
        ),
      },
      true,
    );
    setAnnotationDraft(null);
    setSelectedEdge(null);
  };
  const lockNode = () => {
    if (!selected || !layoutRef.current.nodes[selected]) return;
    const current = layoutRef.current,
      position = current.nodes[selected];
    changeLayout(
      {
        ...current,
        nodes: {
          ...current.nodes,
          [selected]: { ...position, locked: !position.locked },
        },
      },
      true,
    );
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      !readyRef.current ||
      event.button !== 0 ||
      (event.target as Element).closest(
        "button,input,select,textarea,[data-edge-id],[data-edge-path-id]",
      )
    )
      return;
    const card = (event.target as Element).closest<HTMLElement>(
        "[data-node-id]",
      ),
      id = card?.dataset.nodeId;
    if (id && (connecting || layoutRef.current.nodes[id]?.locked)) return;
    const current = layoutRef.current,
      position = id ? current.nodes[id] : undefined;
    drag.current = {
      pointerId: event.pointerId,
      mode: id ? "node" : "pan",
      nodeId: id,
      startX: event.clientX,
      startY: event.clientY,
      originX: position?.x ?? current.viewport.x,
      originY: position?.y ?? current.viewport.y,
      moved: false,
      initial: clone(current),
    };
    // Selecting a node opens its details over the stage; keep this gesture on the stage.
    event.currentTarget.setPointerCapture(event.pointerId);
    if (id) {
      setSelected(id);
      setSelectedEdge(null);
    } else if (!connecting) {
      setSelected(null);
      setSelectedEdge(null);
    }
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const currentDrag = drag.current;
    if (!currentDrag) return;
    const dx = event.clientX - currentDrag.startX,
      dy = event.clientY - currentDrag.startY;
    if (!currentDrag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    if (!currentDrag.moved) {
      remember(currentDrag.initial);
      currentDrag.moved = true;
      suppressClick.current = true;
      stage.current?.setPointerCapture(event.pointerId);
    }
    const current = layoutRef.current;
    if (currentDrag.mode === "node" && currentDrag.nodeId) {
      const id = currentDrag.nodeId,
        previous = current.nodes[id];
      changeLayout(
        {
          ...current,
          nodes: {
            ...current.nodes,
            [id]: {
              ...previous,
              x: currentDrag.originX + dx / current.viewport.zoom,
              y: currentDrag.originY + dy / current.viewport.zoom,
            },
          },
        },
        false,
        false,
      );
    } else
      changeLayout(
        {
          ...current,
          viewport: {
            ...current.viewport,
            x: currentDrag.originX + dx,
            y: currentDrag.originY + dy,
          },
        },
        false,
        false,
      );
  };
  const pointerUp = () => {
    const currentDrag = drag.current;
    if (!currentDrag) return;
    if (stage.current?.hasPointerCapture(currentDrag.pointerId))
      stage.current.releasePointerCapture(currentDrag.pointerId);
    drag.current = null;
    if (currentDrag.moved) {
      scheduleSave(layoutRef.current);
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("input,textarea,select,button"))
      return;
    if (event.key === "Escape") {
      setConnecting(false);
      setLinkStart(null);
      setSelected(null);
      setSelectedEdge(null);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomAt(1.15);
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      zoomAt(1 / 1.15);
      return;
    }
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      fit();
      return;
    }
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      event.preventDefault();
      const current = layoutRef.current;
      changeLayout({
        ...current,
        viewport: {
          ...current.viewport,
          x:
            current.viewport.x +
            (event.key === "ArrowLeft"
              ? 40
              : event.key === "ArrowRight"
                ? -40
                : 0),
          y:
            current.viewport.y +
            (event.key === "ArrowUp"
              ? 40
              : event.key === "ArrowDown"
                ? -40
                : 0),
        },
      });
    }
  };
  const editSource = (node: CanvasNode) =>
    node.kind === "event" && node.entityId
      ? onEditEvent(node.entityId)
      : onEdit(node);
  const viewport = layout.viewport;
  return (
    <section
      className="creative-canvas"
      data-view-key={view}
      data-layout-ready={ready ? "true" : "false"}
      aria-label={tr("{0}画布", {0: tr(moduleNames[module])})}
    >
      <div className="cc-toolbar">
        <div className="cc-actions">
          <Button
            variant="primary-soft"
            onClick={onAdd}
            disabled={!ready}
            aria-label={tr("添加资料")}
          >
            <Plus size={16} />{tr("添加资料")}</Button>
          <Button
            className={connecting ? "active" : ""}
            disabled={!ready}
            aria-label={tr("连线")}
            aria-pressed={connecting}
            onClick={() => {
              setConnecting(!connecting);
              setLinkStart(null);
            }}
          >
            <Link size={16} />{tr("连线")}</Button>
          <Button
            disabled={!ready || !nodes.length}
            aria-label={tr("自动整理")}
            onClick={() => {
              changeLayout(
                arrangeCanvasLayout(layoutRef.current, graph.nodes),
                true,
              );
              setSaveState("已整理，锁定位置保留");
            }}
          >
            <SquaresFour size={16} />{tr("自动整理")}</Button>
          <IconButton
            label={tr("撤销画布操作")}
            disabled={!ready || !historySize}
            onClick={undo}
          >
            <ArrowCounterClockwise size={18} />
          </IconButton>
        </div>
        <label className="cc-search">
          <MagnifyingGlass size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tr("搜索画布资料")}
            aria-label={tr("搜索画布资料")}
          />
        </label>
      </div>
      <div className="cc-timebar">
        <label>
          <span>{tr("查看时点")}</span>
          <select
            aria-label={tr("查看画布时间点")}
            value={at}
            onChange={(event) => {
              setAt(event.target.value);
              onTimepointChange?.(event.target.value);
            }}
          >
            <option value="">{tr("故事开始前")}</option>
            {[...book.chapters]
              .sort((a, b) => a.order - b.order)
              .map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.title}{" "}{tr("· 章末")}</option>
              ))}
          </select>
        </label>
        <label className="cc-plan-toggle">
          <input
            type="checkbox"
            checked={showPlans}
            aria-label={tr("显示计划")}
            onChange={(event) => setShowPlans(event.target.checked)}
          />{tr("显示未来计划")}</label>
        <span>{tr("章末状态用于回看，写作仍使用原有章首资料。")}</span>
      </div>
      <div
        ref={stage}
        className={`cc-stage${connecting ? " is-connecting" : ""}`}
        data-testid="creative-canvas-stage"
        data-view-key={view}
        tabIndex={0}
        aria-label={tr("无限画布，拖动空白平移，滚轮缩放，点选节点查看资料")}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onKeyDown={keyDown}
      >
        <div
          className="cc-world"
          style={{
            transform: `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})`,
          }}
        >
          <svg
            className="cc-edges"
            width="10000"
            height="20000"
            aria-label={tr("资料之间的关联")}
          >
            <defs>
              <marker
                id={arrowId}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0 0 10 5 0 10Z" fill="currentColor" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const curve = edgeCurves.get(edge.id);
              if (!curve) return null;
              const width = Math.max(52, edge.label.length * 12 + 20);
              return (
                <g
                  key={edge.id}
                  data-edge-path-id={edge.id}
                  className={`cc-edge ${edge.kind === "annotation" ? "is-annotation" : "is-formal"} ${selectedEdge === edge.id ? "is-selected" : ""} ${edge.state === "stale" || edge.state === "superseded" ? "is-historical" : ""}`}
                  aria-label={`${edge.label}, ${tr(edge.kind === "annotation" ? "编辑作者标注" : "查看正式关联")}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectEdge(edge);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      selectEdge(edge);
                    }
                  }}
                >
                  <path className="cc-edge-hit" d={curve.d} />
                  <path
                    className="cc-edge-line"
                    d={curve.d}
                    strokeDasharray={edge.dashed ? "7 5" : undefined}
                    markerEnd={
                      edge.direction === "forward" || edge.direction === "both"
                        ? `url(#${arrowId})`
                        : undefined
                    }
                    markerStart={
                      edge.direction === "both" ? `url(#${arrowId})` : undefined
                    }
                  />
                </g>
              );
            })}
            {edges.map((edge) => {
              const curve = edgeCurves.get(edge.id);
              if (!curve) return null;
              const width = Math.max(52, edge.label.length * 12 + 20);
              return (
                <g
                  key={edge.id}
                  data-edge-id={edge.id}
                  className={`cc-edge ${edge.kind === "annotation" ? "is-annotation" : "is-formal"} ${selectedEdge === edge.id ? "is-selected" : ""} ${edge.state === "stale" || edge.state === "superseded" ? "is-historical" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${edge.label}, ${tr(edge.kind === "annotation" ? "编辑作者标注" : "查看正式关联")}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectEdge(edge);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      selectEdge(edge);
                    }
                  }}
                >
                  <g
                    className="cc-edge-label"
                    transform={`translate(${curve.x},${curve.y})`}
                  >
                    <rect
                      x={-width / 2}
                      y={-12}
                      width={width}
                      height={24}
                      rx={5}
                    />
                    <text textAnchor="middle" dominantBaseline="central">
                      {edge.label}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>
          {nodes.map((node) => {
            const position = layout.nodes[node.id];
            if (!position) return null;
            return (
              <article
                key={node.id}
                className={`cc-node creative-canvas-node cc-kind-${node.kind} cc-state-${node.state}${selected === node.id ? " is-selected" : ""}${position.locked ? " is-locked" : ""}${linkStart === node.id ? " is-link-source" : ""}`}
                data-node-id={node.id}
                data-node-ref={node.id}
                data-node-x={position.x}
                data-node-y={position.y}
                data-node-state={node.state}
                style={{
                  left: position.x,
                  top: position.y,
                  width: CANVAS_NODE_WIDTH,
                  height: CANVAS_NODE_HEIGHT,
                }}
                tabIndex={0}
                role="button"
                aria-label={tr("{0}，{1}，点选查看资料", {0: node.title, 1: tr(node.status)})}
                aria-pressed={selected === node.id}
                onClick={() => selectNode(node)}
                onFocus={(event) => {
                  if (!(event.target as HTMLElement).matches(":focus-visible"))
                    return;
                  const host = stage.current;
                  if (!host) return;
                  const viewport = layoutRef.current.viewport,
                    x = position.x * viewport.zoom + viewport.x,
                    y = position.y * viewport.zoom + viewport.y;
                  const width = CANVAS_NODE_WIDTH * viewport.zoom,
                    height = CANVAS_NODE_HEIGHT * viewport.zoom;
                  const dx =
                    x < 12 || width > host.clientWidth - 24
                      ? 12 - x
                      : x + width > host.clientWidth - 12
                        ? host.clientWidth - 12 - x - width
                        : 0;
                  const dy =
                    y < 12 || height > host.clientHeight - 24
                      ? 12 - y
                      : y + height > host.clientHeight - 12
                        ? host.clientHeight - 12 - y - height
                        : 0;
                  if (dx || dy)
                    changeLayout({
                      ...layoutRef.current,
                      viewport: {
                        ...viewport,
                        x: viewport.x + dx,
                        y: viewport.y + dy,
                      },
                    });
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    selectNode(node);
                  }
                }}
              >
                <div className="cc-node-head">
                  <span>{tr(kindNames[node.kind])}</span>
                  {position.locked && (
                    <Lock size={13} aria-label={tr("位置已锁定")} />
                  )}
                  <span className="cc-node-status">{tr(node.status)}</span>
                </div>
                <div className="cc-node-content">
                  <h3>{node.title}</h3>
                  {node.subtitle && (
                    <span className="cc-node-subtitle">{node.subtitle}</span>
                  )}
                  <p>{node.body || tr("尚未填写，点选后可编辑原始资料。")}</p>
                  <footer>{node.sourceLabel}</footer>
                </div>
                <button
                  className="cc-port cc-port-in"
                  data-port="in"
                  data-node-id-ref={node.id}
                  aria-label={tr("连接到{0}", {0: node.title})}
                  title={tr("关联输入")}
                  onClick={(event) => {
                    event.stopPropagation();
                    createLink(node.id, "in");
                  }}
                />
                <button
                  className="cc-port cc-port-out"
                  data-port="out"
                  data-node-id-ref={node.id}
                  aria-label={tr("从{0}连接", {0: node.title})}
                  title={tr("关联输出")}
                  onClick={(event) => {
                    event.stopPropagation();
                    createLink(node.id, "out");
                  }}
                />
              </article>
            );
          })}
        </div>
        {!ready && (
          <div className="cc-loading" role="status">{tr("正在读取画布布局…")}</div>
        )}
        {ready && !nodes.length && (
          <div className="cc-empty">
            <SquaresFour size={30} />
            <strong>{query ? tr("没有找到匹配资料") : tr("这个时点还没有资料")}</strong>
            <p>
              {query
                ? tr("试试其他关键词，或清空搜索。")
                : tr("可以添加资料，或调整查看时点。生成结果采用后会同步出现。")}
            </p>
            <Button onClick={query ? () => setQuery("") : onAdd}>
              {query ? tr("清空搜索") : tr("添加资料")}
            </Button>
          </div>
        )}
        <div className="cc-stage-hint">
          {connecting
            ? linkStart
              ? tr("再点另一个节点的端口，编辑作者标注")
              : tr("依次点选两张卡片或两个端口")
            : tr("拖动空白平移 · 滚轮缩放 · 点选节点查看")}
        </div>
        <div className="cc-zoom">
          <IconButton
            label={tr("缩小画布")}
            disabled={!ready}
            onClick={() => zoomAt(1 / 1.15)}
          >
            <Minus size={16} />
          </IconButton>
          <output aria-label={tr("画布缩放比例")}>
            {Math.round(viewport.zoom * 100)}%
          </output>
          <IconButton
            label={tr("放大画布")}
            disabled={!ready}
            onClick={() => zoomAt(1.15)}
          >
            <Plus size={16} />
          </IconButton>
          <IconButton
            label={tr("适应画布")}
            disabled={!ready || !nodes.length}
            onClick={fit}
          >
            <ArrowsOut size={17} />
          </IconButton>
        </div>
        <div className="cc-legend">
          <span>
            <i />{tr("正式关联")}</span>
          <span>
            <i className="is-dashed" />{tr("作者标注 / 计划")}</span>
        </div>
      </div>
      {(selectedNode || selectedLink?.kind === "formal") && (
        <aside
          className="cc-selection"
          data-testid="creative-canvas-selection"
          aria-label={tr("画布资料详情")}
        >
          <header>
            <strong>{selectedNode ? tr("资料详情") : tr("正式关联")}</strong>
            <IconButton
              label={tr("关闭节点详情")}
              onClick={() => {
                setSelected(null);
                setSelectedEdge(null);
              }}
            >
              <X size={17} />
            </IconButton>
          </header>
          {selectedNode ? (
            <>
              <span
                className={`cc-detail-state cc-state-${selectedNode.state}`}
              >
                {tr(selectedNode.status)}
              </span>
              <h3>{selectedNode.title}</h3>
              <p>{selectedNode.body || tr("尚未填写内容。")}</p>
              <small>{selectedNode.sourceLabel}</small>
              <div className="cc-detail-actions">
                <Button
                  variant="primary-soft"
                  disabled={!selectedNode.editable}
                  onClick={() => editSource(selectedNode)}
                >
                  <PencilSimple size={15} />{tr("编辑原始资料")}</Button>
                <Button
                  aria-label={
                    layout.nodes[selectedNode.id]?.locked
                      ? tr("解锁位置")
                      : tr("锁定位置")
                  }
                  onClick={lockNode}
                >
                  {layout.nodes[selectedNode.id]?.locked ? (
                    <LockOpen size={15} />
                  ) : (
                    <Lock size={15} />
                  )}
                  {layout.nodes[selectedNode.id]?.locked
                    ? tr("解锁位置")
                    : tr("锁定位置")}
                </Button>
                {selectedNode.chapterId && (
                  <Button
                    onClick={() => onOpenChapter(selectedNode.chapterId!)}
                  >
                    <ArrowSquareOut size={15} />{tr("打开来源章节")}</Button>
                )}
              </div>
              <p className="cc-source-note">{tr("内容保存在原有资料中。画布只保存位置和作者标注。")}</p>
            </>
          ) : (
            selectedLink && (
              <>
                <h3>{selectedLink.label}</h3>
                <p>
                  {
                    graph.nodes.find((node) => node.id === selectedLink.source)
                      ?.title
                  }{" "}
                  →{" "}
                  {
                    graph.nodes.find((node) => node.id === selectedLink.target)
                      ?.title
                  }
                </p>
                <p className="cc-source-note">{tr("此关联来自现有资料，修改来源后会同步更新。")}</p>
                <Button
                  variant="primary-soft"
                  onClick={() =>
                    selectedLink.eventId
                      ? onEditEvent(selectedLink.eventId)
                      : graph.nodes.find(
                          (node) => node.id === selectedLink.source,
                        ) &&
                        onEdit(
                          graph.nodes.find(
                            (node) => node.id === selectedLink.source,
                          )!,
                        )
                  }
                >
                  <PencilSimple size={15} />{tr("编辑原始资料")}</Button>
              </>
            )
          )}
        </aside>
      )}
      <footer className="cc-statusbar">
        <span>
          {nodes.length}{" "}{tr("项资料 ·")}{" "}{edges.length}{" "}{tr("条关联")}</span>
        <span role="status" aria-live="polite">
          {saveState === "保存失败" ? (
            <WarningCircle size={13} />
          ) : (
            <CheckCircle size={13} />
          )}
          {tr(saveState)}
        </span>
      </footer>
      {annotationDraft && (
        <Modal title={tr("编辑作者标注")} onClose={() => setAnnotationDraft(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveAnnotation();
            }}
          >
            <div className="modal-body cc-annotation-form">
              <p>{tr("作者标注用于梳理思路，独立保存在画布中，不改变正式关系或生成参考资料。")}</p>
              <Field label={tr("关联名称")}>
                <input
                  value={annotationDraft.label}
                  maxLength={160}
                  onChange={(event) =>
                    setAnnotationDraft({
                      ...annotationDraft,
                      label: event.target.value,
                    })
                  }
                />
              </Field>
              <div className="cc-field-row">
                <Field label={tr("起点")}>
                  <select
                    value={annotationDraft.source}
                    onChange={(event) =>
                      setAnnotationDraft({
                        ...annotationDraft,
                        source: event.target.value,
                      })
                    }
                  >
                    {graph.nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={tr("终点")}>
                  <select
                    value={annotationDraft.target}
                    onChange={(event) =>
                      setAnnotationDraft({
                        ...annotationDraft,
                        target: event.target.value,
                      })
                    }
                  >
                    {graph.nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.title}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label={tr("备注")}>
                <textarea
                  rows={3}
                  value={annotationDraft.note || ""}
                  onChange={(event) =>
                    setAnnotationDraft({
                      ...annotationDraft,
                      note: event.target.value,
                    })
                  }
                />
              </Field>
              <div className="cc-field-row">
                <Field label={tr("方向")}>
                  <select
                    value={annotationDraft.direction}
                    onChange={(event) =>
                      setAnnotationDraft({
                        ...annotationDraft,
                        direction: event.target
                          .value as CanvasAnnotation["direction"],
                      })
                    }
                  >
                    <option value="none">{tr("无方向")}</option>
                    <option value="forward">{tr("起点指向终点")}</option>
                    <option value="both">{tr("双向")}</option>
                  </select>
                </Field>
                <Field label={tr("线条样式")}>
                  <select
                    value={String(annotationDraft.dashed)}
                    onChange={(event) =>
                      setAnnotationDraft({
                        ...annotationDraft,
                        dashed: event.target.value === "true",
                      })
                    }
                  >
                    <option value="false">{tr("实线")}</option>
                    <option value="true">{tr("虚线")}</option>
                  </select>
                </Field>
              </div>
            </div>
            <div className="modal-actions">
              {layout.annotations.some(
                (item) => item.id === annotationDraft.id,
              ) && (
                <Button
                  type="button"
                  onClick={() => deleteAnnotation(annotationDraft.id)}
                >
                  <Trash size={15} />{tr("删除标注")}</Button>
              )}
              <Button type="button" onClick={() => setAnnotationDraft(null)}>{tr("取消")}</Button>
              <Button
                variant="primary"
                type="submit"
                disabled={annotationDraft.source === annotationDraft.target}
              >{tr("保存标注")}</Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
