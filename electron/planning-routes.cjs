const { createHash } = require("node:crypto");

const routedKinds = ["bookOutline", "volumePlan", "volumeOutline", "volumeDetail", "chapterPlan", "chapterDetails", "summary", "outline"];
const volumeKinds = ["volumeOutline", "volumeDetail", "chapterPlan", "chapterDetails"];
function planningSignature(book) {
  return createHash("sha256").update(JSON.stringify([book.title, book.premise, book.outline, book.volumes || [], book.chapters.map(c => [c.id, c.title, c.volumeId, c.summary, c.outline, c.revision, c.order,...(c.volumePlanIndex===undefined?[]:[c.volumePlanIndex])]), ...(book.creationMode === 'short' ? ['short'] : [])])).digest("hex");
}
function readResult(output) {
  const raw = output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!/^[{[]/.test(raw)) return { text: raw };
  let value;
  try { value = JSON.parse(raw); } catch { throw Error("生成的结构不完整，不能采用；请重新生成或复制后整理。"); }
  if (!value || Array.isArray(value) || typeof value !== "object") throw Error("生成结果应为一个结构对象。");
  return value;
}
function string(value, field, required = false, max = Infinity) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || (required && !value.trim()) || value.length > max) throw Error(`${field}缺失或格式不正确，请重新生成。`);
  return value.trim();
}
function sameTitle(a, b) { return a.trim().normalize("NFKC") === b.trim().normalize("NFKC"); }
function namedTarget(record, existing, field) {
  const title = string(record.title, field, true, 160);
  if (record.id) {
    const target = existing.find(x => x.id === record.id);
    if (!target) throw Error(`${field}中的 ID 不属于指定目标，请重新生成。`);
    if (existing.some(x => x.id !== target.id && sameTitle(x.title, title))) throw Error(`${field}与其他目标重名，请重新生成。`);
    return { target, title };
  }
  const matches = existing.filter(x => sameTitle(x.title, title));
  if (matches.length > 1) throw Error(`${field}存在同名目标，请使用明确 ID 或先修改重名。`);
  return { target: matches[0], title };
}
function uniqueRows(rows) {
  const titles = new Set(), ids = new Set();
  for (const row of rows) {
    const key = row.title.normalize("NFKC");
    if (titles.has(key) || (row.id && ids.has(row.id))) throw Error("生成结果包含重复名称或目标，未采用任何内容。");
    titles.add(key); if (row.id) ids.add(row.id);
  }
}
function fieldPatch(record, fields) {
  return Object.fromEntries(fields.filter(k => record[k] !== undefined).map(k => [k, string(record[k], k)]));
}
function chapterRows(book, volume, records, kind, reusePlaceholder = true) {
  if (!Array.isArray(records) || !records.length || records.length > 200) throw Error("章节规划应包含 1–200 章，请按卷生成。");
  const existing = book.chapters.filter(c => (c.volumeId || '') === volume.id);
  const placeholder = require('./author-workflow.cjs').safePlaceholder(book);
  const targets = kind !== 'chapterDetails' && placeholder && !existing.some(c => c.id === placeholder.id) ? [...existing, placeholder] : existing;
  const rows = records.map((record, i) => {
    if (!record || typeof record !== "object") throw Error("章节规划字段不完整。");
    if (record.volumeId && record.volumeId !== volume.id) throw Error("章节规划包含其他分卷，未采用任何内容。");
    if (record.body !== undefined) throw Error("章节规划不能写入正文，请使用按细纲写正文。");
    let { target, title } = namedTarget(record, targets, "章节名称");
    if (!target && !record.id) {
      const number = title.match(/^第\s*(\d+)\s*章/)?.[1];
      const emptyMatches = number ? existing.filter(c => !c.body.trim() && !c.summary?.trim() && !c.outline.trim() && c.title.replace(/\s/g, "") === `第${Number(number)}章`) : [];
      if (emptyMatches.length === 1) target = emptyMatches[0];
    }
    if (!target && !record.id && i === 0 && placeholder && kind !== "chapterDetails" && reusePlaceholder) target = placeholder;
    if (kind === "chapterDetails" && !target) throw Error("请先采用本卷章节规划，再生成已有章节的细纲。");
    const fields = fieldPatch(record, ["summary", "outline"]);
    if (kind === "chapterPlan") string(fields.summary, "章节大纲", true);
    if (kind === "chapterDetails") string(fields.outline, "章节细纲", true);
    return { type: "chapter", id: target?.id, title, volumeId: volume.id, fields, action: target ? "update" : "create", destination: `${volume.title} → ${title}`, preservesBody: !!target?.body };
  });
  uniqueRows(rows);
  return rows;
}
function planningRows(book, job, chapter) {
  if (!routedKinds.includes(job.kind)) return null;
  if (job.status !== "done") throw Error("规划只可采用完整生成结果。");
  const data = readResult(job.output), legacy = data.text !== undefined;
  if (job.kind === "bookOutline") {
    const fields = { outline: string(legacy ? data.text : data.outline, "全文大纲", true) };
    if (!legacy && data.title !== undefined) fields.title = string(data.title, "作品名称", true, 120);
    return [{ type: "book", id: book.id, title: fields.title || book.title, fields, action: "update", destination: "故事大纲 → 全文大纲" }];
  }
  if (job.kind === "volumePlan") {
    if (!Array.isArray(data.volumes) || !data.volumes.length || data.volumes.length > 50) throw Error("分卷规划应包含 1–50 卷，请重新生成结构化分卷。");
    const rows = data.volumes.map(record => {
      const { target, title } = namedTarget(record, book.volumes || [], "分卷名称");
      return { type: "volume", id: target?.id, title, fields: fieldPatch(record, ["outline", "detail"]), action: target ? "update" : "create", destination: `分卷与章节 → ${title}` };
    });
    uniqueRows(rows);
    return rows;
  }
  if (volumeKinds.includes(job.kind)) {
    if (book.creationMode === 'short' && !job.targetVolumeId && ['chapterPlan', 'chapterDetails'].includes(job.kind)) {
      if (data.volumeId) throw Error('短篇章节规划不能指定其他分卷。');
      return chapterRows(book, { id: '', title: book.title }, data.chapters, job.kind);
    }
    const volume = (book.volumes || []).find(v => v.id === job.targetVolumeId);
    if (!volume) throw Error("目标分卷已删除，请重新生成。");
    if (data.id && data.id !== volume.id || data.volumeId && data.volumeId !== volume.id) throw Error("生成结果指向其他分卷，未采用任何内容。");
    if (job.kind === "chapterPlan" || job.kind === "chapterDetails") {
      if (!job.planningBatch) return chapterRows(book, volume, data.chapters, job.kind);
      const {chapterBatch,chapterSlots}=require('./chapter-batches.mjs');
      const batch=chapterBatch(book,volume.id,job.kind);
      if (!batch || JSON.stringify(batch)!==JSON.stringify(job.planningBatch)) throw Error('本卷分批进度已变化，请重新生成当前批次');
      if (!Array.isArray(data.chapters) || data.chapters.length!==batch.positions.length || data.chapters.length>10) throw Error('本批章节数量不完整或超过10章，请重新生成当前批次');
      const slots=chapterSlots(book,volume.id),seen=new Set();
      const records=data.chapters.map(record=>{
        if (!Number.isInteger(record?.position) || !batch.positions.includes(record.position) || seen.has(record.position)) throw Error('生成结果包含重复或其他批次的位置，未采用任何章节');
        seen.add(record.position);
        const existing=slots.find(row=>row.position===record.position)?.chapter;
        if (record.id && record.id!==existing?.id) throw Error('本批章节编号不属于对应规划位置');
        return {...record,id:existing?.id};
      }).sort((a,b)=>a.position-b.position);
      const rows=chapterRows(book,volume,records,job.kind,false);
      rows.forEach((row,i)=>{
        const expected=slots.find(slot=>slot.position===records[i].position)?.chapter;
        if (row.id!==expected?.id) throw Error('章名与已确认位置冲突，不能改写其他批次');
        row.volumePlanIndex=records[i].position;
      });
      return rows;
    }
    const field = job.kind === "volumeOutline" ? "outline" : "detail";
    const title = legacy ? volume.title : string(data.title, "卷名", false, 160) || volume.title;
    if ((book.volumes || []).some(v => v.id !== volume.id && sameTitle(v.title, title))) throw Error("卷名与其他分卷重名，请重新生成。");
    const fields = { [field]: string(legacy ? data.text : data[field], field === "outline" ? "卷大纲" : "卷细纲", true) };
    if (!legacy) Object.assign(fields, fieldPatch(data, ["outline", "detail"]));
    const rows = [{ type: "volume", id: volume.id, title, fields, action: "update", destination: `${title} → ${field === "outline" ? "卷大纲" : "卷细纲"}` }];
    if (!legacy && data.chapters !== undefined) rows.push(...chapterRows(book, { ...volume, title }, data.chapters, "volumeDetail"));
    return rows;
  }
  const field = job.kind === "summary" ? "summary" : "outline";
  if (!legacy && data.id && data.id !== chapter.id) throw Error("生成结果指向其他章节，未采用任何内容。");
  const title = legacy ? chapter.title : string(data.title, "章名", false, 160) || chapter.title;
  if (book.chapters.some(c => c.id !== chapter.id && c.volumeId === chapter.volumeId && sameTitle(c.title, title))) throw Error("章名与同卷其他章节重名，请重新生成。");
  const fields = { [field]: string(legacy ? data.text : data[field], "章节规划", true) };
  if (!legacy) Object.assign(fields, fieldPatch(data, ["summary", "outline"]));
  return [{ type: "chapter", id: chapter.id, title, volumeId: chapter.volumeId, fields, action: "update", destination: `${title} → ${field === "summary" ? "章节大纲" : "章节细纲"}`, preservesBody: !!chapter.body }];
}
function applyRows(store, bookId, rows) {
  const created = [];
  for (const row of rows) {
    if (row.type === "book") {
      const book = store.rawBook(bookId);
      for (const field of Object.keys(row.fields)) store.recycle("planning", bookId, { title: `原${field === "title" ? "作品名称" : "全文大纲"}`, field, value: book[field] });
      store.updateBook(bookId, row.fields);
    } else if (row.type === "volume") {
      const existing = store.rawBook(bookId).volumes?.find(v => v.id === row.id);
      if (existing) for (const field of ["title", ...Object.keys(row.fields)]) store.recycle("planning", bookId, { title: `${existing.title} · 原${{title:"卷名",outline:"卷大纲",detail:"卷细纲"}[field]}`, field, value: existing[field], volumeId: existing.id });
      const updated = store.saveVolume(bookId, { ...existing, title: row.title, ...row.fields });
      row.id = updated.volumes.find(v => sameTitle(v.title, row.title)).id;
    } else {
      const chapter = row.id ? store.chapter(row.id) : store.createChapter(bookId, row.title);
      if (!row.id) created.push(chapter.id);
      row.id = chapter.id;
      store.updateChapter(chapter.id, { title: row.title, ...row.fields }, chapter.revision, "采用章节规划前快照");
      if (row.volumeId && chapter.volumeId !== row.volumeId) store.organizeChapter(chapter.id, { volumeId: row.volumeId });
      if (row.volumePlanIndex) store.putChapter({...store.chapter(chapter.id),volumePlanIndex:row.volumePlanIndex});
    }
  }
  // A chapter added to an earlier volume belongs before later volumes even
  // when those later chapters already exist. Keep all existing orders intact,
  // including deleted chapters whose original positions may be restored.
  const book = store.book(bookId), ids = new Set(created);
  const base = book.chapters.filter(c => !ids.has(c.id));
  const occupied = new Set(store.chapters(bookId, true).filter(c => !ids.has(c.id)).map(c => c.order));
  for (const [index, volume] of (book.volumes || []).entries()) {
    const additions = book.chapters.filter(c => ids.has(c.id) && c.volumeId === volume.id);
    if (!additions.length) continue;
    const existing = base.filter(c => c.volumeId === volume.id);
    const last = existing.at(-1);
    const laterIds = new Set(book.volumes.slice(index + 1).map(v => v.id));
    const next = base.find(c => (!last || c.order > last.order) && laterIds.has(c.volumeId));
    if (!next) { base.push(...additions); base.sort((a,b)=>a.order-b.order); continue; }
    const previous = last || base.filter(c => c.order < next.order).at(-1);
    const low = previous?.order || 0, step = (next.order - low)/(additions.length+1);
    for (const [i, chapter] of additions.entries()) {
      const lower = low + step*i;
      let order = low + step*(i+1);
      for (let tries=0; occupied.has(order) && tries<52; tries++) order=(lower+order)/2;
      if (!(order>lower && order<next.order) || occupied.has(order)) throw Error("章节位置过于密集，请备份并重新规划后再采用。");
      occupied.add(order); chapter.order=order; store.putChapter(chapter); base.push(chapter);
    }
    base.sort((a,b)=>a.order-b.order);
  }
  // Fill skipped positions in their original place without moving other volumes.
  const batchVolumes=new Set(rows.filter(row=>row.volumePlanIndex).map(row=>row.volumeId));
  for (const volumeId of batchVolumes) {
    const current=store.book(bookId);
    const slots=require('./chapter-batches.mjs').chapterSlots(current,volumeId);
    const orders=slots.map(row=>row.chapter.order).sort((a,b)=>a-b);
    slots.forEach(({chapter,position},i)=>store.putChapter({...chapter,order:orders[i],volumePlanIndex:position}));
  }
}
function reviewChapterRows(book, job, chapter, selection) {
  if (!['chapterPlan','chapterDetails'].includes(job.kind)) throw Error('当前任务不支持逐章选择采用');
  const original = planningRows(book, job, chapter);
  if (!Array.isArray(selection) || !selection.length || selection.length > original.length) throw Error('请至少选择一个章节规划');
  const indexes = new Set();
  const chosen = selection.map(edit => {
    if (!edit || !Number.isInteger(edit.index) || edit.index < 0 || edit.index >= original.length || indexes.has(edit.index)) throw Error('章节选择编号无效或重复');
    indexes.add(edit.index);
    if (Object.keys(edit).some(key => !['index','title','summary','outline'].includes(key))) throw Error('只能编辑章名、概要和细纲');
    const row = original[edit.index];
    if (row.type !== 'chapter') throw Error('不能通过章节选择修改其他资料');
    const fields = { ...row.fields };
    for (const key of ['summary','outline']) if (edit[key] !== undefined) fields[key] = string(edit[key],key,false,100000);
    return { index:edit.index, row, record:{ id:row.id, title:string(edit.title ?? row.title,'章名',true,160), ...fields } };
  }).sort((a,b)=>a.index-b.index);
  const volume = job.targetVolumeId ? book.volumes?.find(row=>row.id===job.targetVolumeId) : {id:'',title:book.title};
  if (!volume) throw Error('目标分卷不存在');
  const reviewed = chapterRows(book, volume, chosen.map(item=>item.record), job.kind, false);
  for (const [index,row] of reviewed.entries()) {
    const source=chosen[index].row;
    if (source.id ? row.id!==source.id : row.id) throw Error('编辑后的章名与已有章节重名，不能改变采用目标');
    if (source.volumePlanIndex) row.volumePlanIndex=source.volumePlanIndex;
  }
  return reviewed;
}
module.exports = { readResult, routedKinds, volumeKinds, planningSignature, planningRows, applyRows, reviewChapterRows };
