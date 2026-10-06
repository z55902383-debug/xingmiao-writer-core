const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");
const { mkdirSync } = require("node:fs");
const { dirname } = require("node:path");
const now = () => new Date().toISOString();
const id = () => randomUUID();
const text = (value, max = Infinity) => {
  if (typeof value !== "string" || value.length > max)
    throw new Error("文本格式不正确或超过长度限制");
  return value;
};
function assert(value, message) {
  if (!value) throw new Error(message);
}
function memoryRecord(store, bookId, input, existing) {
  const memory = {
    id: existing?.id || id(),
    subject: text(input.subject, 120),
    relation: text(input.relation, 200),
    object: text(input.object),
    sourceChapterId: text(input.sourceChapterId || "", 100),
    sourceRevision: 0,
    evidence: text(input.evidence || ""),
    stale: false,
    createdAt: existing?.createdAt ?? now(),
  };
  assert(memory.subject.trim() && memory.relation.trim() && memory.object.trim(), "请完整填写主体、关系和事实");
  if (memory.sourceChapterId) {
    const c = store.chapter(memory.sourceChapterId);
    assert(c.bookId === bookId && !c.deletedAt && c.status === "final", "来源章节必须属于本书且已定稿");
    assert(memory.evidence.trim() && c.body.includes(memory.evidence), "证据必须是来源章节中的原文");
    memory.sourceRevision = c.revision;
  }
  return memory;
}
function sameMemory(a, b) {
  return ["subject", "relation", "object", "sourceChapterId", "sourceRevision", "evidence"].every((key) => a[key] === b[key]);
}

