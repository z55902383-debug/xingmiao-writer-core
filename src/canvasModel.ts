import type { Book, TimelineEvent, TimelineSnapshot } from "./types";

export type CanvasModule = "outline" | "characters" | "world" | "memory";
export type CanvasNodeKind =
  | "book-outline"
  | "premise"
  | "world-base"
  | "volume"
  | "volume-detail"
  | "chapter"
  | "chapter-outline"
  | "chapter-summary"
  | "character"
  | "world"
  | "memory"
  | "event"
  | "foreshadow";
export type CanvasNodeState =
  | "initial"
  | "active"
  | "planned"
  | "future"
  | "stale"
  | "superseded"
  | "provisional";
export type CanvasNode = {
  id: string;
  kind: CanvasNodeKind;
  entityId?: string;
  chapterId?: string;
  title: string;
  body: string;
  subtitle: string;
  sourceLabel: string;
  status: string;
  state: CanvasNodeState;
  scope: "initial" | "confirmed" | "planning" | "historical" | "provisional";
  editable: boolean;
};
export type CanvasAnnotation = {
  id: string;
  source: string;
  target: string;
  label: string;
  note?: string;
  direction: "none" | "forward" | "both";
  dashed: boolean;
};
export type CanvasLayout = {
  version: 1;
  nodes: Record<string, { x: number; y: number; locked?: boolean }>;
  viewport: { x: number; y: number; zoom: number };
  annotations: CanvasAnnotation[];
};
export type CanvasEdge = CanvasAnnotation & {
  kind: "formal" | "annotation";
  eventId?: string;
  state?: CanvasNodeState;
};
export type CanvasGraph = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  cutoff: number;
};
export type CanvasProjectionOptions = {
  module: CanvasModule;
  tab: string;
  chapterId: string;
  showPlans?: boolean;
  snapshot?: TimelineSnapshot | null;
};
export const CANVAS_NODE_WIDTH = 280;
export const CANVAS_NODE_HEIGHT = 230;
export const canvasViewKey = (module: CanvasModule, tab: string) =>
  `${module}:${tab}`;
const excerpt = (value: string | undefined, limit = 220) => {
  const text = (value || "").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};
const eventKey = (event: TimelineEvent) =>
  JSON.stringify([
    event.kind,
    event.kind === "world" ? event.entity : event.characterId,
    event.kind === "relation" ? event.targetId : "",
    event.attribute,
  ]);
const eventRef = (event: TimelineEvent) =>
  event.id
    ? `event:${event.id}`
    : `event:${[event.kind, event.chapterId, event.characterId, event.targetId, event.entity, event.attribute, event.sequence].map(encodeURIComponent).join(":")}`;
const statusLabels: Record<CanvasNodeState, string> = {
  initial: "初始资料",
  active: "当前有效",
  planned: "计划",
  future: "尚未发生",
  stale: "待复核",
  superseded: "历史状态",
  provisional: "待确认",
};

