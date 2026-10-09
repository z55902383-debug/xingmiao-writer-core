import { useState } from "react";
import { Plus, PencilSimple, Trash, UploadSimple, Export, Sparkle, ArrowCounterClockwise } from "@phosphor-icons/react";
import { api } from "./api";
import { tr } from "./i18n";
import { Button, Field, Modal } from "./ui";
import type { Book, WritingProfile, WritingSelection } from "./types";
import "./writing-profiles.css";

export function profileRows(book: Book): WritingProfile[] {
  return book.style.trim() ? [{ id: "legacy-book-style", kind: "style", title: tr("本书风格档案"), body: book.style, source: book.reference, sourceName: book.referenceName, revision: 1 }, ...(book.writingProfiles || [])] : book.writingProfiles || [];
}
export function profileSelection(book: Book): WritingSelection {
  return book.writingSelection || { styleIds: book.style.trim() ? ["legacy-book-style"] : [], requirementIds: [] };
}
export function WritingPicker({ book, disabled, onSelect, onManage }: { book: Book; disabled: boolean; onSelect: (selection: WritingSelection) => Promise<void>; onManage: () => void }) {
  const [pendingChoice, setPendingChoice] = useState<WritingSelection | null>(null);
  const selected = pendingChoice || profileSelection(book);
  async function choose(value: WritingSelection) { setPendingChoice(value); try { await onSelect(value); } finally { setPendingChoice(null); } }
  return <section className="writing-picker" aria-label={tr("风格参考")}>
    <div className="writing-section-head"><strong>{tr("风格参考")}</strong><Button variant="ghost" onClick={onManage}>{tr("管理风格与要求")}</Button></div>
    {(["style", "requirement"] as const).map(kind => {
      const field = kind === "style" ? "styleIds" : "requirementIds";
      const rows = profileRows(book).filter(item => item.kind === kind);
      return <fieldset key={kind} disabled={disabled || !!pendingChoice}><legend>{tr(kind === "style" ? "写作风格" : "写作要求")}</legend>
        {!rows.length && <p>{tr("暂无资料，可在风格档案中新建。")}</p>}
        {rows.map(item => <div className="writing-choice" key={item.id}>
          <label><input type="checkbox" checked={selected[field].includes(item.id)} disabled={!item.body.trim()} onChange={event => void choose({ ...selected, [field]: event.target.checked ? [...selected[field], item.id] : selected[field].filter(id => id !== item.id) })} />{item.title}</label>
          {item.body.trim() ? <details><summary>{tr("查看内容")}</summary><div className="writing-profile-text">{item.body}</div></details> : <small>{tr("请先填写或蒸馏内容")}</small>}
        </div>)}
      </fieldset>;
    })}
    <p className="writing-help">{tr("可选择多条，也可全部取消；只发送选中的内容，不发送蒸馏原文。")}</p>
  </section>;
}