class Store {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chapters (id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS canvas_views (book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, view TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(book_id,view));
      CREATE TABLE IF NOT EXISTS config (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS chapter_book ON chapters(book_id);
      CREATE INDEX IF NOT EXISTS version_chapter ON versions(chapter_id);
      CREATE INDEX IF NOT EXISTS candidate_book ON candidates(book_id);`);
    // An interrupted request retains its latest checkpoint; never presents it as complete.
    for (const row of this.db.prepare("SELECT id,data FROM candidates").all()) {
      const job = JSON.parse(row.data);
      if (job.review?.status === "analyzing") {
        job.review = {
          status: "error",
          error: "上次分析中断，正文已保留；采用后可重新分析",
        };
        this.putJob(job);
      }
      if (job.status === "running") {
        job.status = "interrupted";
        job.error = "上次请求已中断，已保留输出，可重新生成。";
        this.putJob(job);
      }
    }
  }
  transaction(fn) {
    if (this.inTransaction) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    } finally {
      this.inTransaction = false;
    }
  }
  close() {
    this.db.close();
  }
  rawBook(bookId) {
    const row = this.db
      .prepare("SELECT data FROM books WHERE id=?")
      .get(bookId);
    assert(row, "找不到这本书");
    return JSON.parse(row.data);
  }
  book(bookId, includeDeleted = false) {
    return {
      ...this.rawBook(bookId),
      chapters: this.chapters(bookId, includeDeleted),
      candidates: this.jobs(bookId),
    };
  }
  chapters(bookId, includeDeleted = false) {
    return this.db
      .prepare("SELECT data FROM chapters WHERE book_id=?")
      .all(bookId)
      .map((r) => JSON.parse(r.data))
      .filter((c) => includeDeleted || !c.deletedAt)
      .sort((a, b) => a.order - b.order);
  }
  chapter(chapterId) {
    const row = this.db
      .prepare("SELECT data FROM chapters WHERE id=?")
      .get(chapterId);
    assert(row, "章节不存在");
    return JSON.parse(row.data);
  }
  list(includeDeleted = false) {
    return this.db
      .prepare("SELECT data FROM books")
      .all()
      .map((row) => {
        const book = JSON.parse(row.data);
        const chapters = this.chapters(book.id);
        const recentChapter = [...chapters].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        )[0];
        return {
          ...book,
          chapterCount: chapters.length,
          recentChapterId: recentChapter?.id || "",
          recentChapterTitle: recentChapter?.title || "",
          words: chapters.reduce(
            (sum, c) => sum + c.body.replace(/\s/g, "").length,
            0,
          ),
        };
      })
      .filter((b) => includeDeleted || !b.deletedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  putBook(book) {
    book.updatedAt = now();
    this.db
      .prepare(
        "INSERT INTO books VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(book.id, JSON.stringify(book));
    return book;
  }
  putChapter(chapter) {
    this.db
      .prepare(
        "INSERT INTO chapters VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(chapter.id, chapter.bookId, JSON.stringify(chapter));
    return chapter;
  }
  createBook(input) {
    const title = text(input.title, 120).trim();
    assert(title, "请填写书名");
    const book = {
      id: id(),
      title,
      genre: text(input.genre || "未分类", 40),
      premise: text(input.premise || ""),
      outline: "",
      style: "",
      reference: "",
      referenceName: "",
      target: Math.max(
        1000,
        Math.min(10000000, Number(input.target) || 200000),
      ),
      characters: [],
      volumes: [],
      timeline: [],
      chapterTargetWords: 2000,
      contextChapters: 100,
      world: "",
      memories: [],
      memos: [],
      archived: false,
      createdAt: now(),
      updatedAt: now(),
    };
    return this.transaction(() => {
      this.putBook(book);
      // 与 createChapter 的自动命名保持同一种写法（阿拉伯数字）。
      // 原来这里写「第一章」、后续却是「第2章」，同一个列表里两种数字体例。
      this.createChapter(book.id, "第1章");
      return this.book(book.id);
    });
  }
  updateBook(bookId, patch) {
    const book = this.rawBook(bookId);
    assert(!book.deletedAt, "请先从回收站恢复作品");
    for (const key of [
      "title",
      "genre",
      "premise",
      "outline",
      "style",
      "reference",
      "referenceName",
      "world",
    ])
      if (key in patch)
        book[key] = text(patch[key], key === "title" ? 120 : Infinity);
    assert(book.title.trim(), "书名不能为空");
    if ("contextChapters" in patch) {
      const n = Number(patch.contextChapters);
      assert(Number.isInteger(n) && n >= 0 && n <= 100, "关联章节数应为 0–100");
      book.contextChapters = n;
    }
    if ("chapterTargetWords" in patch) {
      const n = Number(patch.chapterTargetWords);
      assert(
        Number.isInteger(n) && n >= 100 && n <= 20000,
        "每章默认字数应为 100–20000",
      );
      book.chapterTargetWords = n;
    }
    if ("archived" in patch) book.archived = !!patch.archived;
    if ("characters" in patch) {
      assert(
        Array.isArray(patch.characters) && patch.characters.length <= 500,
        "人物数量超出限制",
      );
      book.characters = patch.characters.map((c) => ({
        id: text(c.id, 100),
        name: text(c.name, 100),
        role: text(c.role, 100),
        description: text(c.description),
        authorNotes: text(c.authorNotes || ""),
        readerKnown: text(c.readerKnown || ""),
        characterKnown: text(c.characterKnown || ""),
        knowledgeFromChapterId: text(c.knowledgeFromChapterId || "", 100),
        secretFromChapterId: text(c.secretFromChapterId || "", 100),
        introducedOrder: Math.max(0, Number(c.introducedOrder) || 0),
      }));
    }
    if ("worldRecords" in patch) {
      assert(
        Array.isArray(patch.worldRecords) && patch.worldRecords.length <= 500,
        "世界资料卡最多 500 条",
      );
      book.worldRecords = patch.worldRecords.map((r) => ({
        id: text(r.id, 100),
        category: text(r.category, 60),
        title: text(r.title, 120),
        description: text(r.description),
        certainty: r.certainty === "provisional" ? "provisional" : "fixed",
      }));
    }
    if ("foreshadows" in patch) {
      assert(
        Array.isArray(patch.foreshadows) && patch.foreshadows.length <= 2000,
        "伏笔记录最多 2000 条",
      );
      book.foreshadows = patch.foreshadows.map((f) => ({
        id: text(f.id, 100),
        title: text(f.title, 240),
        plantedChapterId: text(f.plantedChapterId, 100),
        payoffChapterId: text(f.payoffChapterId || "", 100),
        status: ["resolved", "abandoned"].includes(f.status)
          ? f.status
          : "open",
        note: text(f.note || ""),
      }));
    }
    if ("memos" in patch) {
      assert(
        Array.isArray(patch.memos) && patch.memos.length <= 1000,
        "备忘录最多保存 1000 条",
      );
      book.memos = patch.memos.map((memo) => ({
        id: text(memo.id, 100),
        title: text(memo.title || "未命名备忘录", 160).trim() || "未命名备忘录",
        content: text(memo.content || ""),
        createdAt: text(memo.createdAt || now(), 64),
        updatedAt: now(),
      }));
    }
    this.putBook(book);
    return this.book(bookId);
  }
  createChapter(bookId, title = "") {
    const book = this.rawBook(bookId);
    assert(!book.deletedAt, "请先从回收站恢复作品");
    // 两件事要分开算：
    //   order —— 连已删除的一起看，保持单调，免得跟「以后可能从回收站恢复」的章节撞号；
    //   第几章 —— 只数没删的。回收站里的章节不应该继续占着编号，
    //            否则删到只剩一章，它还会叫「第 3 章」。
    const all = this.chapters(bookId, true);
    const live = all.filter((c) => !c.deletedAt);
    const c = {
      id: id(),
      bookId,
      title: text(title || `第${live.length + 1}章`, 120),
      outline: "",
      summary: "",
      volumeId: "",
      targetWords: 0,
      body: "",
      status: "draft",
      revision: 1,
      order: Math.max(0, ...all.map((c) => c.order)) + 1,
      updatedAt: now(),
    };
    this.putChapter(c);
    this.putBook(book);
    return c;
  }
  snapshot(c, label) {
    const version = {
      id: id(),
      chapterId: c.id,
      title: c.title,
      body: c.body,
      outline: c.outline,
      summary: c.summary || "",
      createdAt: now(),
      label,
      revision: c.revision,
    };
    this.db
      .prepare("INSERT INTO versions VALUES (?,?,?)")
      .run(version.id, c.id, JSON.stringify(version));
    const rows = this.db
      .prepare(
        "SELECT id FROM versions WHERE chapter_id=? ORDER BY rowid DESC LIMIT -1 OFFSET 100",
      )
      .all(c.id);
    for (const row of rows)
      this.db.prepare("DELETE FROM versions WHERE id=?").run(row.id);
    return version;
  }
  versions(chapterId) {
    this.chapter(chapterId);
    return this.db
      .prepare(
        "SELECT data FROM versions WHERE chapter_id=? ORDER BY rowid DESC",
      )
      .all(chapterId)
      .map((r) => JSON.parse(r.data));
  }
  invalidate(book, c) {
    const order = new Map(this.chapters(book.id).map((x) => [x.id, x.order]));
    book.timeline = (book.timeline || []).map((e) =>
      e.chapterId && (order.get(e.chapterId) ?? 0) >= c.order
        ? { ...e, stale: true }
        : e,
    );
    book.memories = book.memories.map((m) =>
      m.sourceChapterId && (order.get(m.sourceChapterId) ?? 0) >= c.order
        ? { ...m, stale: true }
        : m,
    );
  }
  updateChapter(chapterId, patch, revision, label = "自动保存") {
    return this.transaction(() => {
      const c = this.chapter(chapterId);
      assert(
        !c.deletedAt && !this.rawBook(c.bookId).deletedAt,
        "请先从回收站恢复章节和作品",
      );
      assert(
        c.revision === revision,
        "章节已发生变化，请重新打开后再操作，避免覆盖新内容",
      );
      const book = this.rawBook(c.bookId);
      const next = { ...c };
      for (const key of ["title", "outline", "body", "summary"])
        if (key in patch)
          next[key] = text(patch[key], key === "title" ? 160 : Infinity);
      if (
        c.title === next.title &&
        c.outline === next.outline &&
        c.body === next.body &&
        c.summary === next.summary
      )
        return c;
      this.snapshot(c, label);
      this.invalidate(book, c);
      if (c.body !== next.body) {
        const date = new Date();
        const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const activity = Array.isArray(book.writingActivity)
          ? [...book.writingActivity]
          : [];
        const wordDelta =
          next.body.replace(/\s/g, "").length -
          c.body.replace(/\s/g, "").length;
        const day = activity.find((item) => item.date === dayKey);
        if (day) day.netWords += wordDelta;
        else activity.push({ date: dayKey, netWords: wordDelta });
        book.writingActivity = activity
          .filter(
            (item) =>
              item.date >=
              new Date(date.getTime() - 90 * 86400000)
                .toISOString()
                .slice(0, 10),
          )
          .slice(-90);
      }
      next.revision++;
      next.status = "draft";
      next.updatedAt = now();
      this.putChapter(next);
      this.putBook(book);
      return next;
    });
  }
  finalize(chapterId, revision) {
    return this.transaction(() => {
      const c = this.chapter(chapterId);
      assert(
        !c.deletedAt && !this.rawBook(c.bookId).deletedAt,
        "请先从回收站恢复章节和作品",
      );
      assert(c.revision === revision, "请等待保存完成后再定稿");
      assert(c.body.trim(), "空章节不能定稿");
      this.snapshot(c, "定稿前快照");
      c.status = "final";
      c.updatedAt = now();
      this.putChapter(c);
      return c;
    });
  }
  restoreVersion(chapterId, versionId, revision) {
    const version = this.versions(chapterId).find((v) => v.id === versionId);
    assert(version, "版本不存在");
    return this.updateChapter(
      chapterId,
      {
        title: version.title,
        body: version.body,
        outline: version.outline,
        summary: version.summary || "",
      },
      revision,
      "恢复版本前快照",
    );
  }
  addMemory(bookId, input) {
    const book = this.rawBook(bookId);
    assert(!book.deletedAt, "请先从回收站恢复作品");
    const memory = memoryRecord(this, bookId, input);
    const duplicate = book.memories.some((m) => !m.stale && sameMemory(m, memory));
    if (duplicate) return this.book(bookId);
    book.memories.push(memory);
    this.putBook(book);
    return this.book(bookId);
  }
  updateMemory(bookId, input) {
    return this.transaction(() => {
      const book = this.rawBook(bookId);
      assert(!book.deletedAt, "请先从回收站恢复作品");
      const memoryId = text(input.id, 100), existing = book.memories.find((m) => m.id === memoryId);
      assert(existing, "事实记忆不存在或不属于本书");
      const memory = memoryRecord(this, bookId, input, existing);
      assert(!book.memories.some((m) => m.id !== memoryId && !m.stale && sameMemory(m, memory)), "另一条有效事实记忆已记录相同内容，请保留原记录");
      if (sameMemory(existing, memory) && existing.stale === memory.stale) return this.book(bookId);
      book.memories = book.memories.map((m) => m.id === memoryId ? memory : m);
      this.putBook(book);
      return this.book(bookId);
    });
  }
  deleteMemory(bookId, memoryId) {
    const b = this.rawBook(bookId);
    const memory = b.memories.find((m) => m.id === memoryId);
    if (memory) this.recycle("memory", bookId, memory);
    b.memories = b.memories.filter((m) => m.id !== memoryId);
    this.putBook(b);
    return this.book(bookId);
  }
  jobs(bookId) {
    return this.db
      .prepare(
        "SELECT data FROM candidates WHERE book_id=? ORDER BY rowid DESC LIMIT 40",
      )
      .all(bookId)
      .map((r) => JSON.parse(r.data));
  }
  job(jobId) {
    const row = this.db
      .prepare("SELECT data FROM candidates WHERE id=?")
      .get(jobId);
    assert(row, "找不到生成记录");
    return JSON.parse(row.data);
  }
  putJob(job) {
    this.db
      .prepare(
        "INSERT INTO candidates VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(job.id, job.bookId, JSON.stringify(job));
    return job;
  }
  adopt(jobId, mode) {
    return this.transaction(() => {
      const job = this.job(jobId);
      assert(
        ["done", "cancelled", "interrupted"].includes(job.status) &&
          job.output.trim(),
        "该候选稿还不能采用",
      );
      assert(!job.adopted, "这个候选稿已经采用过");
      const c = this.chapter(job.chapterId);
      if (job.planningSignature)
        assert(job.planningSignature === require("./planning-routes.cjs").planningSignature(this.book(job.bookId)), "生成后分卷或章节规划已修改，请重新生成，避免覆盖新规划。");
      if (job.contextSignature)
        assert(
          job.contextSignature ===
            require("./timeline.cjs").contextSignature(this.book(c.bookId), c),
          "生成后设定、时间线或规划已变化，请重新生成或复制候选稿手动合并",
        );
      assert(
        !c.deletedAt && !this.rawBook(c.bookId).deletedAt,
        "请先从回收站恢复章节和作品",
      );
      assert(
        c.revision === job.baseRevision,
        "生成后原文已修改。请复制候选稿，手动合并，避免覆盖新内容。",
      );
      if (require("./planning.cjs").applyPlanning(this, job, c)) {
        job.adopted = true;
        this.putJob(job);
        return this.book(job.bookId);
      }
      assert(
        ["write", "continue", "polish", "outline", "style"].includes(job.kind),
        "该结果需单独审核",
      );
      if (job.kind === "style") {
        const book = this.rawBook(job.bookId);
        assert(
          book.style === job.baseStyle && book.reference === job.baseReference,
          "生成后风格或参考文章已修改，请复制结果手动合并",
        );
        this.updateBook(job.bookId, { style: job.output });
      } else
        this.updateChapter(
          c.id,
          job.kind === "outline"
            ? { outline: job.output }
            : {
                body:
                  mode === "append"
                    ? `${c.body}${c.body ? "\n\n" : ""}${job.output}`
                    : job.output,
              },
          c.revision,
          "采用 AI 候选前快照",
        );
      job.adopted = true;
      this.putJob(job);
      return this.book(job.bookId);
    });
  }
  acceptExtraction(jobId) {
    const job = this.job(jobId);
    assert(
      job.kind === "memory" && job.status === "done" && !job.adopted,
      "该记忆结果无法重复采用",
    );
    const c = this.chapter(job.chapterId);
    assert(
      !c.deletedAt && !this.rawBook(c.bookId).deletedAt,
      "请先从回收站恢复章节和作品",
    );
    assert(
      c.status === "final" && c.revision === job.baseRevision,
      "来源正文已变化或尚未定稿，请重新提取",
    );
    const value = JSON.parse(
      job.output.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""),
    );
    assert(
      Array.isArray(value.memories) && value.memories.length <= 30,
      "模型未返回有效的 memories 数组，请重新提取",
    );
    return this.transaction(() => {
      for (const m of value.memories)
        this.addMemory(job.bookId, { ...m, sourceChapterId: c.id });
      job.adopted = true;
      this.putJob(job);
      return this.book(job.bookId);
    });
  }
  config() {
    const row = this.db
      .prepare("SELECT data FROM config WHERE id=?")
      .get("model");
    return row
      ? JSON.parse(row.data)
      : {
          baseUrl: "https://api.openai.com/v1",
          model: "",
          temperature: 0.8,
          maxTokens: 4096,
          encryptedKey: "",
        };
  }
  setConfig(config) {
    this.db
      .prepare("INSERT OR REPLACE INTO config VALUES (?,?)")
      .run("model", JSON.stringify(config));
  }
  backup() {
    return {
      format: "xingmiao-backup",
      version: 1,
      createdAt: now(),
      books: this.list(true).map((b) => this.book(b.id, true)),
      skills: this.skills(),
      trash: this.trash(),
      canvasViews: this.canvasViews(),
      versions: this.db
        .prepare("SELECT data FROM versions")
        .all()
        .map((r) => JSON.parse(r.data)),
    };
  }
}
require("./extensions.cjs").extendStore(Store);
require("./timeline.cjs").installTimeline(Store);
require("./canvas.cjs").installCanvas(Store);
module.exports = { Store, assert, text, id, now };
