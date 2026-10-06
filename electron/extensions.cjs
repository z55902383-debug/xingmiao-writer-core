const { randomUUID } = require("node:crypto");
const stamp = () => new Date().toISOString();
const { parse, stringify } = require("yaml");
const KINDS = [
  "write",
  "continue",
  "polish",
  "outline",
  "memory",
  "check",
  "style",
  ...Object.keys(require("./planning.cjs").tasks),
];
function validText(v, max = Infinity) {
  if (typeof v !== "string" || v.length > max)
    throw Error("内容格式不正确或超过长度限制");
  return v;
}
function requireValue(v, message) {
  if (!v) throw Error(message);
}
function parseSkill(markdown, source = "导入文件") {
  validText(markdown);
  let meta = {},
    body = markdown;
  const match = markdown
    .replace(/^\uFEFF/, "")
    .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (match) {
    meta = parse(match[1], { maxAliasCount: 0 }) || {};
    body = markdown.replace(/^\uFEFF/, "").slice(match[0].length);
  }
  return {
    name:
      typeof meta.name === "string" ? meta.name : source.replace(/\.md$/i, ""),
    description: typeof meta.description === "string" ? meta.description : "",
    body: body.trim(),
    tasks: Array.isArray(meta.tasks) ? meta.tasks : KINDS,
    enabled: false,
    source,
  };
}
function exportSkill(skill) {
  return `---\n${stringify({ name: skill.name, description: skill.description, tasks: skill.tasks })}---\n\n${skill.body}\n`;
}
function extendStore(Store) {
  Object.assign(Store.prototype, {
    setting(key, fallback) {
      const row = this.db
        .prepare("SELECT data FROM config WHERE id=?")
        .get(key);
      return row ? JSON.parse(row.data) : fallback;
    },
    putSetting(key, value) {
      this.db
        .prepare(
          "INSERT INTO config VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(key, JSON.stringify(value));
      return value;
    },
    profiles() {
      let state = this.setting("model-profiles", null);
      if (!state) {
        const old = this.setting("model", {});
        state = {
          activeId: "default",
          items: [
            {
              profileId: "default",
              name: "默认模型",
              provider: "api",
              baseUrl: "https://api.openai.com/v1",
              model: "",
              temperature: 0.8,
              maxTokens: 4096,
              encryptedKey: "",
              ...old,
            },
          ],
        };
        this.putSetting("model-profiles", state);
      }
      return state;
    },
    config() {
      const state = this.profiles();
      return (
        state.items.find((p) => p.profileId === state.activeId) ||
        state.items[0]
      );
    },
    setConfig(value) {
      const state = this.profiles();
      const profileId = value.profileId || state.activeId;
      const old = state.items.find((p) => p.profileId === profileId) || {};
      const next = { ...old, ...value, profileId };
      if (state.items.some((p) => p.profileId === profileId))
        state.items = state.items.map((p) =>
          p.profileId === profileId ? next : p,
        );
      else {
        requireValue(state.items.length < 30, "最多保存 30 个模型配置");
        state.items.push(next);
      }
      state.activeId = profileId;
      this.putSetting("model-profiles", state);
      return next;
    },
    selectProfile(profileId) {
      const state = this.profiles();
      requireValue(
        state.items.some((p) => p.profileId === profileId),
        "模型配置不存在",
      );
      state.activeId = profileId;
      this.putSetting("model-profiles", state);
    },
    deleteProfile(profileId) {
      const state = this.profiles();
      requireValue(state.items.length > 1, "请至少保留一个模型配置");
      requireValue(
        state.items.some((p) => p.profileId === profileId),
        "模型配置不存在",
      );
      state.items = state.items.filter((p) => p.profileId !== profileId);
      if (state.activeId === profileId)
        state.activeId = state.items[0].profileId;
      this.putSetting("model-profiles", state);
    },
    skills() {
      return this.setting("writing-skills", []);
    },
    saveSkill(input) {
      const all = this.skills(),
        old = all.find((s) => s.id === input.id);
      const name = validText(input.name, 100).trim(),
        body = validText(input.body).trim();
      requireValue(name && body, "请填写 Skill 名称和指令内容");
      const tasks = (input.tasks || KINDS).filter((k) => KINDS.includes(k));
      requireValue(tasks.length, "至少选择一种写作任务");
      requireValue(all.length < 100 || old, "最多保存 100 个 Skill");
      const s = {
        id: old?.id || randomUUID(),
        name,
        description: validText(input.description || "", 1000),
        body,
        tasks: [...new Set(tasks)],
        enabled: !!input.enabled,
        source: old?.source || validText(input.source || "手动创建", 200),
        version: old ? old.version + 1 : 1,
        updatedAt: stamp(),
      };
      this.putSetting(
        "writing-skills",
        old ? all.map((x) => (x.id === s.id ? s : x)) : [...all, s],
      );
      return s;
    },
    deleteSkill(id) {
      const all = this.skills();
      requireValue(
        all.some((s) => s.id === id),
        "Skill 不存在",
      );
      this.putSetting(
        "writing-skills",
        all.filter((s) => s.id !== id),
      );
    },
    initSkills() {
      if (this.setting("writing-skills", null) !== null) return;
      for (const skill of [
        {
          name: "场景与冲突",
          description: "用具体目标和阻碍推进场景，避免空泛铺陈。",
          tasks: ["write", "continue", "outline"],
          body: "每个场景明确人物的当下目标、阻碍与代价。通过行动和对话推进冲突。结尾产生一个新的选择或尚未解决的问题。不得改变作者已确认的人物和世界设定。",
        },
        {
          name: "人物连续性",
          description: "核对人物关系、知情范围、状态与物品归属。",
          tasks: ["write", "continue", "check", "memory"],
          body: "区分角色知道的事情与读者知道的事情。遵守关系变化的时间顺序，核对人物状态和物品归属。只有原文支持的事实才可提取为记忆，信息不足则明确说明。",
        },
        {
          name: "自然叙事",
          description: "减少套话，用动作、细节与对白呈现人物。",
          tasks: ["write", "continue", "polish"],
          body: "优先选择具体动作与可感知细节，减少概括性评价和重复解释。对白符合人物身份，避免所有角色使用同一种语气。不靠堆叠形容词制造情绪。尊重本书的风格档案。",
        },
      ])
        this.saveSkill({ ...skill, enabled: false, source: "星喵内置" });
    },
    trash() {
      return this.setting("recycle-bin", []);
    },
    recycle(type, bookId, item) {
      const entry = {
        id: randomUUID(),
        type,
        bookId,
        title: item.title || item.name || item.subject || "资料",
        deletedAt: stamp(),
        item,
      };
      this.putSetting("recycle-bin", [entry, ...this.trash()]);
      return entry;
    },
    deleteBook(bookId) {
      return this.transaction(() => {
        const b = this.rawBook(bookId);
        requireValue(!b.deletedAt, "作品已经在回收站");
        b.deletedAt = stamp();
        this.putBook(b);
        return this.recycle("book", bookId, { title: b.title });
      });
    },
    deleteChapter(chapterId) {
      return this.transaction(() => {
        const c = this.chapter(chapterId),
          b = this.rawBook(c.bookId);
        requireValue(!c.deletedAt, "章节已经在回收站");
        this.invalidate(b, c);
        c.deletedAt = stamp();
        this.putChapter(c);
        this.putBook(b);
        return this.recycle("chapter", b.id, { id: c.id, title: c.title });
      });
    },
    duplicateChapter(chapterId) {
      return this.transaction(() => {
        const c = this.chapter(chapterId);
        requireValue(!c.deletedAt, "无法复制已删除章节");
        const copy = this.createChapter(
          c.bookId,
          c.title.slice(0, 150) + "（副本）",
        );
        this.organizeChapter(copy.id, {
          volumeId: c.volumeId || "",
          targetWords: c.targetWords || 0,
        });
        return this.updateChapter(
          copy.id,
          { body: c.body, outline: c.outline, summary: c.summary || "" },
          copy.revision,
          "复制章节",
        );
      });
    },
    deleteCharacter(bookId, characterId) {
      return this.transaction(() => {
        const b = this.rawBook(bookId),
          c = b.characters.find((c) => c.id === characterId);
        requireValue(c, "人物不存在");
        this.recycle("character", bookId, c);
        b.characters = b.characters.filter((c) => c.id !== characterId);
        this.putBook(b);
        return this.book(bookId);
      });
    },
    clearReference(bookId) {
      return this.transaction(() => {
        const b = this.rawBook(bookId);
        requireValue(b.reference, "没有参考文章");
        this.recycle("reference", bookId, {
          name: b.referenceName,
          body: b.reference,
        });
        b.reference = "";
        b.referenceName = "";
        this.putBook(b);
        return this.book(bookId);
      });
    },
    restoreTrash(entryId) {
      return this.transaction(() => {
        const entry = this.trash().find((e) => e.id === entryId);
        requireValue(entry, "回收记录不存在");
        const b = this.rawBook(entry.bookId);
        if (entry.type !== "book")
          requireValue(!b.deletedAt, "请先恢复所属作品");
        if (entry.type === "book") {
          delete b.deletedAt;
          this.putBook(b);
        } else if (entry.type === "chapter") {
          const c = this.chapter(entry.item.id);
          delete c.deletedAt;
          this.invalidate(b, c);
          this.putChapter(c);
          this.putBook(b);
        } else if (entry.type === "planning") {
          const item = entry.item;
          requireValue(
            ["outline", "world", "detail"].includes(item.field),
            "恢复字段无效",
          );
          if (item.volumeId) {
            const v = (b.volumes || []).find((v) => v.id === item.volumeId);
            requireValue(v, "请先恢复所属分卷");
            this.recycle("planning", b.id, { ...item, value: v[item.field] });
            this.saveVolume(b.id, { ...v, [item.field]: item.value });
          } else {
            requireValue(
              ["outline", "world"].includes(item.field),
              "恢复字段无效",
            );
            this.recycle("planning", b.id, { ...item, value: b[item.field] });
            this.updateBook(b.id, { [item.field]: item.value });
          }
        } else if (entry.type === "timeline") {
          b.timeline = [
            ...(b.timeline || []),
            { ...entry.item, phase: "planned" },
          ];
          this.putBook(b);
        } else if (entry.type === "volume") {
          const { chapterIds, ...volume } = entry.item;
          b.volumes = [...(b.volumes || []), volume];
          this.putBook(b);
          for (const cid of chapterIds || []) {
            const c = this.chapter(cid);
            if (c.bookId === b.id && !c.volumeId) {
              c.volumeId = volume.id;
              this.putChapter(c);
            }
          }
        } else if (entry.type === "character") {
          if (!b.characters.some((c) => c.id === entry.item.id))
            b.characters.push(entry.item);
          this.putBook(b);
        } else if (entry.type === "memory") {
          b.memories.push({
            ...entry.item,
            stale: !!entry.item.sourceChapterId,
          });
          this.putBook(b);
        } else if (entry.type === "reference") {
          requireValue(
            !b.reference,
            "当前已有参考文章，请先移除后再恢复旧文章",
          );
          b.reference = entry.item.body;
          b.referenceName = entry.item.name;
          this.putBook(b);
        }
        this.putSetting(
          "recycle-bin",
          this.trash().filter((e) => e.id !== entryId),
        );
        return entry;
      });
    },
  });
}
module.exports = { extendStore, parseSkill, exportSkill, KINDS };
