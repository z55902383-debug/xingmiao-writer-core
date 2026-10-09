const { randomUUID } = require("node:crypto");
const stamp = () => new Date().toISOString();
const str = (v, max = Infinity) => {
  if (typeof v !== "string" || v.length > max)
    throw Error("文本格式不正确或过长");
  return v.trim();
};
const check = (ok, msg) => {
  if (!ok) throw Error(msg);
};
function eventKey(e) {
  return JSON.stringify([
    e.kind,
    e.kind === "world" ? e.entity : e.characterId,
    e.kind === "relation" ? e.targetId : "",
    e.attribute,
  ]);
}
function resolveTimeline(book, chapterId, includeCurrent = true) {
  const chapters = book.chapters || [],
    at = chapters.find((c) => c.id === chapterId);
  const cutoff = chapterId ? (at?.order ?? -1) : 0;
  const events = (book.timeline || [])
    .map((e) => {
      const c = chapters.find((c) => c.id === e.chapterId);
      let state = "active";
      if (e.phase === "planned") state = "planned";
      else if (
        e.stale ||
        (e.kind !== "world" &&
          (!book.characters.some((p) => p.id === e.characterId) ||
            (e.kind === "relation" &&
              !book.characters.some((p) => p.id === e.targetId))))
      )
        state = "stale";
      else if (
        e.chapterId &&
        (!c || c.status !== "final" || c.revision !== e.sourceRevision)
      )
        state = "stale";
      else if (
        e.chapterId &&
        (includeCurrent ? c.order > cutoff : c.order >= cutoff)
      )
        state = "future";
      return {
        ...e,
        state,
        order: c?.order || 0,
        chapterTitle: c?.title || (e.chapterId ? "来源章已删除" : "故事开始前"),
      };
    })
    .sort(
      (a, b) =>
        a.order - b.order ||
        a.sequence - b.sequence ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const latest = new Map();
  for (const e of events) if (e.state === "active") latest.set(eventKey(e), e);
  const effective = [...latest.values()];
  return {
    events: events.map((e) => ({
      ...e,
      state:
        e.state === "active" && latest.get(eventKey(e))?.id !== e.id
          ? "superseded"
          : e.state,
    })),
    world: effective.filter((e) => e.kind === "world"),
    characters: effective.filter((e) => e.kind === "character"),
    relations: effective.filter((e) => e.kind === "relation"),
    cutoff,
  };
}
function installTimeline(Store) {
  Object.assign(Store.prototype, {
    saveEvent(bookId, input) {
      const b = this.rawBook(bookId);
      check(!b.deletedAt, "请先恢复作品");
      const all = b.timeline || [];
      const old = all.find((e) => e.id === input.id);
      check(all.length < 2000 || old, "每本书最多 2000 条时间线记录");
      check(
        ["world", "character", "relation"].includes(input.kind),
        "请选择变化类型",
      );
      const chapterId = input.chapterId || "";
      const c = chapterId
        ? this.chapters(bookId).find((c) => c.id === chapterId)
        : null;
      check(!chapterId || c, "生效章节必须属于本书");
      const phase = input.phase === "planned" ? "planned" : "confirmed";
      check(
        phase !== "confirmed" || !c || c.status === "final",
        "确认变化前，请先将来源章节定稿；尚未发生的变化请保存为计划",
      );
      const e = {
        id: old?.id || randomUUID(),
        kind: input.kind,
        title: str(input.title, 160),
        entity: str(input.entity || "", 120),
        characterId: str(input.characterId || "", 100),
        targetId: str(input.targetId || "", 100),
        attribute: str(input.attribute || "状态", 100),
        value: str(input.value),
        chapterId,
        phase,
        sourceRevision: c?.revision || 0,
        stale: false,
        sequence: Math.max(1, Math.min(999, Number(input.sequence) || 1)),
        storyTime: str(input.storyTime || "", 120),
        evidence: str(input.evidence || ""),
        createdAt: old?.createdAt || stamp(),
        updatedAt: stamp(),
      };
      if (e.kind === "world") {
        e.characterId = "";
        e.targetId = "";
      } else {
        e.entity = "";
        if (e.kind === "character") e.targetId = "";
      }
      check(
        e.title && e.value && e.attribute,
        "请填写事件标题、变化维度和变化后的状态",
      );
      if (e.kind === "world") check(e.entity, "请填写变化对象，例如北境或王国");
      else {
        check(
          b.characters.some((p) => p.id === e.characterId),
          "请选择本书人物",
        );
        if (e.kind === "relation")
          check(
            e.targetId !== e.characterId &&
              b.characters.some((p) => p.id === e.targetId),
            "请选择另一个关系人物",
          );
      }
      if (e.evidence && c && phase === "confirmed")
        check(c.body.includes(e.evidence), "证据须为来源章节中的连续原文");
      b.timeline = old ? all.map((x) => (x.id === e.id ? e : x)) : [...all, e];
      this.putBook(b);
      return this.book(bookId);
    },
    deleteEvent(bookId, eventId) {
      return this.transaction(() => {
        const b = this.rawBook(bookId),
          e = (b.timeline || []).find((e) => e.id === eventId);
        check(e, "时间线记录不存在");
        this.recycle("timeline", bookId, e);
        b.timeline = b.timeline.filter((x) => x.id !== eventId);
        this.putBook(b);
        return this.book(bookId);
      });
    },
    saveVolume(bookId, input) {
      const b = this.rawBook(bookId);
      check(!b.deletedAt, "请先恢复作品");
      const all = b.volumes || [],
        old = all.find((v) => v.id === input.id);
      check(all.length < 100 || old, "最多 100 卷");
      const v = {
        id: old?.id || randomUUID(),
        title: str(input.title, 160),
        outline: str(input.outline || ""),
        detail: str(input.detail || ""),
      };
      check(v.title, "请填写卷名");
      b.volumes = old ? all.map((x) => (x.id === v.id ? v : x)) : [...all, v];
      this.putBook(b);
      return this.book(bookId);
    },
    deleteVolume(bookId, volumeId) {
      return this.transaction(() => {
        const b = this.rawBook(bookId),
          v = (b.volumes || []).find((v) => v.id === volumeId);
        check(v, "分卷不存在");
        this.recycle("volume", bookId, {
          ...v,
          chapterIds: this.chapters(bookId, true)
            .filter((c) => c.volumeId === volumeId)
            .map((c) => c.id),
        });
        b.volumes = b.volumes.filter((x) => x.id !== volumeId);
        for (const c of this.chapters(bookId, true))
          if (c.volumeId === volumeId) {
            c.volumeId = "";
            this.putChapter(c);
          }
        this.putBook(b);
        return this.book(bookId);
      });
    },
    organizeChapter(chapterId, input) {
      const c = this.chapter(chapterId),
        b = this.rawBook(c.bookId);
      check(!c.deletedAt && !b.deletedAt, "请先恢复章节和作品");
      if ("volumeId" in input) {
        check(
          !input.volumeId ||
            (b.volumes || []).some((v) => v.id === input.volumeId),
          "分卷不属于本书",
        );
        c.volumeId = input.volumeId || "";
      }
      if ("targetWords" in input) {
        const n = Number(input.targetWords);
        check(
          Number.isInteger(n) && (n === 0 || (n >= 100 && n <= 20000)),
          "目标字数应为 100–20000，0 表示使用全书默认",
        );
        c.targetWords = n;
      }
      this.putChapter(c);
      return this.book(b.id);
    },
  });
}
function contextSignature(book, chapter) {
  return require("node:crypto")
    .createHash("sha256")
    .update(
      JSON.stringify([
        book.title,
        book.premise,
        book.outline,
        book.world,
          require("./writing-profiles.cjs").contextValue(book),
        book.characters,
        book.worldRecords || [],
        book.foreshadows || [],
        book.memories,
        book.timeline || [],
        book.volumes || [],
        book.chapterTargetWords || 2000,
        book.contextChapters ?? 2,
        (book.chapters || []).filter(c=>c.order < chapter.order).map(c=>[c.id,c.revision,c.status,c.order]),
        chapter.volumeId || "",
        chapter.targetWords || 0,
      ]),
    )
    .digest("hex");
}
module.exports = {
  resolveTimeline,
  eventKey,
  installTimeline,
  contextSignature,
};
