const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function basis(book, chapter) {
  const fields = { '故事想法': book.premise, '全文大纲': book.outline, '人物档案': book.characters, '世界设定': [book.world, book.worldRecords], '时间线与记忆': [book.timeline, book.memories, book.foreshadows], '分卷规划': book.volumes, '章节规划': book.chapters.map(c => [c.id, c.title, c.volumeId, c.summary, c.outline]), '目标章节正文': [chapter.body, chapter.revision], '风格与要求': require('./writing-profiles.cjs').contextValue(book) };
  const imitationReferences = require('./imitation.cjs').references(book);
  if (imitationReferences.length) fields['仿写故事对标'] = imitationReferences;
  fields['写前卡与拆文技法'] = [chapter.writingCard || {}, (book.techniques || []).filter(row => row.enabled)];
  return Object.fromEntries(Object.entries(fields).map(([label, value]) => [label, { hash: digest(value), preview: typeof value === 'string' ? value.slice(0, 600) : JSON.stringify(value).slice(0, 600) }]));
}
function prepare(store, id) {
  const job = store.job(id), book = store.book(job.bookId), chapter = store.chapter(job.chapterId);
  const signature = require('./timeline.cjs').contextSignature(book, chapter), planningSignature = require('./planning-routes.cjs').planningSignature(book);
  const current = basis(book, chapter);
  if (job.adoptionBasis?.['仿写故事对标'] && !current['仿写故事对标']) current['仿写故事对标'] = { hash: digest([]), preview: '[]' };
  const changes = job.adoptionBasis ? Object.keys(current).filter(label => job.adoptionBasis[label]?.hash !== current[label].hash).map(label => ({ label, before: job.adoptionBasis[label]?.preview || '', after: current[label].preview })) : [];
  const conflict = !!((job.contextSignature && job.contextSignature !== signature) || (job.planningSignature && job.planningSignature !== planningSignature) || chapter.revision !== job.baseRevision);
  const field = { bookOutline: 'outline', worldBuild: 'world', volumeOutline: 'outline', volumeDetail: 'detail', outline: 'outline', summary: 'summary', write: 'body', continue: 'body', polish: 'body' }[job.kind];
  const target = job.kind.startsWith('volume') ? book.volumes?.find(v => v.id === job.targetVolumeId) : ['bookOutline', 'worldBuild'].includes(job.kind) ? book : chapter;
  let suggested = job.output, needsCompletion = false;
  if (field && field !== 'body') {
    try {
      const result = require('./planning-routes.cjs').readResult(job.output);
      suggested = typeof result[field] === 'string' ? result[field] : result.text;
      if (typeof suggested !== 'string') { suggested = ''; needsCompletion = true; }
    } catch { suggested = ''; needsCompletion = true; }
  }
  if (job.kind === 'continue') suggested = chapter.body + suggested;
  return { conflict, changes, needsCompletion, canMerge: !!field && !!target && !book.deletedAt && !chapter.deletedAt && !job.adopted && job.review?.status !== 'analyzing' && ['done', 'interrupted', 'cancelled'].includes(job.status), current: field && target ? target[field] || '' : '', suggested, targetLabel: target?.title || '', field, signature, planningSignature, revision: chapter.revision };
}
function merge(store, input) {
  return store.transaction(() => {
    const preview = prepare(store, input.id), job = store.job(input.id);
    if (!preview.canMerge || preview.signature !== input.signature || preview.planningSignature !== input.planningSignature || preview.revision !== input.revision)
      throw Error('核对期间正文或资料再次变化，请重新打开合并窗口。');
    if (typeof input.value !== 'string' || !input.value.trim()) throw Error('请先填写合并后的内容。');
    if (preview.field !== 'body' && /^[{[]|^```/.test(input.value.trim())) {
      const parsed = require('./planning-routes.cjs').readResult(input.value);
      if (!parsed.text) throw Error('请填写整理后的文字内容，不要直接保存 JSON 结构。');
    }
    if (['bookOutline', 'worldBuild'].includes(job.kind)) {
      store.recycle('planning', job.bookId, { title: '手动合并前内容', field: preview.field, value: preview.current });
      store.updateBook(job.bookId, { [preview.field]: input.value });
    } else if (job.kind.startsWith('volume')) {
      const volume = store.rawBook(job.bookId).volumes.find(v => v.id === job.targetVolumeId);
      store.recycle('planning', job.bookId, { title: '手动合并前卷规划', field: preview.field, volumeId: volume.id, value: preview.current });
      store.saveVolume(job.bookId, { ...volume, [preview.field]: input.value });
    } else {
      store.updateChapter(job.chapterId, { [preview.field]: input.value }, preview.revision, '手动合并前快照');
      if (preview.field === 'body') { store.recordProseSources(job); job.review = { status: 'error', error: '手动合并后的正文需要重新分析故事变化。' }; }
    }
    job.adopted = true; job.manualMerged = true;
    store.putJob(job);
    return store.book(job.bookId);
  });
}
module.exports = { basis, prepare, merge };
