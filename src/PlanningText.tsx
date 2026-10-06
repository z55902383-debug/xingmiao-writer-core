import { useState } from "react";
import { tr } from "./i18n";
import { Button, Modal } from "./ui";
import type { PlanningRow } from "./types";

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
    <header><strong>{title}</strong><small>{text.trim() ? tr("已填写") : tr("待生成")}</small></header>
    <p className="plan-excerpt-preview">{text ? text.replace(/^#{1,6}\s+/gm,"").replace(/\*\*/g,"") : empty}</p>
    {!!text && <Button onClick={() => setOpen(true)} aria-label={tr("查看完整{0}", {0:title})}>{tr("查看完整内容")}</Button>}
    {open && <Modal title={title} wide onClose={() => setOpen(false)}><div className="modal-body plan-reading"><PlanningText text={text}/></div><div className="modal-footer"><Button onClick={() => setOpen(false)}>{tr("关闭")}</Button></div></Modal>}
  </section>;
}
export function PlanningCandidate({ rows }: { rows: PlanningRow[] }) {
  const labels: Record<string,string> = {title:"名称",outline:"大纲 / 细纲",detail:"卷细纲",summary:"章节大纲"};
  return <div className="planning-candidate"><p className="planning-route-note">{tr("采用后，以下名称与内容将同步到对应位置。未列出的章节和已有正文保留。")}</p>{rows.map((row,i) => <article key={i}>
    <header><strong>{row.title}</strong><span>{tr(row.action === "create" ? "新建" : "更新")}</span></header>
    <small className="planning-route">{row.destination}</small>
    {Object.entries(row.fields).filter(([key]) => key !== "title").map(([key,value]) => <details key={key} open={rows.length === 1}>
      <summary>{tr(labels[key] || key)}</summary><PlanExcerpt title={tr(labels[key] || key)} text={value || ""} empty={tr("暂无内容")}/>
    </details>)}
    {row.preservesBody && <small>{tr("此章已有正文；本次只更新名称和规划，正文保留。")}</small>}
  </article>)}</div>;
}