type Draft = Partial<WritingProfile> & Pick<WritingProfile, "kind" | "title" | "body" | "source" | "sourceName">;
export default function WritingProfiles({ book, busy, onChanged, beforeChange, onGenerate, notify }: {
  book: Book; busy: boolean; onChanged: (book: Book) => void; beforeChange: () => Promise<void>;
  onGenerate: (id: string) => Promise<void>; notify: (message: string) => void;
}) {
  const [kind, setKind] = useState<"style" | "requirement">("style");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [remove, setRemove] = useState<WritingProfile | null>(null);
  const rows = (book.writingProfiles || []).filter(item => item.kind === kind);
  function open(item?: WritingProfile) { setError(""); setDraft(item ? { ...item } : { kind, title: "", body: "", source: "", sourceName: "" }); }
  async function perform(task: () => Promise<void>) {
    setSaving(true); setError("");
    try { await beforeChange(); await task(); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  async function save(distill = false) {
    if (!draft) return;
    const input = draft;
    await perform(async () => {
      const saved = await api<Book>("writing:save", { bookId: book.id, profile: input });
      const id = input.id || saved.writingProfiles!.at(-1)!.id;
      onChanged(saved); setDraft(null);
      if (distill) await onGenerate(id);
    });
  }
  async function importFile(source: boolean) {
    if (!draft) return;
    await perform(async () => {
      const file = await api<{ name: string; title: string; body: string } | null>("writing:import", { source, kind: draft.kind });
      if (file) setDraft(value => value ? { ...value, title: value.title || file.title, ...(source ? { source: file.body, sourceName: file.name } : { body: file.body }) } : value);
    });
  }
  return <section className="writing-library" aria-label={tr("写作资料库")}>
    <div className="writing-section-head"><div><h3>{tr("写作资料库")}</h3><p>{tr("手写可复用的风格与要求，或从文章中蒸馏。生成时再选择要使用的条目。")}</p></div><Button onClick={() => open()} disabled={busy || saving}><Plus size={16} />{tr(kind === "style" ? "新建写作风格" : "新建写作要求")}</Button></div>
    <div className="writing-tabs" role="tablist" aria-label={tr("写作资料类型")}>
      {(["style", "requirement"] as const).map(value => <button role="tab" aria-selected={kind === value} key={value} onClick={() => setKind(value)}>{tr(value === "style" ? "写作风格" : "写作要求")} <small>{(book.writingProfiles || []).filter(item => item.kind === value).length}</small></button>)}
    </div>
    {!rows.length && <div className="writing-empty"><p>{tr(kind === "style" ? "还没有自定义风格。可以描述叙事视角、语言、对白与节奏。" : "还没有写作要求。可以写下结构、段落、禁用表达和质量标准。")}</p><Button variant="primary-soft" onClick={() => open()} disabled={busy || saving}>{tr("添加第一条")}</Button></div>}
    {rows.map(item => <article className="writing-profile-row" key={item.id}>
      <div className="writing-section-head"><h4>{item.title}</h4><span className="writing-row-actions">
        <Button disabled={busy || saving} onClick={() => open(item)}><PencilSimple size={15} />{tr("编辑")}</Button>
        <Button disabled={busy || saving || !item.source.trim()} onClick={() => void onGenerate(item.id)}><Sparkle size={15} />{tr("AI 蒸馏")}</Button>
        <Button disabled={saving} onClick={() => void perform(async () => { const file = await api<string | null>("writing:export", { bookId: book.id, id: item.id }); if (file) notify(tr("写作资料已导出")); })}><Export size={15} />{tr("导出")}</Button>
        <Button disabled={busy || saving} onClick={() => { setError(""); setRemove(item); }}><Trash size={15} />{tr("删除")}</Button>
      </span></div>
      <p className="writing-row-preview">{item.body || tr("已保存原文，等待蒸馏")}</p>
      <details><summary>{tr("查看完整资料")}</summary><div className="writing-profile-text">{item.body}</div>{item.source && <details><summary>{tr("蒸馏参考原文")}{item.sourceName ? ` · ${item.sourceName}` : ""}</summary><div className="writing-profile-text">{item.source}</div></details>}</details>
    </article>)}
    {!!book.writingProfileTrash?.length && <details className="writing-trash"><summary>{tr("已删除的风格与要求")} · {book.writingProfileTrash.length}</summary>{book.writingProfileTrash.map(item => <div key={item.id} className="writing-section-head"><span>{item.title}</span><Button disabled={saving || busy} onClick={() => void perform(async () => onChanged(await api<Book>("writing:restore", { bookId: book.id, id: item.id })))}><ArrowCounterClockwise size={15} />{tr("恢复")}</Button></div>)}</details>}
    {error && !draft && !remove && <p role="alert" className="error-message">{error}</p>}
    {draft && <Modal title={tr(draft.kind === "style" ? "编辑写作风格" : "编辑写作要求")} wide onClose={() => !saving && setDraft(null)}>
      <div className="modal-body writing-profile-editor">
        <Field label={tr("名称")}><input maxLength={120} value={draft.title} disabled={saving} onChange={event => setDraft({ ...draft, title: event.target.value })} /></Field>
        <Field label={tr(draft.kind === "style" ? "风格内容" : "要求内容")} hint={tr("这里的内容在选中后用于生成。导入文件后可继续编辑。") }><textarea rows={8} disabled={saving} value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} /></Field>
        <Button disabled={saving} onClick={() => void importFile(false)}><UploadSimple size={16} />{tr("导入风格或要求文件")}</Button>
        <details className="writing-source-editor" open={!draft.body.trim()}><summary>{tr("从文章蒸馏")}</summary><p>{tr("导入或粘贴原文。AI 结果先预览，采用后才替换当前条目。")}</p>
          <Button disabled={saving} onClick={() => void importFile(true)}><UploadSimple size={16} />{tr("导入蒸馏原文")}</Button>
          <Field label={tr("蒸馏参考原文")} hint={draft.sourceName}><textarea rows={7} value={draft.source} disabled={saving} onChange={event => setDraft({ ...draft, source: event.target.value })} /></Field>
        </details>
        {!!draft.history?.length && <details><summary>{tr("历史内容")}</summary>{draft.history.map((item, index) => <div className="writing-history" key={index}><strong>{item.title}</strong><div className="writing-profile-text">{item.body}</div><Button disabled={saving} onClick={() => setDraft({ ...draft, title: item.title, body: item.body })}>{tr("载入此版本")}</Button></div>)}</details>}
        {error && <p role="alert" className="error-message">{error}</p>}
      </div>
      <div className="modal-footer"><Button disabled={saving} onClick={() => setDraft(null)}>{tr("取消")}</Button><Button disabled={saving || busy || !draft.source.trim()} onClick={() => void save(true)}><Sparkle size={16} />{tr("保存并蒸馏")}</Button><Button variant="primary" busy={saving} onClick={() => void save()}>{tr("保存资料")}</Button></div>
    </Modal>}
    {remove && <Modal title={tr("删除写作资料？")} onClose={() => !saving && setRemove(null)}><div className="modal-body"><p>{remove.title}</p><p>{tr("条目会移入已删除资料，并从生成选择中移除。已有正文和候选稿保留。")}</p>{error && <p role="alert" className="error-message">{error}</p>}</div><div className="modal-footer"><Button disabled={saving} onClick={() => setRemove(null)}>{tr("取消")}</Button><Button variant="danger" busy={saving} onClick={() => void perform(async () => { onChanged(await api<Book>("writing:delete", { bookId: book.id, id: remove.id, revision: remove.revision })); setRemove(null); })}>{tr("删除")}</Button></div></Modal>}
  </section>;
}
