const { randomUUID } = require("node:crypto");

const VIEW_KEYS = new Set([
  "outline", "characters", "world", "memory",
  "outline:foundation", "outline:timeline", "outline:volumes", "outline:board",
  "characters:archive", "characters:relations",
  "world:setting", "world:evolution",
  "memory:facts", "memory:timeline", "memory:foreshadows",
]);
const FIXED_REFS = new Set(["book:outline", "book:premise", "world:base"]);
const REF_MAPS = {
  volume: "volumeMap", "volume-detail": "volumeMap",
  chapter: "chapterMap", "chapter-outline": "chapterMap", "chapter-summary": "chapterMap",
  character: "characterMap", world: "worldMap", memory: "memoryMap",
  event: "eventMap", foreshadow: "foreshadowMap",
};
function check(value, message) {
  if (!value) throw Error(message);
}
function object(value, message) {
  check(value && typeof value === "object" && !Array.isArray(value), message);
}
function fields(value, allowed, message) {
  object(value, message);
  check(Object.keys(value).every((key) => allowed.includes(key)), message);
}
function string(value, max, message) {
  check(typeof value === "string" && value.length <= max, message);
  return value;
}
function coordinate(value) {
  check(typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 10000000,
    "画布坐标必须是有限数字，且在允许范围内");
  return value === 0 ? 0 : value;
}
function validateView(view) {
  check(VIEW_KEYS.has(view), "画布视图不存在");
  return view;
}
function canvasRefs(book) {
  const refs = new Set(FIXED_REFS);
  const add = (items, prefixes) => {
    for (const item of items || [])
      for (const prefix of prefixes) if (typeof item.id === "string") refs.add(prefix + ":" + item.id);
  };
  add(book.volumes, ["volume", "volume-detail"]);
  add(book.chapters, ["chapter", "chapter-outline", "chapter-summary"]);
  add(book.characters, ["character"]);
  add(book.worldRecords, ["world"]);
  add(book.memories, ["memory"]);
  add(book.timeline, ["event"]);
  add(book.foreshadows, ["foreshadow"]);
  return refs;
}
function normalizeLayout(input, refs, strictRefs = true) {
  fields(input, ["version", "nodes", "viewport", "annotations"], "画布只允许保存布局和标注，不能保存正文或资料副本");
  check(input.version === 1, "画布布局版本无效");
  object(input.nodes, "画布节点布局格式无效");
  const entries = Object.entries(input.nodes);
  check(entries.length <= 25000, "画布节点数量超过限制");
  const nodes = {};
  for (const [key, position] of entries) {
    string(key, 220, "画布实体引用格式无效");
    fields(position, ["x", "y", "locked"], "画布节点只允许保存坐标和锁定状态");
    const next = { x: coordinate(position.x), y: coordinate(position.y) };
    if (position.locked !== undefined) {
      check(typeof position.locked === "boolean", "画布锁定状态无效");
      next.locked = position.locked;
    }
    if (!refs.has(key)) {
      check(!strictRefs, "画布节点来源不属于本书或已经删除");
      continue;
    }
    nodes[key] = next;
  }
  fields(input.viewport, ["x", "y", "zoom"], "画布视口格式无效");
  const viewport = { x: coordinate(input.viewport.x), y: coordinate(input.viewport.y), zoom: input.viewport.zoom };
  check(typeof viewport.zoom === "number" && Number.isFinite(viewport.zoom) && viewport.zoom >= 0.05 && viewport.zoom <= 8,
    "画布缩放应为 0.05–8 之间的有限数字");
  check(Array.isArray(input.annotations) && input.annotations.length <= 5000, "画布标注数量或格式无效");
  const annotations = [], ids = new Set();
  for (const edge of input.annotations) {
    fields(edge, ["id", "source", "target", "label", "note", "direction", "dashed"], "画布标注字段无效");
    const next = {
      id: string(edge.id, 120, "画布标注 ID 无效"),
      source: string(edge.source, 220, "画布标注起点无效"),
      target: string(edge.target, 220, "画布标注终点无效"),
      label: string(edge.label, 160, "画布标注名称最多 160 字"),
      direction: edge.direction,
      dashed: edge.dashed,
    };
    check(next.id.trim() && !ids.has(next.id), "画布标注 ID 为空或重复");
    ids.add(next.id);
    check(["none", "forward", "both"].includes(next.direction), "画布标注方向无效");
    check(typeof next.dashed === "boolean", "画布标注线型无效");
    check(next.source !== next.target, "画布标注需要两个不同端点");
    if (edge.note !== undefined) next.note = string(edge.note, 2000, "画布标注备注最多 2000 字");
    if (!refs.has(next.source) || !refs.has(next.target)) {
      check(!strictRefs, "画布标注端点不属于本书或已经删除");
      continue;
    }
    annotations.push(next);
  }
  return { version: 1, nodes, viewport, annotations };
}
function remapRef(ref, maps) {
  if (FIXED_REFS.has(ref)) return ref;
  const split = ref.indexOf(":"), prefix = ref.slice(0, split), oldId = ref.slice(split + 1);
  const mapped = maps[REF_MAPS[prefix]]?.get(oldId);
  return mapped ? prefix + ":" + mapped : null;
}
function remapCanvasLayout(input, maps, sourceBook) {
  const source = normalizeLayout(input, canvasRefs(sourceBook), false), nodes = {};
  for (const [ref, position] of Object.entries(source.nodes)) {
    const mapped = remapRef(ref, maps);
    if (mapped) nodes[mapped] = position;
  }
  const annotations = source.annotations.flatMap((edge) => {
    const source = remapRef(edge.source, maps), target = remapRef(edge.target, maps);
    return source && target ? [{ ...edge, id: randomUUID(), source, target }] : [];
  });
  return { version: 1, nodes, viewport: source.viewport, annotations };
}
function writeLayout(store, bookId, view, layout) {
  store.db.prepare("INSERT INTO canvas_views (book_id,view,data) VALUES (?,?,?) ON CONFLICT(book_id,view) DO UPDATE SET data=excluded.data")
    .run(bookId, view, JSON.stringify(layout));
  return layout;
}
function installCanvas(Store) {
  Object.assign(Store.prototype, {
    getCanvas(bookId, view) {
      validateView(view);
      const book = this.book(bookId);
      check(!book.deletedAt, "请先从回收站恢复作品");
      const row = this.db.prepare("SELECT data FROM canvas_views WHERE book_id=? AND view=?").get(bookId, view);
      return row ? normalizeLayout(JSON.parse(row.data), canvasRefs(book), false) : null;
    },
    saveCanvas(bookId, view, input) {
      validateView(view);
      const book = this.book(bookId);
      check(!book.deletedAt, "请先从回收站恢复作品");
      return writeLayout(this, bookId, view, normalizeLayout(input, canvasRefs(book)));
    },
    canvasViews() {
      return this.db.prepare("SELECT book_id,view,data FROM canvas_views ORDER BY book_id,view").all().map((row) => ({
        bookId: row.book_id, view: row.view,
        layout: normalizeLayout(JSON.parse(row.data), canvasRefs(this.book(row.book_id, true)), false),
      }));
    },
    restoreCanvasViews(sourceBook, bookId, entries, maps) {
      const seen = new Set(), refs = canvasRefs(this.book(bookId, true));
      for (const entry of entries || []) {
        if (entry.bookId !== sourceBook.id) continue;
        validateView(entry.view);
        check(!seen.has(entry.view), "备份含重复画布视图");
        seen.add(entry.view);
        const layout = remapCanvasLayout(entry.layout, maps, sourceBook);
        writeLayout(this, bookId, entry.view, normalizeLayout(layout, refs, false));
      }
    },
  });
}
module.exports = { installCanvas, canvasRefs, normalizeLayout, remapCanvasLayout, VIEW_KEYS };
