const { randomUUID } = require("node:crypto");
const stamp = () => new Date().toISOString();
const { parse, stringify } = require("yaml");
const creativeTags = require('./creative-tags.cjs');
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
  const toolTags = creativeTags.normalize(meta.toolTags ?? (Array.isArray(meta.tasks) ? meta.tasks.filter(t => !KINDS.includes(t)) : []));
  return {
    name:
      typeof meta.name === "string" ? meta.name : source.replace(/\.md$/i, ""),
    description: typeof meta.description === "string" ? meta.description : "",
    body: body.trim(),
    tasks: Array.isArray(meta.tasks) ? meta.tasks : KINDS,
    toolTags,
    toolTagsMode: meta.toolTagsMode === 'auto' ? 'auto' : Array.isArray(meta.toolTags) || toolTags.length || meta.toolTagsMode === 'explicit' ? 'explicit' : 'auto',
    enabled: false,
    source,
  };
}
function exportSkill(skill) {
  return `---\n${stringify({ name: skill.name, description: skill.description, tasks: skill.tasks, ...(skill.toolTagsMode === 'auto' ? { toolTagsMode: 'auto' } : skill.toolTags ? { toolTags: skill.toolTags, toolTagsMode: 'explicit' } : {}) })}---\n\n${skill.body}\n`;
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
      if (!this.syncingInstructionRegistry) {
        this.syncingInstructionRegistry = true;
        try { require('./instruction-registry.cjs').reconcile(this); } finally { this.syncingInstructionRegistry = false; }
      }
      const plaza = this.setting('plaza-items', []);
      return this.setting("writing-skills", []).filter(skill => !plaza.some(item => item.installedSkillId === skill.id && !item.installed)).map(skill => ({
        ...skill,
        tasks: require('./instruction-registry.cjs').tasksFor(skill, creativeTags.skillTags(skill, plaza.filter(item => item.installed && item.installedSkillId === skill.id).flatMap(item => item.tasks || []))).filter(task => KINDS.includes(task)),
        instructionKind: plaza.find(item => item.installedSkillId === skill.id)?.kind || 'skill',
        plazaItemId: plaza.find(item => item.installedSkillId === skill.id)?.id,
        toolTags: creativeTags.skillTags(skill, plaza.filter(item => item.installed && item.installedSkillId === skill.id).flatMap(item => item.tasks || [])),
        toolTagsMode: skill.toolTagsMode || (creativeTags.normalize(skill.toolTags).length ? 'explicit' : 'auto'),
      }));
    },
    saveSkill(input) {
      const effective = this.skills();
      const all = this.setting('writing-skills', []),
        old = all.find((s) => s.id === input.id);
      const current = effective.find(s => s.id === input.id);
      const name = validText(input.name, 120).trim(),
        body = validText(input.body).trim();
      requireValue(name && body, "请填写 Skill 名称和指令内容");
      const suppliedTasks = old && JSON.stringify(input.tasks) === JSON.stringify(current?.tasks) ? old.tasks : input.tasks;
      const tasks = (suppliedTasks || KINDS).filter((k) => KINDS.includes(k));
      const changedTags = input.toolTags !== undefined && JSON.stringify(creativeTags.normalize(input.toolTags)) !== JSON.stringify(current?.toolTags || []);
      const toolTagsMode = input.toolTagsMode || (changedTags ? 'explicit' : old?.toolTagsMode || (input.toolTags !== undefined ? 'explicit' : 'auto'));
      requireValue(['auto', 'explicit'].includes(toolTagsMode), '工具箱标签模式不正确');
      const toolTags = toolTagsMode === 'auto' ? [] : creativeTags.normalize(input.toolTags ?? old?.toolTags);
      requireValue(tasks.length || toolTags.length, "至少选择一种写作任务或工具箱标签");
      requireValue(all.length < 1000 || old, "最多保存 1000 项指令");
      const s = {
        id: old?.id || randomUUID(),
        name,
        description: validText(input.description || "", 1000),
        body,
        tasks: [...new Set(tasks)],
        toolTags,
        toolTagsMode,
        enabled: !!input.enabled,
        source: old?.source || validText(input.source || "手动创建", 200),
        version: old ? old.version + 1 : 1,
        updatedAt: stamp(),
      };
      this.putSetting(
        "writing-skills",
        old ? all.map((x) => (x.id === s.id ? s : x)) : [...all, s],
      );
      return this.skills().find(skill => skill.id === s.id);
    },
    deleteSkill(id) {
      const all = this.setting('writing-skills', []);
      requireValue(
        all.some((s) => s.id === id),
        "Skill 不存在",
      );
      const plaza = this.setting('plaza-items', []);
      for (const item of plaza) if (item.installedSkillId === id) { item.installed = false; item.installedSkillId = ''; }
      this.putSetting('plaza-items', plaza);
      this.putSetting(
        "writing-skills",
        all.filter((s) => s.id !== id),
      );
    },
    initSkills() {
      const builtins = require("./builtin-writing-skills.cjs");
      if (this.setting("builtin-writing-skills-revision", 0) >= builtins.revision) return;
      return this.transaction(() => {
        const fresh = this.setting("writing-skills", null) === null;
        for (const skill of builtins.items) {
          const all = this.setting('writing-skills', []);
          const existing = all.find(item => item.name === skill.name);
          const previous = builtins.previous.find(item => item.name === skill.name);
          if (existing) {
            // Preserve authored edits, custom imports and enablement. Only exact
            // untouched previous defaults can be upgraded in place.
            if (previous && existing.source === "星喵内置" &&
              existing.body === previous.body && existing.description === previous.description &&
              JSON.stringify(existing.tasks) === JSON.stringify(previous.tasks))
              this.saveSkill({ ...existing, ...skill, enabled: existing.enabled });
          } else if ((fresh || !previous) && all.length < 100) {
            this.saveSkill({ ...skill, enabled: false, source: "星喵内置" });
          }
        }
        // Do not recreate defaults removed by the author on later startups.
        this.putSetting("builtin-writing-skills-revision", builtins.revision);
      });
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
            ["title", "outline", "world", "detail"].includes(item.field),
            "恢复字段无效",
          );
          if (item.volumeId) {
            const v = (b.volumes || []).find((v) => v.id === item.volumeId);
            requireValue(v, "请先恢复所属分卷");
            this.recycle("planning", b.id, { ...item, value: v[item.field] });
            this.saveVolume(b.id, { ...v, [item.field]: item.value });
          } else {
            requireValue(
              ["title", "outline", "world"].includes(item.field),
              "恢复字段无效",
            );
            this.recycle("planning", b.id, { ...item, value: b[item.field] });
            this.updateBook(b.id, { [item.field]: item.value });
          }
        } else if (entry.type === "timeline") {
          if (!(b.timeline || []).some(row => row.id === entry.item.id)) b.timeline = [
            ...(b.timeline || []),
            { ...entry.item, phase: "planned" },
          ];
          this.putBook(b);
        } else if (entry.type === "volume") {
          const { chapterIds, chapterPlanPositions, ...volume } = entry.item;
          b.volumes = [...(b.volumes || []), volume];
          this.putBook(b);
          for (const cid of chapterIds || []) {
            const c = this.chapter(cid);
            if (c.bookId === b.id && !c.volumeId) {
              c.volumeId = volume.id;
              const position=chapterPlanPositions?.[cid];
              if (Number.isInteger(position) && position>=1 && position<=200) c.volumePlanIndex=position;
              this.putChapter(c);
            }
          }
        } else if (entry.type === "character") {
          if (!b.characters.some((c) => c.id === entry.item.id))
            b.characters.push(entry.item);
          this.putBook(b);
        } else if (entry.type === "memory") {
          if (!b.memories.some(row => row.id === entry.item.id)) b.memories.push({
            ...entry.item,
            stale: !!entry.item.sourceChapterId,
          });
          this.putBook(b);
        } else if (entry.type === "worldRecord" || entry.type === "foreshadow") {
          const field = entry.type === "worldRecord" ? "worldRecords" : "foreshadows";
          b[field] ||= [];
          if (!b[field].some(row => row.id === entry.item.id)) b[field].push(entry.item);
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
