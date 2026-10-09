const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  shell,
  clipboard,
} = require("electron");
const { join, basename } = require("node:path");
const fs = require("node:fs/promises");
const { Store, assert, text, id, now } = require("./store.cjs");
const { buildContext } = require("./context.cjs");
const { normalizeManuscriptFormat, isProseKind, formatJobOutput, candidateManuscriptBody } = require("./manuscript-format.mjs");

const { requestModel, endpoint } = require("./ai.cjs");
const { requestCodex, inspectCodex } = require("./codex.cjs");
const { settingsActions, closeLogin } = require("./settings-actions.cjs");


app.setName("星喵写作开源版");
app.setPath("userData", join(app.getPath("appData"), app.getName()));

// 自定义协议：飞书登录完成后，后端 302 回 xingmiao://auth?token=... 唤起本应用。

// 数据目录必须在 whenReady 之前定下来：环境变量 > 用户自定义指针 > 默认目录。
const { resolveDataDir, dataDirActions } = require("./data-dir.cjs");
const dataDir = resolveDataDir();
let store,
  win,
  closing = false,
  preparing = false;
const running = new Map();
const jobPromises = new Map();
const manualBrainstorm = require("./manual-brainstorm.cjs").createManualBrainstorm({
  getBook: (bookId) => store.rawBook(text(bookId, 100)),
  getConfig: () => store.config(),
  getKey: keyFor,
  requestModel,
  requestCodex,
  emit: (state) => {
    if (win && !win.isDestroyed()) win.webContents.send("xm:brainstorm", state);
  },
});



if (!process.env.XM_TEST && !app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { win.restore(); win.show(); win.focus(); } });
const publicConfig = () => {
  const { encryptedKey, ...rest } = store.config();
  return {
    ...rest,
    hasKey: !!encryptedKey,
    dataPath: app.getPath("userData"),
    dataPathSource: dataDir.source,
    profiles: store.profiles().items.map(({ encryptedKey, ...p }) => ({
      ...p,
      hasKey: !!encryptedKey,
    })),
  };
};
async function keyFor(config) {
  return config.encryptedKey
    ? (
        await safeStorage.decryptStringAsync(
          Buffer.from(config.encryptedKey, "base64"))
      ).result
    : "";
}




