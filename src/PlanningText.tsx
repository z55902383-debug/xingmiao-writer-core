import { useState } from "react";
import { tr } from "./i18n";
import { Button, Modal, Field } from "./ui";
import type { PlanningRow, PlanningSelection } from "./types";
import type {ChapterBatch} from '../electron/chapter-batches.mjs';
import PlanningBatchNotice from './PlanningBatchNotice';

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2,-2)}</strong> : part);
}
export function PlanningText({ text }: { text: string }) {
  return <div className="planning-rich-text">{text.split(/\n\s*\n/).filter(Boolean).map((block,i) => {
    const lines = block.split("\n");
    if (lines.length === 1 && /^#{1,6}\s/.test(block)) return <h4 key={i}>{inline(block.replace(/^#{1,6}\s+/,""))}</h4>;
    if (lines.every(line => /^\s*(?:[-*]|\d+[.)、])\s+/.test(line))) return <ul key={i}>{lines.map((line,j) => <li key={j}>{inline(line.replace(/^\s*(?:[-*]|\d+[.)、])\s+/,""))}</li>)}</ul>;
    return <p key={i}>{inline(block)}</p>;
  })}</div>;
}
export function PlanExcerpt({ title, text, empty }: { title: string; text: string; empty: string }) {
  const [open,setOpen] = useState(false);
  return <section className="plan-excerpt">
    <header><strong>{title}</strong><small>{text.trim() ? tr("已填写") : tr("未填写")}</small></header>
    <p className="plan-excerpt-preview">{text ? text.replace(/^#{1,6}\s+/gm,"").replace(/\*\*/g,"") : empty}</p>
    {!!text && <Button onClick={() => setOpen(true)} aria-label={tr("查看完整{0}", {0:title})}>{tr("查看完整内容")}</Button>}
    {open && <Modal title={title} wide onClose={() => setOpen(false)}><div className="modal-body plan-reading"><PlanningText text={text}/></div><div className="modal-footer"><Button onClick={() => setOpen(false)}>{tr("关闭")}</Button></div></Modal>}
  </section>;
}
export function PlanningCandidate({ rows, onReviewAdopt, disabled = false, batch }: { rows: PlanningRow[]; onReviewAdopt?: (selection: PlanningSelection[]) => Promise<boolean>; disabled?: boolean; batch?:ChapterBatch }) {
  const [review, setReview] = useState(false), [saving,setSaving]=useState(false), [error,setError]=useState("");
  const [edits,setEdits]=useState<(PlanningSelection & { chosen:boolean })[]>([]);
  const [reviewRows,setReviewRows]=useState<PlanningRow[]>([]);
  function openReview() { setError(""); setReviewRows(rows); setEdits(rows.map((row,index)=>({index,title:row.title,...row.fields,chosen:true}))); setReview(true); }
  const labels: Record<string,string> = {title:"名称",outline:"大纲 / 细纲",detail:"卷细纲",summary:"章节大纲"};
  return <div className="planning-candidate"><PlanningBatchNotice batch={batch} candidate/>{onReviewAdopt && <div className="chapter-review-entry"><strong>{tr("本次建议 {0} 章",{0:rows.length})}</strong><p>{tr("可以逐章选择，编辑章名、概要或细纲，再采用到对应分卷。")}</p><Button variant="primary-soft" disabled={disabled} onClick={openReview}>{tr("逐章核对与采用")}</Button></div>}<p className="planning-route-note">{tr("采用后，以下名称与内容将同步到对应位置。未列出的章节和已有正文保留。")}</p>{rows.map((row,i) => <article key={i}>
    <header><strong>{row.title}</strong><span>{tr(row.action === "create" ? "新建" : "更新")}</span></header>
    <small className="planning-route">{row.destination}</small>
    {Object.entries(row.fields).filter(([key]) => key !== "title").map(([key,value]) => <details key={key} open={rows.length === 1}>
      <summary>{tr(labels[key] || key)}</summary><PlanExcerpt title={tr(labels[key] || key)} text={value || ""} empty={tr("暂无内容")}/>
    </details>)}
    {row.preservesBody && <small>{tr("此章已有正文；本次只更新名称和规划，正文保留。")}</small>}
  </article>)}{review && <Modal title={tr("逐章核对与采用")} wide onClose={()=>!saving&&setReview(false)}><div className="modal-body chapter-review-body"><PlanningBatchNotice batch={batch} candidate/><p>{tr("未勾选的章节不会写入；已有正文保留，修改只涉及章名和规划。")}</p>{edits.map((edit,index)=><section key={index} className="chapter-review-row"><div className="chapter-review-title"><input type="checkbox" aria-label={tr("采用第{0}项章节规划",{0:index+1})} checked={edit.chosen} disabled={saving} onChange={e=>setEdits(old=>old.map((row,i)=>i===index?{...row,chosen:e.target.checked}:row))}/><input aria-label={tr("第{0}项章名",{0:index+1})} value={edit.title} maxLength={160} disabled={saving} onChange={e=>setEdits(old=>old.map((row,i)=>i===index?{...row,title:e.target.value}:row))}/></div><small>{reviewRows[index]?.destination}</small><details open={index===0}><summary>{tr("编辑章节大纲与细纲")}</summary>{["summary","outline"].map(field=><Field key={field} label={tr(field==="summary"?"章节大纲":"章节细纲")}><textarea aria-label={tr(field==="summary"?"第{0}项章节大纲":"第{0}项章节细纲",{0:index+1})} rows={4} value={edit[field as "summary"|"outline"] || ""} disabled={saving} onChange={e=>setEdits(old=>old.map((row,i)=>i===index?{...row,[field]:e.target.value}:row))}/></Field>)}</details></section>)}{error&&<p className="error-box" role="alert">{error}</p>}</div><div className="modal-footer"><span>{tr("已选 {0}/{1} 章",{0:edits.filter(row=>row.chosen).length,1:edits.length})}</span><Button disabled={saving} onClick={()=>setReview(false)}>{tr("取消")}</Button><Button variant="primary" busy={saving} disabled={disabled||!edits.some(row=>row.chosen)} onClick={async()=>{setSaving(true);setError("");try{const selection=edits.filter(row=>row.chosen).map(({chosen,...row})=>row);const accepted=await onReviewAdopt?.(selection);if(accepted)setReview(false);else setError(tr("采用未完成，编辑内容已保留，请检查提示后重试。"));}catch(e){setError((e as Error).message);}finally{setSaving(false);}}}>{tr("采用所选章节规划")}</Button></div></Modal>}</div>;
}