/** The same state rules as timeline.cjs; this projection does not change story data. */
export function resolveCanvasTimeline(
  book: Book,
  chapterId: string,
): TimelineSnapshot {
  const cutoff = chapterId
    ? (book.chapters.find((chapter) => chapter.id === chapterId)?.order ?? -1)
    : 0;
  const events = (book.timeline || [])
    .map((event, index) => {
      const chapter = book.chapters.find((item) => item.id === event.chapterId);
      let state: CanvasNodeState = "active";
      if (event.phase === "planned") state = "planned";
      else if (
        (event as TimelineEvent & { stale?: boolean }).stale ||
        (event.kind !== "world" &&
          (!book.characters.some((person) => person.id === event.characterId) ||
            (event.kind === "relation" &&
              !book.characters.some((person) => person.id === event.targetId))))
      )
        state = "stale";
      else if (
        event.chapterId &&
        (!chapter ||
          chapter.status !== "final" ||
          chapter.revision !== event.sourceRevision)
      )
        state = "stale";
      else if (event.chapterId && (chapter?.order ?? Infinity) > cutoff)
        state = "future";
      return {
        ...event,
        createdAt:
          (event as TimelineEvent & { createdAt?: string }).createdAt || "",
        state,
        order: chapter?.order || 0,
        chapterTitle:
          chapter?.title || (event.chapterId ? "来源章节已删除" : "故事开始前"),
        originalIndex: index,
      };
    })
    .sort(
      (a, b) =>
        (a.order || 0) - (b.order || 0) ||
        a.sequence - b.sequence ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.originalIndex - b.originalIndex,
    );
  const latest = new Map<string, (typeof events)[number]>();
  events.forEach((event) => {
    if (event.state === "active") latest.set(eventKey(event), event);
  });
  const effective = [...latest.values()];
  return {
    cutoff,
    events: events.map((event) => ({
      ...event,
      state:
        event.state === "active" && latest.get(eventKey(event)) !== event
          ? "superseded"
          : event.state,
    })),
    world: effective.filter((event) => event.kind === "world"),
    characters: effective.filter((event) => event.kind === "character"),
    relations: effective.filter((event) => event.kind === "relation"),
  };
}

