// Validate new model responses before calling them complete. Historical candidates
// keep their adoption compatibility; destination/revision checks still run on adopt.
function validateGeneratedOutput(book, chapter, job) {
  const structured = ['bookOutline', 'volumePlan', 'volumeOutline', 'volumeDetail', 'chapterPlan', 'chapterDetails', 'outline', 'summary', 'characters', 'timelinePlan', 'memory'];
  if (!structured.includes(job.kind)) return;
  const raw = job.output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value;
  try { value = JSON.parse(raw); } catch { throw Error('模型输出不符合本步骤的 JSON 格式，已保留结果供核对，请重新生成。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('模型输出应为本步骤的 JSON 对象，已保留结果供核对。');
  const routes = require('./planning-routes.cjs');
  if (routes.routedKinds.includes(job.kind)) {
    const field = { bookOutline: 'outline', volumePlan: 'volumes', volumeOutline: 'outline', volumeDetail: 'detail', chapterPlan: 'chapters', chapterDetails: 'chapters', outline: 'outline', summary: 'summary' }[job.kind];
    if (!Object.hasOwn(value, field) || Object.hasOwn(value, 'text') || Object.hasOwn(value, 'body')) throw Error('模型输出字段不属于本步骤的结构，已保留结果供核对。');
    routes.planningRows(book, job, chapter);
    return;
  }
  const field = { characters: 'characters', timelinePlan: 'events', memory: 'memories' }[job.kind];
  const rows = value[field], max = job.kind === 'memory' ? 12 : 8;
  if (!Array.isArray(rows) || rows.length > max || (job.kind !== 'memory' && !rows.length)) throw Error(`模型输出的 ${field} 数量或结构不符合本步骤要求。`);
  const required = job.kind === 'characters' ? ['name', 'role', 'description'] : job.kind === 'memory' ? ['subject', 'relation', 'object', 'evidence'] : ['kind', 'title', 'attribute', 'value'];
  for (const row of rows) {
    if (!row || required.some(key => typeof row[key] !== 'string' || !row[key].trim())) throw Error(`模型输出的 ${field} 字段不完整。`);
    if (job.kind === 'memory' && !chapter.body.includes(row.evidence)) throw Error('模型提取的证据不在当前正文中，不能作为已核对的记忆结果。');
    if (job.kind === 'timelinePlan') {
      if (!['world', 'character', 'relation'].includes(row.kind)) throw Error('变化计划类型无效。');
      if (row.chapterId && !book.chapters.some(c => c.id === row.chapterId)) throw Error('变化计划的章节不属于本书。');
      if (row.kind === 'world' && !(typeof row.entity === 'string' && row.entity.trim())) throw Error('世界变化计划缺少对象。');
      for (const key of row.kind === 'relation' ? ['characterId', 'targetId'] : row.kind === 'character' ? ['characterId'] : [])
        if (!book.characters.some(c => c.id === row[key])) throw Error('变化计划引用了不存在的人物。');
    }
  }
  if (job.kind === 'characters') {
    const names = rows.map(row => row.name.trim().normalize('NFKC'));
    if (new Set(names).size !== names.length || book.characters.some(row => names.includes(row.name.trim().normalize('NFKC')))) throw Error('生成人物与已有角色或本批次人物重名，请核对后重新生成。');
  }
}
module.exports = { validateGeneratedOutput };
