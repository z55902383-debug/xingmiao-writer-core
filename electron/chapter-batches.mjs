// Shared by the desktop UI and request/adoption paths. Positions belong to a
// volume, independently of editable chapter titles and global chapter numbers.
export function chapterSlots(book, volumeId) {
  const chapters = book.chapters.filter(c => c.volumeId === volumeId).sort((a,b)=>a.order-b.order);
  const slots = new Map();
  for (const c of chapters) if (Number.isInteger(c.volumePlanIndex) && c.volumePlanIndex > 0 && c.volumePlanIndex <= 200) {
    // A restored deleted chapter may share a position with its replacement.
    // Keep both chapters and allocate a free position to the later one.
    if (!slots.has(c.volumePlanIndex)) slots.set(c.volumePlanIndex,c);
  }
  let next=1;
  for (const c of chapters) if (![...slots.values()].some(row=>row.id===c.id)) {
    while (slots.has(next)) next++;
    slots.set(next++,c);
  }
  return [...slots].sort((a,b)=>a[0]-b[0]).map(([position,chapter])=>({position,chapter}));
}
export function chapterBatch(book, volumeId, kind = 'chapterPlan') {
  const volume=book.volumes?.find(v=>v.id===volumeId);
  if (!volume || !['chapterPlan','chapterDetails'].includes(kind)) return null;
  const slots=chapterSlots(book,volumeId);
  const estimate=Math.min(200,Math.max(1,Math.ceil(book.target/(book.chapterTargetWords||2000)/Math.max(1,book.volumes.length))));
  const total=Math.max(volume.targetChapters||estimate,slots.at(-1)?.position||0);
  if (!(volume.planInBatches || total>20 || (kind==='chapterDetails' && slots.length>10))) return null;
  const available=kind==='chapterDetails' ? slots.map(row=>row.position) : Array.from({length:total},(_,i)=>i+1);
  const pending=available.filter(position=>{const c=slots.find(row=>row.position===position)?.chapter;return kind==='chapterDetails' ? !c?.outline?.trim() : !c?.summary?.trim();});
  if (!pending.length) return {total,start:0,end:0,positions:[],complete:true,estimated:!volume.targetChapters};
  const start=Math.floor((pending[0]-1)/10)*10+1,end=Math.min(total,start+9);
  return {total,start,end,positions:pending.filter(n=>n>=start && n<=end),complete:false,estimated:!volume.targetChapters};
}