/** Build cards from stable source references. Prose is deliberately never copied into a card. */
export function buildCanvasGraph(
  book: Book,
  options: CanvasProjectionOptions,
): CanvasGraph {
  const local = resolveCanvasTimeline(book, options.chapterId);
  const supplied = options.snapshot;
  const snap =
    supplied &&
    supplied.cutoff === local.cutoff &&
    supplied.events.length === local.events.length &&
    supplied.events.every((event) =>
      local.events.some(
        (item) =>
          item.id === event.id &&
          item.state === event.state &&
          item.value === event.value &&
          item.sourceRevision === event.sourceRevision,
      ),
    )
      ? supplied
      : local;
  const cutoff = local.cutoff ?? 0,
    showPlans = !!options.showPlans;
  const nodes = new Map<string, CanvasNode>(),
    edges = new Map<string, CanvasEdge>();
  const add = (node: CanvasNode) => nodes.set(node.id, node);
  const formal = (
    id: string,
    source: string,
    target: string,
    label: string,
    extra: Partial<CanvasEdge> = {},
  ) =>
    edges.set(id, {
      id,
      source,
      target,
      label: excerpt(label, 26),
      kind: "formal",
      direction: "forward",
      dashed: false,
      ...extra,
    });
  const base = (
    id: string,
    kind: CanvasNodeKind,
    title: string,
    body: string,
    extra: Partial<CanvasNode> = {},
  ): CanvasNode => ({
    id,
    kind,
    title,
    body: excerpt(body),
    subtitle: "",
    sourceLabel: "作者初始资料",
    status: body.trim() ? "初始资料" : "待填写",
    state: body.trim() ? "initial" : "provisional",
    scope: body.trim() ? "initial" : "provisional",
    editable: true,
    ...extra,
  });
  const chapterById = (id: string) =>
    book.chapters.find((chapter) => chapter.id === id);
  const people = book.characters.filter(
    (person) => !person.introducedOrder || person.introducedOrder <= cutoff,
  );
  const name = (id: string) =>
    book.characters.find((person) => person.id === id)?.name || "已删除人物";
  const visibleEvent = (event: TimelineEvent) =>
    event.phase === "planned"
      ? showPlans
      : !event.chapterId ||
        (chapterById(event.chapterId)?.order ?? Infinity) <= cutoff;
  const eventNode = (event: TimelineEvent): CanvasNode => {
    const state = (event.state ||
      (event.phase === "planned" ? "planned" : "active")) as CanvasNodeState;
    return base(
      eventRef(event),
      "event",
      event.title || `${event.attribute}变化`,
      `${event.attribute}：${event.value}`,
      {
        entityId: event.id,
        chapterId: event.chapterId,
        subtitle:
          event.kind === "world"
            ? event.entity
            : event.kind === "relation"
              ? `${name(event.characterId)} → ${name(event.targetId)}`
              : name(event.characterId),
        sourceLabel:
          event.chapterTitle ||
          chapterById(event.chapterId)?.title ||
          "故事开始前",
        state,
        status: statusLabels[state] || "待复核",
        scope:
          state === "planned"
            ? "planning"
            : state === "active"
              ? "confirmed"
              : "historical",
        editable: !!event.id,
      },
    );
  };
  if (options.module === "outline") {
    if (options.tab === "foundation") {
      add(
        base("book:premise", "premise", "故事简介", book.premise, {
          subtitle: book.title,
        }),
      );
      add(
        base("book:outline", "book-outline", "全书总纲", book.outline, {
          scope: "planning",
          status: "故事规划",
        }),
      );
      formal(
        "structure:premise-outline",
        "book:premise",
        "book:outline",
        "故事方向",
      );
    }
    if (options.tab !== "board")
      (book.volumes || []).forEach((volume) => {
        add(
          base(`volume:${volume.id}`, "volume", volume.title, volume.outline, {
            entityId: volume.id,
            scope: "planning",
            status: "卷规划",
            subtitle: "分卷大纲",
          }),
        );
        formal(
          `structure:outline-volume:${volume.id}`,
          "book:outline",
          `volume:${volume.id}`,
          "分卷规划",
        );
        if (options.tab === "volumes" && volume.detail) {
          add(
            base(
              `volume-detail:${volume.id}`,
              "volume-detail",
              `${volume.title} · 细纲`,
              volume.detail,
              { entityId: volume.id, scope: "planning", status: "卷细纲" },
            ),
          );
          formal(
            `structure:volume-detail:${volume.id}`,
            `volume:${volume.id}`,
            `volume-detail:${volume.id}`,
            "展开细纲",
          );
        }
      });
    const visibleChapters = [...book.chapters]
      .sort((a, b) => a.order - b.order)
      .filter((chapter) => chapter.order <= cutoff || showPlans);
    visibleChapters.forEach((chapter) => {
      const confirmed = chapter.status === "final" && chapter.order <= cutoff;
      add(
        base(
          `chapter:${chapter.id}`,
          "chapter",
          chapter.title,
          confirmed
            ? chapter.summary || "尚未填写章节概要；打开章节可以查看正文。"
            : chapter.outline || "尚未填写章节计划。",
          {
            entityId: chapter.id,
            chapterId: chapter.id,
            subtitle: `第 ${chapter.order} 章`,
            sourceLabel: confirmed ? "已定稿章节" : "作者章节计划",
            state: confirmed ? "active" : "planned",
            status: confirmed ? "已定稿" : "计划",
            scope: confirmed ? "confirmed" : "planning",
          },
        ),
      );
      formal(
        `structure:volume-chapter:${chapter.id}`,
        `volume:${chapter.volumeId}`,
        `chapter:${chapter.id}`,
        "包含章节",
        { dashed: !confirmed },
      );
      if (options.tab === "volumes" && chapter.outline) {
        add(
          base(
            `chapter-outline:${chapter.id}`,
            "chapter-outline",
            `${chapter.title} · 细纲`,
            chapter.outline,
            {
              entityId: chapter.id,
              chapterId: chapter.id,
              scope: "planning",
              status: "章节细纲",
            },
          ),
        );
        formal(
          `structure:chapter-outline:${chapter.id}`,
          `chapter:${chapter.id}`,
          `chapter-outline:${chapter.id}`,
          "写作计划",
        );
      }
      if (options.tab === "timeline" && confirmed && chapter.summary) {
        add(
          base(
            `chapter-summary:${chapter.id}`,
            "chapter-summary",
            `${chapter.title} · 概要`,
            chapter.summary,
            {
              entityId: chapter.id,
              chapterId: chapter.id,
              scope: "confirmed",
              state: "active",
              status: "章节概要",
              sourceLabel: chapter.title,
            },
          ),
        );
        formal(
          `structure:chapter-summary:${chapter.id}`,
          `chapter:${chapter.id}`,
          `chapter-summary:${chapter.id}`,
          "章节概要",
        );
      }
    });
    if (options.tab === "timeline" || options.tab === "board")
      visibleChapters.forEach((chapter, index) => {
        const previous = visibleChapters[index - 1];
        if (previous)
          formal(
            `structure:chapter-order:${chapter.id}`,
            `chapter:${previous.id}`,
            `chapter:${chapter.id}`,
            "剧情推进",
            { dashed: chapter.order > cutoff || chapter.status !== "final" },
          );
      });
  }
  if (options.module === "characters") {
    people.forEach((person) => {
      const current = (snap.characters || []).filter(
        (event) =>
          event.characterId === person.id &&
          event.state !== "stale" &&
          visibleEvent(event),
      );
      const knowledgeAvailable =
        !person.knowledgeFromChapterId ||
        (chapterById(person.knowledgeFromChapterId)?.order ?? Infinity) <=
          cutoff;
      const description = [
        person.description,
        knowledgeAvailable && person.characterKnown
          ? `当前认知：${person.characterKnown}`
          : "",
        ...current.map((event) => `${event.attribute}：${event.value}`),
      ]
        .filter(Boolean)
        .join("\n");
      add(
        base(`character:${person.id}`, "character", person.name, description, {
          entityId: person.id,
          subtitle: person.role || "人物档案",
          state: current.length ? "active" : "initial",
          scope: current.length ? "confirmed" : "initial",
          status: current.length ? "当前有效状态" : "初始档案",
          sourceLabel: current.at(-1)?.chapterTitle || "人物基础资料",
        }),
      );
    });
    const relations = [
      ...(snap.relations || []),
      ...(showPlans
        ? snap.events.filter(
            (event) => event.kind === "relation" && event.state === "planned",
          )
        : []),
    ];
    relations.filter(visibleEvent).forEach((event) =>
      formal(
        `relation:${event.id || eventRef(event)}`,
        `character:${event.characterId}`,
        `character:${event.targetId}`,
        event.value,
        {
          eventId: event.id,
          direction: "forward",
          dashed: event.phase === "planned",
          state: event.phase === "planned" ? "planned" : "active",
          note: event.evidence,
        },
      ),
    );
    if (options.tab === "relations")
      snap.events
        .filter(
          (event) =>
            event.kind !== "world" &&
            visibleEvent(event) &&
            event.state !== "future" &&
            !(
              event.kind === "relation" &&
              relations.some(
                (relation) => eventRef(relation) === eventRef(event),
              )
            ),
        )
        .forEach((event) => {
          add(eventNode(event));
          formal(
            `event:person:${event.id || eventRef(event)}`,
            `character:${event.characterId}`,
            eventRef(event),
            event.attribute,
            {
              eventId: event.id,
              dashed: event.phase === "planned",
              state: event.state as CanvasNodeState,
            },
          );
          if (event.kind === "relation")
            formal(
              `event:target:${event.id || eventRef(event)}`,
              eventRef(event),
              `character:${event.targetId}`,
              "关系对象",
              {
                eventId: event.id,
                dashed: event.phase === "planned",
                state: event.state as CanvasNodeState,
              },
            );
        });
  }
  if (options.module === "world") {
    add(
      base("world:base", "world-base", "世界观与固定规则", book.world, {
        subtitle: "完整世界设定",
      }),
    );
    (book.worldRecords || []).forEach((record) => {
      const changes = (snap.world || []).filter(
        (event) =>
          event.entity.trim() === record.title.trim() &&
          event.state !== "stale" &&
          visibleEvent(event),
      );
      add(
        base(
          `world:${record.id}`,
          "world",
          record.title,
          [
            record.description,
            ...changes.map((event) => `${event.attribute}：${event.value}`),
          ].join("\n"),
          {
            entityId: record.id,
            subtitle: record.category,
            state:
              record.certainty === "provisional"
                ? "provisional"
                : changes.length
                  ? "active"
                  : "initial",
            scope:
              record.certainty === "provisional"
                ? "provisional"
                : changes.length
                  ? "confirmed"
                  : "initial",
            status:
              record.certainty === "provisional"
                ? "待确认资料"
                : changes.length
                  ? "当前有效状态"
                  : "固定资料",
            sourceLabel: changes.at(-1)?.chapterTitle || "世界资料卡",
          },
        ),
      );
      formal(
        `structure:world-record:${record.id}`,
        "world:base",
        `world:${record.id}`,
        record.category || "世界资料",
      );
    });
    if (options.tab === "evolution")
      snap.events
        .filter(
          (event) =>
            event.kind === "world" &&
            visibleEvent(event) &&
            event.state !== "future",
        )
        .forEach((event) => {
          add(eventNode(event));
          const record = book.worldRecords?.find(
            (item) => item.title.trim() === event.entity.trim(),
          );
          formal(
            `event:world:${event.id || eventRef(event)}`,
            record ? `world:${record.id}` : "world:base",
            eventRef(event),
            event.attribute,
            {
              eventId: event.id,
              dashed: event.phase === "planned",
              state: event.state as CanvasNodeState,
            },
          );
        });
  }
  if (options.module === "memory") {
    if (options.tab === "timeline")
      snap.events
        .filter((event) => visibleEvent(event) && event.state !== "future")
        .forEach((event) => {
          add(eventNode(event));
          if (event.chapterId) {
            const chapter = chapterById(event.chapterId);
            if (chapter && chapter.order <= cutoff) {
              add(
                base(
                  `chapter:${chapter.id}`,
                  "chapter",
                  chapter.title,
                  chapter.summary || "打开来源章节核对记录。",
                  {
                    entityId: chapter.id,
                    chapterId: chapter.id,
                    scope: "confirmed",
                    state: "active",
                    status: chapter.status === "final" ? "已定稿" : "未定稿",
                    sourceLabel: "变化来源章节",
                  },
                ),
              );
              formal(
                `source:event:${event.id || eventRef(event)}`,
                `chapter:${chapter.id}`,
                eventRef(event),
                "来源证据",
                {
                  eventId: event.id,
                  dashed: event.phase === "planned",
                  state: event.state as CanvasNodeState,
                },
              );
            }
          }
        });
    else if (options.tab === "foreshadows")
      (book.foreshadows || []).forEach((item) => {
        const planted = chapterById(item.plantedChapterId),
          payoff = item.payoffChapterId
            ? chapterById(item.payoffChapterId)
            : undefined;
        if (planted && planted.order > cutoff && !showPlans) return;
        const future = !!planted && planted.order > cutoff,
          resolved =
            item.status === "resolved" && (!payoff || payoff.order <= cutoff);
        add(
          base(`foreshadow:${item.id}`, "foreshadow", item.title, item.note, {
            entityId: item.id,
            chapterId: item.plantedChapterId,
            subtitle: "伏笔台账",
            sourceLabel: planted?.title || "首次出现章节已删除",
            state: future ? "planned" : planted ? "active" : "stale",
            scope: future ? "planning" : planted ? "confirmed" : "historical",
            status: future
              ? "计划埋下"
              : resolved
                ? "已回收"
                : item.status === "abandoned"
                  ? "已搁置"
                  : "待回收",
          }),
        );
      });
    else
      book.memories.forEach((memory) => {
        const chapter = memory.sourceChapterId
          ? chapterById(memory.sourceChapterId)
          : undefined;
        if (chapter && chapter.order > cutoff) return;
        const stale =
          memory.stale ||
          (!!memory.sourceChapterId &&
            (!chapter ||
              chapter.status !== "final" ||
              chapter.revision !== memory.sourceRevision));
        add(
          base(
            `memory:${memory.id}`,
            "memory",
            `${memory.subject} · ${memory.relation}`,
            [memory.object, memory.evidence ? `证据：${memory.evidence}` : ""]
              .filter(Boolean)
              .join("\n"),
            {
              entityId: memory.id,
              chapterId: memory.sourceChapterId,
              subtitle: "事实记忆",
              sourceLabel:
                chapter?.title ||
                (memory.sourceChapterId ? "来源章节已删除" : "作者固定设定"),
              state: stale ? "stale" : "active",
              scope: stale ? "historical" : "confirmed",
              status: stale ? "来源变化 · 待复核" : "已确认事实",
            },
          ),
        );
      });
  }
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()].filter(
      (edge) => nodes.has(edge.source) && nodes.has(edge.target),
    ),
    cutoff,
  };
}