async function saveConfig(input) {
  const provider = input.provider === "codex" ? "codex" : "api";
  if (provider === "api") endpoint(text(input.baseUrl, 1000));
  const profileId =
    input.profileId === null
      ? id()
      : input.profileId || store.config().profileId;
  const old =
    store.profiles().items.find((p) => p.profileId === profileId) || {};
  let encryptedKey = old.encryptedKey;
  if (input.clearKey) encryptedKey = "";
  if (input.apiKey)
    encryptedKey = (
      await safeStorage.encryptStringAsync(text(input.apiKey, 4096))
    ).toString("base64");
  store.setConfig({
    profileId,
    provider,
    name: text(
      input.name ||
        input.model ||
        (provider === "codex" ? "Codex" : "默认模型"),
      100),
    cliPath: text(input.cliPath || "", 1000),
    baseUrl: (input.baseUrl || "").trim(),
    model: text(input.model || "", 200).trim(),
    temperature:
      input.temperature === null
        ? null
        : Math.min(2, Math.max(0, Number(input.temperature) || 0)),
    maxTokens: Math.min(32768, Math.max(256, Number(input.maxTokens) || 4096)),
    tokenParam:
      input.tokenParam === "max_completion_tokens"
        ? "max_completion_tokens"
        : "max_tokens",
    encryptedKey,
  });
  return publicConfig();
}
async function saveFile(defaultPath, content, extension) {
  const result = await dialog.showSaveDialog(win, {
    defaultPath,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, content, "utf8");
  return result.filePath;
}
function emit(job) {
  if (win && !win.isDestroyed()) win.webContents.send("xm:job", job);
}
async function generate(input) {
  assert(
    running.size === 0 && !preparing,
    "已有生成任务正在进行，请等待完成或停止",
  );
  preparing = true;
  try {
    const book = store.book(input.bookId);
    assert(!book.deletedAt, "请先从回收站恢复作品");
    const chapter = book.chapters.find((c) => c.id === input.chapterId);
    assert(chapter, "章节不属于当前书籍");
    const manuscriptFormat = normalizeManuscriptFormat(store.setting("manuscript-formatting", {}));
    const context = buildContext(
      book,
      chapter,
      input.kind,
      text(input.instruction || ""),
      store.skills(),
      { volumeId: input.targetVolumeId, chapterIds: input.contextChapterIds, manuscriptFormat },
    );
    const config = store.config();
    assert(config.model || config.provider === "codex", "请先配置模型");
    const key = config.provider === "codex" ? "" : await keyFor(config);
    const job = {
      id: id(),
      bookId: book.id,
      chapterId: chapter.id,
      baseRevision: chapter.revision,
      ...(require("./planning-routes.cjs").routedKinds.includes(input.kind)
        ? { planningSignature: require("./planning-routes.cjs").planningSignature(book) } : {}),
      contextSignature: require("./timeline.cjs").contextSignature(
        book,
        chapter,
      ),
      model: config.model || "Codex 默认模型",
      provider: config.provider || "api",
      profileName: config.name || "默认模型",
      ...(input.kind === "style"
        ? { baseStyle: book.style, baseReference: book.reference }
        : {}),
      kind: input.kind,
      ...(isProseKind(input.kind) ? { manuscriptFormat } : {}),
      targetVolumeId: input.targetVolumeId || "",
      targetLabel: input.targetVolumeId
        ? (book.volumes || []).find((v) => v.id === input.targetVolumeId)?.title
        : ["write", "continue", "polish", "summary", "outline", "memory", "check"].includes(input.kind) ? chapter.title : book.title,
      instruction: input.instruction || "",
      output: "",
      status: "running",
      createdAt: now(),
      adopted: false,
      context: { ...context, messages: undefined },
      error: "",
    };
    store.putJob(job);
    const controller = new AbortController();
    running.set(job.id, controller);
    let lastSave = Date.now(),
      lastEmit = 0;
    const execution = (async () => {
      try {
        const result = await (
          config.provider === "codex" ? requestCodex : requestModel
        )(
          config,
          key,
          context.messages,
          (chunk) => {
            job.output += chunk;
            if (Date.now() - lastEmit > 70) {
              emit(job);
              lastEmit = Date.now();
            }
            if (Date.now() - lastSave > 700) {
              store.putJob(job);
              lastSave = Date.now();
            }
          },
          controller.signal,
        );
        assert(
          job.output.trim(),
          "模型未返回正文，可能只返回了推理内容；请增加输出上限或更换模型",
        );
        job.status = "done";
        job.usage = result.usage;
        if (result.finishReason === "length") {
          job.status = "interrupted";
          job.error = "达到输出长度上限，内容可能未完成；可保留后续写。";
        }
        job.output = formatJobOutput(job);
        if (
          job.status === "done" &&
          ["write", "continue", "polish"].includes(job.kind)
        ) {
          job.review = { status: "analyzing" };
          store.putJob(job);
          emit(job);
          try {
            const body = candidateManuscriptBody(chapter.body, job, job.kind === "continue" ? "append" : "replace");
            const sync = require("./sync-review.cjs");
            let raw = "";
            const result = await (
              config.provider === "codex" ? requestCodex : requestModel
            )(
              config,
              key,
              sync.messages(book, chapter, body),
              (chunk) => {
                raw += chunk;
              },
              controller.signal,
            );
            if (result.finishReason === "length")
              throw Error("分析未完成，请重试；正文已保留");
            const changes = sync.parse(raw, body);
            job.review = {
              status: changes.length ? "ready" : "empty",
              changes,
              bodyHash: sync.hash(body),
            };
          } catch (e) {
            job.review = {
              status: "error",
              error: controller.signal.aborted
                ? "已停止分析，正文已保留"
                : e.message,
            };
          }
        }
      } catch (e) {
        job.status = controller.signal.aborted ? "cancelled" : "error";
        job.error = controller.signal.aborted
          ? "已停止，生成内容已保留。"
          : e.message;
      } finally {
        // Partial prose remains usable after interruption, cancellation or error.
        job.output = formatJobOutput(job);
        store.putJob(job);
        running.delete(job.id);
        jobPromises.delete(job.id);
        emit(job);
      }
    })();
    jobPromises.set(job.id, execution);
    return job;
  } finally {
    preparing = false;
  }
}
const creativeToolNames = {
  cover: "封面生成器",
  brainstorm: "脑洞生成器",
  bookName: "书名生成器",
  nameTest: "书名测试",
  intro: "简介生成器",
  outline: "大纲生成器",
  detail: "细纲生成器",
  opening: "黄金开篇生成器",
  cheat: "金手指生成器",
  names: "名字生成器",
  character: "人设生成器",
  world: "世界观生成器",
  glossary: "词条生成器",
  matchIdea: "对标脑洞",
  matchName: "对标书名",
  matchIntro: "对标简介",
};
const creativeToolInstructions = {
  brainstorm: "生成 3 个差异明确、能继续写成长篇的故事脑洞。每个方向写：一句话卖点、主角目标、核心冲突、关键转折、后续推进与阶段性悬念。不要把三个方向混成一个故事。",
  bookName: "一次给出 12 个书名，按不同气质分组。每个书名附一句含义或卖点；最后选出最适合当前设定的 3 个并说明理由。避免只替换一两个字的重复标题。",
  nameTest: "对用户给出的书名逐个评估；若只给一个，也要先评估它。按题材匹配、辨识度、记忆度、点击吸引力、剧透风险给 1–10 分和简短理由，最后给综合排序及可改进的备选标题。用表格呈现评分。",
  intro: "写 3 版可直接修改使用的小说简介：清晰卖点版、强悬念版、情绪氛围版。每版控制在约 150–300 字，交代主角、目标、核心阻碍和独特看点，不剧透关键结局，不写分析说明替代简介正文。",
  outline: "输出一份完整、前后连贯的小说故事大纲：核心设定与主题、主角目标和变化、主要人物关系、开端/发展/转折/高潮/结局。把关键因果写清楚，并给出明确结局；用户指定篇幅或结构时严格遵守。",
  detail: "把用户提供的大纲拆成可落笔的章节细纲。按要求的卷、章范围输出；每章包括暂定标题、视角人物、目标、冲突、关键行动或信息、结尾钩子。让章节之间有因果衔接，不重复大纲原句；缺少章节数时先说明采用的合理假设。",
  opening: "直接创作小说开篇正文，不要只给写作建议或提纲。用具体场景、人物行动和正在发生的冲突切入，在开头尽快建立悬念；保持提供的视角和语气，结尾留下推动下一段的疑问或行动。默认约 800–1200 字，用户有字数要求时优先遵守。",
  cheat: "设计一套能推动长篇剧情的核心能力/金手指。依次写：能力规则、明确限制、使用代价、成长阶段、适用场景、容易失控之处、对手的破解方式，以及如何避免能力轻易解决所有冲突。设定要与题材相容。",
  names: "根据时代、地域、题材和身份生成名字清单；默认提供 20 个，并按人物、地点、组织或物件分类（按用户需求调整类别）。每个名字附简短气质或适用场景，注意读音、字形和同一作品中的风格统一。",
  character: "围绕用户指定的人物生成可用于写作的人物档案：身份与外在目标、内在需求、性格优势和缺陷、重要秘密、说话与行动特征、关键关系、人物弧光，以及可用于首次出场的行为细节。若未指定人数，先设计一位核心人物并补充两位关系人物。",
  world: "搭建可用于小说的世界设定，按时代与地理、社会秩序/势力、资源与生活方式、特殊规则（如超自然或科技）、规则限制与代价、会影响主线的矛盾组织。说明设定怎样制造剧情，不要只罗列名词。",
  glossary: "生成一组可直接收录进设定集的词条，默认 10 条并按类别整理。每条包括名称、定义、使用规则或功能、限制/代价、在剧情中的用途；遵循用户已有世界设定，避免同义重复。",
  matchIdea: "提炼用户提供的参考脑洞中抽象的创意机制（如人物关系、冲突来源、信息差和升级节奏），不复述或仿写原作表达、人物和具体情节。再为当前作品给出 3 个有明显差异的原创方案，并说明各自如何适配设定。",
  matchName: "分析参考书名的结构、类型信号、情绪承诺和记忆点，不复制原名的独特表达。结合用户作品卖点给出 10 个原创备选，注明各自的读者预期，并推荐最合适的 3 个。",
  matchIntro: "拆解参考简介的信息顺序、钩子类型、冲突呈现和句式节奏，不照搬其表达。依据用户自己的作品设定，写 3 版原创简介，并简要说明每版突出什么卖点。",
};
async function restoreBackup() {
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "星喵备份", extensions: ["json"] }],
  });
  if (result.canceled) return null;
  const stat = await fs.stat(result.filePaths[0]);
  assert(stat.size < 80 * 1024 * 1024, "备份文件超过 80 MB，暂不支持");
  const data = JSON.parse(await fs.readFile(result.filePaths[0], "utf8"));
  assert(
    data.format === "xingmiao-backup" &&
      data.version === 1 &&
      Array.isArray(data.books),
    "这不是有效的星喵写作备份");
  // Import as new copies. Never overwrite existing books or configuration.
  return store.transaction(() => {
    assert(!data.canvasViews || (Array.isArray(data.canvasViews) && data.canvasViews.length <= 75000), "画布备份格式无效");
    for (const source of data.books) {
      const bookId = id();
      assert(
        (!source.volumes ||
          (Array.isArray(source.volumes) && source.volumes.length <= 100)) &&
          (!source.timeline ||
            (Array.isArray(source.timeline) && source.timeline.length <= 2000)),
        "分卷或时间线备份格式无效");
      assert(Array.isArray(source.chapters) && source.chapters.length <= 5000, "备份章节格式无效");
      assert(!source.worldRecords || (Array.isArray(source.worldRecords) && source.worldRecords.length <= 500), "世界资料备份格式无效");
      assert(!source.foreshadows || (Array.isArray(source.foreshadows) && source.foreshadows.length <= 2000), "伏笔备份格式无效");
      const chapterMap = new Map(source.chapters.map((c) => [c.id, id()]));
      const worldMap = new Map((source.worldRecords || []).map((r) => [r.id, id()]));
      const memoryMap = new Map((source.memories || []).map((m) => [m.id, id()]));
      const eventMap = new Map((source.timeline || []).map((e) => [e.id, id()]));
      const foreshadowMap = new Map((source.foreshadows || []).map((f) => [f.id, id()]));
      const characterMap = new Map(
        (source.characters || []).map((c) => [c.id, id()]));
      for (const entry of data.trash || [])
        if (entry.bookId === source.id && entry.type === "character")
          characterMap.set(entry.item.id, id());
      const volumeMap = new Map(
        (source.volumes || []).map((v) => [v.id, id()]));
      for (const entry of data.trash || [])
        if (entry.bookId === source.id && entry.type === "volume")
          volumeMap.set(entry.item.id, id());
      const restoreEvent = (e) => ({
        id: eventMap.get(e.id) || id(),
        kind: ["world", "character", "relation"].includes(e.kind)
          ? e.kind
          : "world",
        title: text(e.title, 160),
        entity: text(e.entity || "", 120),
        characterId: characterMap.get(e.characterId) || "",
        targetId: characterMap.get(e.targetId) || "",
        attribute: text(e.attribute || "状态", 100),
        value: text(e.value),
        chapterId: chapterMap.get(e.chapterId) || "",
        phase: e.phase === "confirmed" ? "confirmed" : "planned",
        sourceRevision: Number(e.sourceRevision) || 0,
        stale: !!e.stale || (!!e.chapterId && !chapterMap.has(e.chapterId)),
        sequence: Math.min(999, Math.max(1, Number(e.sequence) || 1)),
        storyTime: text(e.storyTime || "", 120),
        evidence: text(e.evidence || ""),
        createdAt: text(e.createdAt || now(), 100),
        updatedAt: now(),
      });
      assert(
        Array.isArray(source.chapters) && source.chapters.length <= 5000,
        "备份章节格式无效");
      const restored = {
        id: bookId,
        title: text(source.title, 120) + "（恢复）",
        genre: text(source.genre, 40),
        premise: text(source.premise),
        outline: text(source.outline),
        style: text(source.style),
        reference: text(source.reference),
        referenceName: text(source.referenceName, 1000),
        target: Number(source.target) || 200000,
        characters: [],
        contextChapters: Number.isInteger(source.contextChapters)
          ? Math.max(0, Math.min(100, source.contextChapters))
          : 2,
        chapterTargetWords: Math.min(
          20000,
          Math.max(100, Number(source.chapterTargetWords) || 2000)),
        volumes: (source.volumes || []).map((v) => ({
          id: volumeMap.get(v.id),
          title: text(v.title, 160),
          outline: text(v.outline || ""),
          detail: text(v.detail || ""),
        })),
        world: text(source.world),
        worldRecords: (source.worldRecords || []).map((r) => ({
          id: worldMap.get(r.id), category: text(r.category, 60), title: text(r.title, 120),
          description: text(r.description), certainty: r.certainty === "provisional" ? "provisional" : "fixed",
        })),
        foreshadows: (source.foreshadows || []).map((f) => ({
          id: foreshadowMap.get(f.id), title: text(f.title, 240),
          plantedChapterId: chapterMap.get(f.plantedChapterId) || "",
          payoffChapterId: chapterMap.get(f.payoffChapterId) || "",
          status: ["resolved", "abandoned"].includes(f.status) ? f.status : "open", note: text(f.note || ""),
        })),
        memories: [],
        archived: !!source.archived,
        ...(source.deletedAt ? { deletedAt: now() } : {}),
        createdAt: now(),
        updatedAt: now(),
      };
      assert(
        Array.isArray(source.characters) && source.characters.length <= 500,
        "人物数据格式无效");
      restored.characters = source.characters.map((c) => ({
        id: characterMap.get(c.id),
        name: text(c.name, 100),
        role: text(c.role, 100),
        description: text(c.description),
        authorNotes: text(c.authorNotes || ""), readerKnown: text(c.readerKnown || ""), characterKnown: text(c.characterKnown || ""),
        knowledgeFromChapterId: chapterMap.get(c.knowledgeFromChapterId) || "", secretFromChapterId: chapterMap.get(c.secretFromChapterId) || "",
        introducedOrder: Number(c.introducedOrder) || 0,
      }));
      store.putBook(restored);
      source.chapters.forEach((c, index) => {
        const chapterId = chapterMap.get(c.id);
        store.putChapter({
          id: chapterId,
          bookId,
          title: text(c.title, 160),
          outline: text(c.outline),
          summary: text(c.summary || ""),
          volumeId: volumeMap.get(c.volumeId) || "",
          targetWords: Math.min(20000, Math.max(0, Number(c.targetWords) || 0)),
          body: text(c.body),
          revision: Number.isInteger(c.revision) ? c.revision : 1,
          order: index + 1,
          status: c.status === "final" ? "final" : "draft",
          ...(c.deletedAt ? { deletedAt: now() } : {}),
          updatedAt: now(),
        });
      });
      restored.timeline = (source.timeline || []).map(restoreEvent);
      for (const m of source.memories || []) {
        if (m.sourceChapterId && !chapterMap.has(m.sourceChapterId)) continue;
        restored.memories.push({
          id: memoryMap.get(m.id),
          subject: text(m.subject, 120),
          relation: text(m.relation, 200),
          object: text(m.object),
          evidence: text(m.evidence),
          sourceChapterId: chapterMap.get(m.sourceChapterId) || "",
          sourceRevision: Number(m.sourceRevision) || 0,
          stale: !!m.stale,
          createdAt: now(),
        });
      }
      store.putBook(restored);
      for (const version of data.versions || [])
        if (chapterMap.has(version.chapterId)) {
          const v = {
            id: id(),
            chapterId: chapterMap.get(version.chapterId),
            title: text(version.title, 160),
            body: text(version.body),
            outline: text(version.outline),
            summary: text(version.summary || ""),
            revision: Number(version.revision) || 1,
            createdAt: text(version.createdAt, 100),
            label: text(version.label, 100),
          };
          store.db
            .prepare("INSERT INTO versions VALUES (?,?,?)")
            .run(v.id, v.chapterId, JSON.stringify(v));
        }
      // Preserve generated candidates as records, never resume a restored network task.
      for (const old of source.candidates || [])
        if (chapterMap.has(old.chapterId))
          store.putJob({
            id: id(),
            bookId,
            chapterId: chapterMap.get(old.chapterId),
            baseRevision: Number(old.baseRevision) || 1,
            kind: text(old.kind, 40),
            targetVolumeId: volumeMap.get(old.targetVolumeId) || "",
            targetLabel: old.targetLabel,
            instruction: text(old.instruction || ""),
            output: text(old.output),
            status:
              old.status === "running" ? "interrupted" : text(old.status, 40),
            createdAt: text(old.createdAt, 100),
            adopted: !!old.adopted,
            context: old.context,
            baseStyle: old.baseStyle,
            baseReference: old.baseReference,
            model: old.model,
            provider: old.provider,
            profileName: old.profileName,
            error: text(old.error || ""),
          });
      for (const sourceEntry of data.trash || []) {
        if (sourceEntry.bookId !== source.id) continue;
        const item = sourceEntry.item || {};
        if (sourceEntry.type === "book" && restored.deletedAt)
          store.recycle("book", bookId, { title: restored.title });
        else if (sourceEntry.type === "chapter" && chapterMap.has(item.id))
          store.recycle("chapter", bookId, {
            id: chapterMap.get(item.id),
            title: text(item.title, 160),
          });
        else if (sourceEntry.type === "character")
          store.recycle("character", bookId, {
            id: characterMap.get(item.id) || id(),
            name: text(item.name, 100),
            role: text(item.role, 100),
            description: text(item.description),
          });
        else if (sourceEntry.type === "timeline")
          store.recycle("timeline", bookId, restoreEvent(item));
        else if (sourceEntry.type === "volume")
          store.recycle("volume", bookId, {
            id: volumeMap.get(item.id),
            title: text(item.title, 160),
            outline: text(item.outline || ""),
            detail: text(item.detail || ""),
            chapterIds: (item.chapterIds || [])
              .map((cid) => chapterMap.get(cid))
              .filter(Boolean),
          });
        else if (sourceEntry.type === "planning") {
          assert(
            ["title", "outline", "world", "detail"].includes(item.field),
            "资料快照字段无效");
          store.recycle("planning", bookId, {
            title: text(item.title, 200),
            field: item.field,
            value: text(item.value),
            volumeId: volumeMap.get(item.volumeId) || "",
          });
        } else if (sourceEntry.type === "reference")
          store.recycle("reference", bookId, {
            name: text(item.name, 1000),
            body: text(item.body),
          });
        else if (sourceEntry.type === "memory")
          store.recycle("memory", bookId, {
            id: id(),
            subject: text(item.subject, 120),
            relation: text(item.relation, 200),
            object: text(item.object),
            evidence: text(item.evidence),
            sourceChapterId: chapterMap.get(item.sourceChapterId) || "",
            sourceRevision: Number(item.sourceRevision) || 0,
            stale: true,
            createdAt: now(),
          });
      }
      store.restoreCanvasViews(source, bookId, data.canvasViews, {
        chapterMap, characterMap, volumeMap, worldMap, memoryMap, eventMap, foreshadowMap,
      });
    }
    assert(!data.skills || Array.isArray(data.skills), "Skill 备份格式无效");
    for (const skill of data.skills || [])
      if (
        !store
          .skills()
          .some(
            (s) =>
              s.name === skill.name &&
              s.body === skill.body &&
              s.description === skill.description &&
              JSON.stringify(s.tasks) === JSON.stringify(skill.tasks))
      )
        store.saveSkill({
          ...skill,
          id: undefined,
          enabled: false,
          source: "备份恢复",
        });
    return data.books.length;
  });
}
const actions = {
  "canvas:get": (d) => store.getCanvas(d.bookId, d.view),
  "canvas:save": (d) => store.saveCanvas(d.bookId, d.view, d.layout),
  "timeline:preview": (d) =>
    require("./timeline.cjs").resolveTimeline(
      store.book(d.bookId),
      d.chapterId,
      d.includeCurrent !== false),
  "timeline:save": (d) => store.saveEvent(d.bookId, d.event),
  "timeline:delete": (d) => store.deleteEvent(d.bookId, d.id),
  "volume:save": (d) => store.saveVolume(d.bookId, d.volume),
  "volume:delete": (d) => store.deleteVolume(d.bookId, d.id),
  "chapter:organize": (d) => store.organizeChapter(d.id, d),
  "clipboard:write": async (d) => {
    await clipboard.writeText(text(d.text));
    return true;
  },
  "manual:export-draft": async (d) => {
    const title = text(d.title ?? "");
    const body = text(d.body);
    assert(title.trim() || body.trim(), "文稿为空，请先写下内容再导出");
    const filename = (title.trim() || "临时文稿")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .slice(0, 100);
    // The prefix also keeps Windows device names such as CON and NUL valid.
    return saveFile(
      `文稿-${filename}.txt`,
      `${title ? `${title}\n\n` : ""}${body}`,
      "txt",
    );
  },
  "manual:chapter-sources": (d) => store.chapterWritingSources(d.chapterId),
  "books:list": () => store.list(),
  "book:get": (d) => store.book(d.id),
  "book:create": (d) => store.createBook(d),
  "book:update": (d) => store.updateBook(d.id, d.patch),
  "chapter:create": (d) => store.createChapter(d.bookId),
  "chapter:create-with-body": (d) => store.createChapterWithBody(d.bookId, d),
  "chapter:save": (d) => store.updateChapter(d.id, d.patch, d.revision),
  "chapter:finalize": (d) => store.finalize(d.id, d.revision),
  "versions:list": (d) => store.versions(d.id),
  "version:restore": (d) => store.restoreVersion(d.id, d.versionId, d.revision),
  "memory:add": (d) => store.addMemory(d.bookId, d.memory),
  "memory:update": (d) => store.updateMemory(d.bookId, d.memory),
  "memory:delete": (d) => store.deleteMemory(d.bookId, d.id),
  "memory:accept": (d) => store.acceptExtraction(d.id),
  "context:preview": (d) => {
    const b = store.book(d.bookId);
    const c = b.chapters.find((x) => x.id === d.chapterId);
    assert(c, "请先选择章节");
    const { messages, ...rest } = buildContext(
      b,
      c,
      d.kind,
      d.instruction,
      store.skills(),
      { volumeId: d.targetVolumeId, chapterIds: d.chapterIds, manuscriptFormat: normalizeManuscriptFormat(store.setting("manuscript-formatting", {})) });
    return rest;
  },
  "ai:generate": generate,
  
  
  "manual:brainstorm": (d) => manualBrainstorm.start(d),
  "manual:brainstorm-cancel": (d) => manualBrainstorm.cancel(text(d.requestId, 100)),
  "ai:cancel": (d) => {
    running.get(d.id)?.abort("user");
    return true;
  },
  "planning:preview": (d) => {
    const job = store.job(d.id);
    if (!job.adopted && job.planningSignature) assert(job.planningSignature === require("./planning-routes.cjs").planningSignature(store.book(job.bookId)), "生成后分卷或章节规划已修改，请重新生成，避免覆盖新规划。");
    return job.adopted && job.planningPreview ? job.planningPreview : require("./planning-routes.cjs").planningRows(store.book(job.bookId), job, store.chapter(job.chapterId));
  },
  "ai:adopt": (d) => {
    assert(!running.has(d.id), "请等待变化分析完成，或先停止分析");
    const b = store.adopt(d.id, d.mode),
      job = store.job(d.id);
    if (job.review?.status === "ready") {
      const c = store.chapter(job.chapterId);
      job.review.revision = c.revision;
      job.review.signature = require("./timeline.cjs").contextSignature(b, c);
      store.putJob(job);
    }
    return store.book(b.id);
  },
  "sync:analyze": async (d) => {
    assert(running.size === 0 && !preparing, "请等待当前生成或分析完成");
    const job = store.job(d.id);
    assert(
      job.adopted && ["write", "continue", "polish"].includes(job.kind),
      "请先采用章节正文");
    const book = store.book(job.bookId),
      c = store.chapter(job.chapterId),
      config = store.config(),
      controller = new AbortController();
    assert(!book.deletedAt && !c.deletedAt, "请先恢复作品和章节");
    running.set(job.id, controller);
    job.review = { status: "analyzing" };
    store.putJob(job);
    emit(job);
    const work = (async () => {
      try {
        const sync = require("./sync-review.cjs"),
          key = config.provider === "codex" ? "" : await keyFor(config);
        let raw = "";
        const result = await (
          config.provider === "codex" ? requestCodex : requestModel
        )(
          config,
          key,
          sync.messages(book, c, c.body),
          (chunk) => {
            raw += chunk;
          },
          controller.signal);
        if (result.finishReason === "length") throw Error("分析未完成");
        const changes = sync.parse(raw, c.body);
        job.review = {
          status: changes.length ? "ready" : "empty",
          changes,
          bodyHash: sync.hash(c.body),
          revision: c.revision,
          signature: require("./timeline.cjs").contextSignature(book, c),
        };
      } catch (e) {
        job.review = { status: "error", error: e.message };
      } finally {
        store.putJob(job);
        running.delete(job.id);
        jobPromises.delete(job.id);
        emit(job);
      }
      return store.book(job.bookId);
    })();
    jobPromises.set(job.id, work);
    return work;
  },
  "sync:apply": (d) =>
    require("./sync-review.cjs").apply(store, d.id, d.changes),
  "config:get": publicConfig,
  "config:save": saveConfig,
  
  
  
  
  "config:test": async () => {
    const config = store.config();
    if (config.provider === "codex") {
      const r = await inspectCodex(config.cliPath);
      assert(r.loggedIn, "Codex 尚未登录，请先完成官方登录");
      return `Codex 已连接，可用模型 ${r.models.length} 个`;
    }
    let output = "";
    await requestModel(
      { ...config, maxTokens: 256 },
      await keyFor(config),
      [{ role: "user", content: "请回复：连接成功" }],
      (chunk) => {
        output += chunk;
      },
      AbortSignal.timeout(30000));
    assert(output.trim(), "服务未返回可读文本");
    return output.slice(0, 200);
  },
  "reference:import": async (d) => {
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "参考文章（UTF-8）", extensions: ["txt", "md"] }],
    });
    if (result.canceled) return null;
    const reference = await fs.readFile(result.filePaths[0], "utf8");
    assert(
      !reference.includes("\uFFFD"),
      "文件不是 UTF-8 编码，请转换后再导入");
    return store.updateBook(d.bookId, {
      reference,
      referenceName: basename(result.filePaths[0]),
    });
  },
  "book:export": async (d) => {
    const b = store.book(d.id);
    const ext = d.format === "txt" ? "txt" : "md";
    const body = b.chapters
      .map((c) => `${ext === "md" ? "## " : ""}${c.title}\n\n${c.body}`)
      .join("\n\n");
    return saveFile(
      `${b.title.replace(/[<>:"/\\|?*]/g, "_")}.${ext}`,
      `${ext === "md" ? "# " : ""}${b.title}\n\n${body}`,
      ext);
  },
  "backup:save": () =>
    saveFile(
      `星喵备份-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(store.backup(), null, 2),
      "json"),
  "backup:restore": restoreBackup,
  "data:open": () => shell.openPath(app.getPath("userData")),
  // 切换存储位置后必须重启才会生效（数据库连接在启动时就定好了）。
  // 走和正常关闭一样的收尾流程：先中止生成任务、等落盘，再重启。
  "data:restart": async () => {
    await closeLogin();
    await manualBrainstorm.cancelAll();
    for (const controller of running.values()) controller.abort("user");
    await Promise.allSettled([...jobPromises.values()]);
    closing = true;
    app.relaunch();
    app.exit(0);
    return true;
  },
  "app:close": async () => {
    await closeLogin();
    await manualBrainstorm.cancelAll();
    for (const controller of running.values()) controller.abort("user");
    await Promise.allSettled([...jobPromises.values()]);
    closing = true;
    win.close();
    return true;
  },
};
app.whenReady().then(() => {
  store = new Store(join(app.getPath("userData"), "xingmiao.sqlite"));
  if (
    store.db.prepare("PRAGMA user_version").get().user_version < 3 &&
    store.list(true).length
  ) {
    const backupPath = join(
      app.getPath("userData"),
      `before-v0.3-${Date.now()}.sqlite`);
    store.db.prepare("VACUUM INTO ?").run(backupPath);
  }
  store.initSkills();
  store.db.exec("PRAGMA user_version=3");
  
  
  Object.assign(
    actions,
    settingsActions({
      store,
      window: () => win,
      publicConfig,
      saveFile,
      running,
      
    }),
    dataDirActions({ store, window: () => win, running }));
  ipcMain.handle("xm:invoke", async (event, action, data = {}) => {
    try {
      assert(
        event.sender === win.webContents &&
          event.senderFrame === win.webContents.mainFrame,
        "访问被拒绝");
      assert(Object.hasOwn(actions, action), "不支持的操作");
      return { ok: true, data: await actions[action](data) };
    } catch (e) {
      return { ok: false, error: e.message || "操作失败，请重试" };
    }
  });
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1000,
    minHeight: 680,
    title: "星喵写作",
    icon: join(__dirname, "../public/cat-avatar.png"),
    backgroundColor: "#15171a",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, cb) =>
    cb(false));
  win.on("close", (event) => {
    if (!closing) {
      event.preventDefault();
      win.webContents.send("xm:closing");
    }
  });
  win.once("ready-to-show", () => win.show());
  if (process.env.XM_DEV_URL) win.loadURL(process.env.XM_DEV_URL);
  else win.loadFile(join(__dirname, "../dist/index.html"));
});
app.on("window-all-closed", () => {
  void manualBrainstorm.cancelAll();
  for (const controller of running.values()) controller.abort("user");
  app.quit();
});
app.on("will-quit", () => {
  store?.close();
});
