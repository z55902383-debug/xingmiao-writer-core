const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveTimeline } = require("../electron/timeline.cjs");
const {
  buildCanvasGraph,
  resolveCanvasTimeline,
  emptyCanvasLayout,
  mergeCanvasLayout,
  arrangeCanvasLayout,
  pruneCanvasLayout,
} = require("../src/canvasModel.ts");

function fixture() {
  const event = (id, patch = {}) => ({
    id,
    kind: "relation",
    title: id,
    entity: "",
    characterId: "a",
    targetId: "b",
    attribute: "关系",
    value: id,
    chapterId: "",
    phase: "confirmed",
    sequence: 1,
    storyTime: "",
    evidence: "",
    sourceRevision: 0,
    createdAt: id === "earlier" ? "2026-01-01" : "2026-01-02",
    ...patch,
  });
  return {
    id: "book",
    title: "测试作品",
    premise: "简介",
    outline: "总纲",
    world: "原始世界设定",
    memories: [],
    worldRecords: [],
    foreshadows: [],
    volumes: [],
    characters: [
      { id: "a", name: "甲", description: "原档案", role: "" },
      { id: "b", name: "乙", description: "原档案", role: "" },
    ],
    chapters: [
      {
        id: "c1",
        order: 1,
        title: "第一章",
        body: "原文",
        outline: "",
        summary: "",
        status: "final",
        revision: 1,
      },
      {
        id: "c2",
        order: 2,
        title: "第二章",
        body: "未来原文",
        outline: "",
        summary: "",
        status: "final",
        revision: 2,
      },
    ],
    timeline: [
      event("later"),
      event("earlier"),
      event("future", {
        kind: "world",
        entity: "雾港",
        chapterId: "c2",
        sourceRevision: 2,
      }),
      event("plan", { phase: "planned", attribute: "计划" }),
      event("stale", {
        kind: "character",
        attribute: "状态",
        chapterId: "c1",
        sourceRevision: 0,
      }),
    ],
  };
}

test("画布回看与正式时间线一致，包括同序记录、未来、计划与过期来源", () => {
  const book = fixture();
  for (const chapterId of ["", "c1", "c2"]) {
    const canvas = resolveCanvasTimeline(book, chapterId),
      source = resolveTimeline(book, chapterId);
    const states = (value) => value.events.map((e) => [e.id, e.state]);
    assert.deepEqual(states(canvas), states(source));
    assert.deepEqual(
      canvas.relations.map((e) => e.id),
      source.relations.map((e) => e.id),
    );
    assert.deepEqual(
      canvas.world.map((e) => e.id),
      source.world.map((e) => e.id),
    );
  }
});

test("当前正式关系只生成一条主连线，历史和待复核变化仍可查阅", () => {
  const book = fixture(),
    graph = buildCanvasGraph(book, {
      module: "characters",
      tab: "relations",
      chapterId: "c1",
      showPlans: true,
    });
  assert.equal(graph.edges.filter((e) => e.eventId === "later").length, 1);
  assert.equal(
    graph.edges.find((e) => e.eventId === "later").id,
    "relation:later",
  );
  assert.ok(
    graph.nodes.some(
      (n) => n.id === "event:earlier" && n.state === "superseded",
    ),
  );
  assert.ok(
    graph.nodes.some((n) => n.id === "event:stale" && n.state === "stale"),
  );
  assert.ok(!graph.nodes.some((n) => n.id === "event:future"));
  assert.equal(graph.edges.filter((e) => e.eventId === "plan").length, 1);
});

test("新增大量节点不移动既有位置，锁定与隐藏节点在整理中保留", () => {
  const book = fixture(),
    source = buildCanvasGraph(book, {
      module: "characters",
      tab: "archive",
      chapterId: "c1",
    }).nodes[0];
  const nodes = Array.from({ length: 1200 }, (_, i) => ({
    ...source,
    id: `character:${i}`,
  }));
  const original = {
    ...emptyCanvasLayout(),
    nodes: {
      "character:0": { x: 120, y: 150, locked: true },
      "character:hidden": { x: -440, y: 20 },
    },
    viewport: { x: 71, y: -13, zoom: 0.65 },
  };
  const merged = mergeCanvasLayout(original, nodes);
  assert.deepEqual(merged.nodes["character:0"], original.nodes["character:0"]);
  assert.deepEqual(merged.viewport, original.viewport);
  assert.equal(
    new Set(Object.values(merged.nodes).map((p) => `${p.x}:${p.y}`)).size,
    1201,
  );
  const arranged = arrangeCanvasLayout(merged, nodes);
  assert.deepEqual(
    arranged.nodes["character:0"],
    original.nodes["character:0"],
  );
  assert.deepEqual(
    arranged.nodes["character:hidden"],
    original.nodes["character:hidden"],
  );
  assert.deepEqual(arranged.viewport, original.viewport);
});

test("删除实体清理悬空布局和标注，不删除仍存在的隐藏时点资料", () => {
  const book = fixture(),
    layout = {
      ...emptyCanvasLayout(),
      nodes: {
        "character:a": { x: 0, y: 0 },
        "character:b": { x: 380, y: 0 },
        "chapter:c2": { x: 760, y: 0 },
      },
      annotations: [
        {
          id: "edge",
          source: "character:a",
          target: "character:b",
          label: "标注",
          direction: "none",
          dashed: true,
        },
      ],
    };
  const originalBook = JSON.stringify(book);
  assert.equal(pruneCanvasLayout(layout, book), layout);
  const after = pruneCanvasLayout(layout, {
    ...book,
    characters: book.characters.filter((c) => c.id !== "b"),
  });
  assert.ok(!after.nodes["character:b"]);
  assert.ok(after.nodes["chapter:c2"]);
  assert.equal(after.annotations.length, 0);
  assert.equal(JSON.stringify(book), originalBook);
});