export function emptyCanvasLayout(): CanvasLayout {
  return {
    version: 1,
    nodes: {},
    viewport: { x: 24, y: 24, zoom: 1 },
    annotations: [],
  };
}
export function mergeCanvasLayout(
  layout: CanvasLayout,
  nodes: CanvasNode[],
): CanvasLayout {
  const missing = nodes.filter((node) => !layout.nodes[node.id]);
  if (!missing.length) return layout;
  const positions = { ...layout.nodes };
  // Reserve grid slots touched by existing cards, including freely dragged and locked ones.
  const occupied = new Set<number>();
  const reserve = (position: { x: number; y: number }) => {
    const dx = CANVAS_NODE_WIDTH + 36,
      dy = CANVAS_NODE_HEIGHT + 36;
    const firstColumn = Math.max(0, Math.ceil((position.x - dx - 50) / 380));
    const lastColumn = Math.min(2, Math.floor((position.x + dx - 50) / 380));
    const firstRow = Math.max(0, Math.ceil((position.y - dy - 70) / 310));
    const lastRow = Math.floor((position.y + dy - 70) / 310);
    for (let row = firstRow; row <= lastRow; row++)
      for (let column = firstColumn; column <= lastColumn; column++)
        occupied.add(row * 3 + column);
  };
  Object.values(positions).forEach(reserve);
  let slot = 0;
  missing.forEach((node) => {
    while (occupied.has(slot)) slot++;
    const point = {
      x: 50 + (slot % 3) * 380,
      y: 70 + Math.floor(slot / 3) * 310,
    };
    positions[node.id] = point;
    reserve(point);
    slot++;
  });
  return { ...layout, nodes: positions };
}
export function arrangeCanvasLayout(
  layout: CanvasLayout,
  nodes: CanvasNode[],
): CanvasLayout {
  const positions: CanvasLayout["nodes"] = {};
  const visible = new Set(nodes.map((node) => node.id));
  Object.entries(layout.nodes).forEach(([id, position]) => {
    if (position.locked || !visible.has(id)) positions[id] = { ...position };
  });
  const arranged = mergeCanvasLayout({ ...layout, nodes: positions }, nodes);
  return { ...arranged, viewport: { ...layout.viewport } };
}

export function pruneCanvasLayout(
  layout: CanvasLayout,
  book: Book,
): CanvasLayout {
  const refs = new Set(["book:outline", "book:premise", "world:base"]);
  const add = (items: { id?: string }[] | undefined, prefixes: string[]) => {
    for (const item of items || [])
      if (item.id)
        for (const prefix of prefixes) refs.add(`${prefix}:${item.id}`);
  };
  add(book.volumes, ["volume", "volume-detail"]);
  add(book.chapters, ["chapter", "chapter-outline", "chapter-summary"]);
  add(book.characters, ["character"]);
  add(book.worldRecords, ["world"]);
  add(book.memories, ["memory"]);
  add(book.timeline, ["event"]);
  add(book.foreshadows, ["foreshadow"]);
  const nodes = Object.fromEntries(
    Object.entries(layout.nodes).filter(([id]) => refs.has(id)),
  );
  const annotations = layout.annotations.filter(
    (edge) => refs.has(edge.source) && refs.has(edge.target),
  );
  return Object.keys(nodes).length === Object.keys(layout.nodes).length &&
    annotations.length === layout.annotations.length
    ? layout
    : { ...layout, nodes, annotations };
}
