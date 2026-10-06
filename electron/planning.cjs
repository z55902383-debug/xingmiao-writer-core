const tasks = {
  bookOutline:
    "根据故事简介与已有资料生成完整全书总纲，包含核心目标、主要阶段、冲突升级、重要转折、伏笔和结局方向。只输出总纲，不写章节正文。",
  worldBuild:
    "根据题材、简介与总纲生成世界初始设定，包含时代、地域、组织、能力与限制。未来变化只列为规划，不写成已发生事实。只输出世界设定。",
  characters:
    '设计与故事简介和总纲匹配的人物基础档案，避免重复已有角色。只输出 JSON：{"characters":[{"name":"姓名","role":"定位","description":"背景、性格、动机及初始状态"}]}，最多 8 位。不把后期状态当作初始设定。',
  volumeOutline:
    "只为指定目标卷生成卷大纲：本卷目标、主冲突、起承转合、高潮、结束状态与下卷衔接。不生成其他卷或正文。",
  volumeDetail:
    "根据指定卷的大纲生成更细的阶段事件与章节分配建议，包含每阶段事件、冲突、转折、伏笔埋设及回收。不直接写小说正文。",
  summary:
    "为当前章节生成简明概要，说明主事件、目标、出场人物、转折及章末钩子；不输出整章正文。",
  timelinePlan:
    '根据现有资料提出后续世界、人物状态或关系的变化计划。只输出 JSON：{"events":[{"kind":"world或character或relation","title":"事件","entity":"世界对象（仅world）","characterId":"人物ID（人物类必填）","targetId":"关系对象ID（仅relation）","attribute":"变化维度","value":"变化后的状态","chapterId":"本书章节ID，或空字符串表示开篇规划","storyTime":"可选故事时间","sequence":1}]}。最多 8 条，严格使用资料中真实人物和章节 ID。所有结果仅为计划，由作者审核，不确认发生。',
};
function parseObject(output) {
  const value = JSON.parse(
    output.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""),
  );
  if (!value || typeof value !== "object")
    throw Error("模型未返回有效结构，请重新生成");
  return value;
}
function applyPlanning(store, job, c) {
  const book = store.rawBook(job.bookId);
  if (!tasks[job.kind]) return false;
  if (job.status !== "done") throw Error("此类资料只可采用完整生成结果");
  if (["bookOutline", "worldBuild"].includes(job.kind)) {
    const key = job.kind === "bookOutline" ? "outline" : "world";
    store.recycle("planning", book.id, {
      title: job.kind === "bookOutline" ? "原全书总纲" : "原世界设定",
      field: key,
      value: book[key],
    });
    store.updateBook(book.id, { [key]: job.output });
  } else if (job.kind === "summary")
    store.updateChapter(
      c.id,
      { summary: job.output },
      c.revision,
      "采用章节概要前快照",
    );
  else if (["volumeOutline", "volumeDetail"].includes(job.kind)) {
    const v = (book.volumes || []).find((v) => v.id === job.targetVolumeId);
    if (!v) throw Error("目标分卷已删除，请重新生成");
    const field = job.kind === "volumeOutline" ? "outline" : "detail";
    store.recycle("planning", book.id, {
      title: `${v.title} · 原${field === "outline" ? "大纲" : "细纲"}`,
      field,
      value: v[field],
      volumeId: v.id,
    });
    store.saveVolume(book.id, { ...v, [field]: job.output });
  } else if (job.kind === "characters") {
    const values = parseObject(job.output).characters;
    if (!Array.isArray(values) || !values.length || values.length > 8)
      throw Error("人物结果应包含 1–8 位人物");
    const additions = values.map((p) => {
      if (
        typeof p.name !== "string" ||
        !p.name.trim() ||
        typeof p.role !== "string" ||
        typeof p.description !== "string"
      )
        throw Error("人物字段不完整，请重新生成");
      if (book.characters.some((c) => c.name.trim() === p.name.trim()))
        throw Error(`人物“${p.name}”已存在，请编辑现有档案或重新生成`);
      return { ...p, id: require("node:crypto").randomUUID() };
    });
    if (new Set(additions.map((p) => p.name.trim())).size !== additions.length)
      throw Error("生成人物存在重名，请重新生成");
    store.updateBook(book.id, {
      characters: [...book.characters, ...additions],
    });
  } else if (job.kind === "timelinePlan") {
    const values = parseObject(job.output).events;
    if (!Array.isArray(values) || !values.length || values.length > 8)
      throw Error("变化计划应包含 1–8 条记录");
    for (const e of values)
      store.saveEvent(book.id, {
        ...e,
        id: undefined,
        phase: "planned",
        evidence: "",
      });
  }
  return true;
}
module.exports = { tasks, applyPlanning };
