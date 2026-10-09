import { useState } from "react";
import { Plus, PencilSimple, Trash, UploadSimple, Export, Sparkle, ArrowCounterClockwise, DotsThree, Check, CaretDown } from "@phosphor-icons/react";
import { api } from "./api";
import { tr } from "./i18n";
import { Button, Field, Modal, Menu } from "./ui";
import type { Book, WritingProfile, WritingSelection } from "./types";
import "./writing-profiles.css";

export function profileRows(book: Book): WritingProfile[] {
  return book.style.trim() ? [{ id: "legacy-book-style", kind: "style", title: tr("本书风格档案"), body: book.style, source: book.reference, sourceName: book.referenceName, revision: 1 }, ...(book.writingProfiles || [])] : book.writingProfiles || [];
}
export function profileSelection(book: Book): WritingSelection {
  return book.writingSelection || { styleIds: book.style.trim() ? ["legacy-book-style"] : [], requirementIds: [] };
}
export function WritingPicker({ book, disabled, onSelect, onManage, open, onToggle, sourceOnly = false }: { book: Book; disabled: boolean; onSelect: (selection: WritingSelection) => Promise<void>; onManage: () => void; open: boolean; onToggle: () => void; sourceOnly?: boolean }) {
  const [pendingChoice, setPendingChoice] = useState<WritingSelection | null>(null);
  const [query, setQuery] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [pickerKind, setPickerKind] = useState<"style" | "requirement">("style");
  const selected = pendingChoice || profileSelection(book);
  const all = profileRows(book);
  const chosen = all.filter(item => selected[item.kind === "style" ? "styleIds" : "requirementIds"].includes(item.id));
  async function choose(value: WritingSelection) { setPendingChoice(value); try { await onSelect(value); } finally { setPendingChoice(null); } }
  return <section className="writing-picker" aria-label={tr("风格参考")}>
    <button className="writing-picker-toggle" aria-expanded={open} aria-controls="writing-picker-options" onClick={onToggle}><PaintPickerIcon/><span><strong>{tr("选择写作风格与要求")}</strong><small>{tr("风格 {0} · 要求 {1}", { 0: selected.styleIds.length, 1: selected.requirementIds.length })}</small></span><CaretDown size={16}/></button>
    <p className="writing-picker-intro">{tr("生成前可多选，决定这次怎么写。")}</p>
    {sourceOnly && <p className="writing-picker-intro">{tr("当前蒸馏只分析目标原文；所选风格与要求用于后续创作。")}</p>}
    {chosen.length ? <div className="writing-selected-preview" aria-label={tr("已选风格与要求")}>{chosen.slice(0, 2).map(item => <span key={item.id} title={item.title}><Check size={12}/><span>{item.title}</span></span>)}{chosen.length > 2 && <span>{tr("另 {0} 项", { 0: chosen.length - 2 })}</span>}</div> : <p className="writing-selection-empty">{tr("未选择风格或要求，可按默认写法生成。")}</p>}
    {open && <div id="writing-picker-options" className="writing-picker-options">
    <div className="writing-section-head"><strong>{tr("从资料库选择")}</strong><Button variant="ghost" onClick={onManage}>{tr("管理风格与要求")}</Button></div>
    <Field label={tr("搜索风格或要求名称")}><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={tr("名称或来源文件名")} /></Field>
    <label className="writing-selected-filter"><input type="checkbox" checked={onlySelected} onChange={event => setOnlySelected(event.target.checked)}/>{tr("只看已选")}</label>
    <div className="writing-picker-tabs" role="tablist" aria-label={tr("选择资料类型")}>{(["style", "requirement"] as const).map(kind => <button key={kind} id={`writing-choice-${kind}-tab`} role="tab" aria-selected={pickerKind === kind} aria-controls="writing-choice-group" onClick={() => { setPickerKind(kind); setQuery(""); }}>{tr(kind === "style" ? "写作风格" : "写作要求")}<small>{selected[kind === "style" ? "styleIds" : "requirementIds"].length}</small></button>)}</div>
    {[pickerKind].map(kind => {
      const field = kind === "style" ? "styleIds" : "requirementIds";
      const available = all.filter(item => item.kind === kind);
      const rows = available.filter(item => (!onlySelected || selected[field].includes(item.id)) && `${item.title} ${item.sourceName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
      const selectedRows = rows.filter(item => selected[field].includes(item.id)), otherRows = rows.filter(item => !selected[field].includes(item.id));
      return <fieldset role="tabpanel" id="writing-choice-group" aria-labelledby={`writing-choice-${kind}-tab`} key={kind} disabled={disabled || !!pendingChoice}><legend>{tr(kind === "style" ? "写作风格" : "写作要求")}<small>{tr("已选 {0}/{1}", { 0: selected[field].length, 1: available.length })}</small></legend>
        <div className="writing-picker-group-head"><span>{tr(kind === "style" ? "视角、语言、对白与节奏" : "结构、段落与质量标准")}</span><Button variant="ghost" disabled={!selected[field].length} onClick={() => void choose({ ...selected, [field]: [] })}>{tr(kind === "style" ? "清空风格" : "清空要求")}</Button></div>
        {!rows.length && <p>{tr(!available.length ? "暂无资料，可在风格档案中新建。" : "没有匹配的条目，可清除搜索或取消只看已选。")}</p>}
        <div className="writing-choice-list">{[["已选", selectedRows], ["可选择", otherRows]].map(([label, entries]) => {
          const items = entries as WritingProfile[];
          return items.length ? <div className="writing-choice-group" key={label as string}><p>{tr(label as string)} · {items.length}</p>{items.map(item => <div className={`writing-choice ${selected[field].includes(item.id) ? "is-selected" : ""}`} key={item.id}>
          <label><input type="checkbox" aria-label={item.title} checked={selected[field].includes(item.id)} disabled={!item.body.trim() || (selected[field].length >= 30 && !selected[field].includes(item.id))} onChange={event => void choose({ ...selected, [field]: event.target.checked ? [...selected[field], item.id] : selected[field].filter(id => id !== item.id) })} /><span title={item.title}>{item.title}</span></label>
          {item.id === "legacy-book-style" && <small>{tr("本书原有档案")}</small>}
          {item.body.trim() ? <details><summary>{tr("查看内容")}</summary><div className="writing-profile-text">{item.body}</div></details> : <small>{tr("请先填写或蒸馏内容")}</small>}
        </div>)}</div> : null;
        })}</div>
        {selected[field].length >= 30 && <p>{tr("每类最多选择 30 条，可先取消部分条目。")}</p>}
      </fieldset>;
    })}
    <p className="writing-help">{tr("可选择多条，也可全部取消；只发送选中的内容，不发送蒸馏原文。")}</p>
    </div>}
  </section>;
}
function PaintPickerIcon() { return <Sparkle size={18} aria-hidden="true"/>; }

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
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState("all");
  const selection = profileSelection(book);
  const availableRows = (book.writingProfiles || []).filter(item => item.kind === kind);
  const rows = availableRows.filter(item => `${item.title} ${item.sourceName}`.toLocaleLowerCase().includes(libraryQuery.trim().toLocaleLowerCase()) && (libraryFilter === "all" || libraryFilter === "pending" ? libraryFilter === "all" || !item.body.trim() : selection[kind === "style" ? "styleIds" : "requirementIds"].includes(item.id)));
  function open(item?: WritingProfile) { setError(""); if (!item) { setLibraryQuery(""); setLibraryFilter("all"); } setDraft(item ? { ...item } : { kind, title: "", body: "", source: "", sourceName: "" }); }
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
    <div className="writing-section-head writing-library-heading"><div><span className="writing-eyebrow">{tr("可添加多条 · 生成时自由组合")}</span><h3>{tr("写作资料库")}</h3><p>{tr("手写或导入资料，也可用 AI 从文章中蒸馏。保存后，在助手的「风格参考」中选择使用。")}</p></div><Button variant="primary-soft" onClick={() => open()} disabled={busy || saving}><Plus size={16} />{tr(kind === "style" ? "新建写作风格" : "新建写作要求")}</Button></div>
    <div className="writing-tabs" role="tablist" aria-label={tr("写作资料类型")}>
      {(["style", "requirement"] as const).map(value => <button role="tab" aria-selected={kind === value} key={value} onClick={() => setKind(value)}>{tr(value === "style" ? "写作风格" : "写作要求")} <small>{(book.writingProfiles || []).filter(item => item.kind === value).length}</small></button>)}
    </div>
    <p className="writing-type-description">{tr(kind === "style" ? "写作风格：决定文章的语感，包括叙事视角、句式、对白与节奏。" : "写作要求：规定文章的标准，包括结构、段落、禁用表达与质量检查。")}</p>
    {!!availableRows.length && <div className="writing-library-search"><Field label={tr("搜索此类资料")}><input type="search" value={libraryQuery} onChange={event => setLibraryQuery(event.target.value)} placeholder={tr("名称或来源文件名")}/></Field><Field label={tr("资料状态")}><select value={libraryFilter} onChange={event => setLibraryFilter(event.target.value)}><option value="all">{tr("全部资料")}</option><option value="selected">{tr("已选用")}</option><option value="pending">{tr("待蒸馏或填写")}</option></select></Field></div>}
    {!availableRows.length && <div className="writing-empty"><p>{tr(kind === "style" ? "还没有自定义风格。可以描述叙事视角、语言、对白与节奏。" : "还没有写作要求。可以写下结构、段落、禁用表达和质量标准。")}</p><Button variant="primary-soft" onClick={() => open()} disabled={busy || saving}>{tr("添加第一条")}</Button></div>}
    {!!availableRows.length && !rows.length && <div className="writing-empty"><p>{tr("没有匹配的资料。")}</p><Button onClick={() => { setLibraryQuery(""); setLibraryFilter("all"); }}>{tr("清除筛选")}</Button></div>}
    {rows.map(item => <article className="writing-profile-row" key={item.id}>
      <div className="writing-section-head writing-row-heading"><div className="writing-row-title"><h4>{item.title}</h4><span className={`writing-row-badge ${!item.body.trim() ? "pending" : selection[item.kind === "style" ? "styleIds" : "requirementIds"].includes(item.id) ? "selected" : ""}`}>{item.body.trim() ? selection[item.kind === "style" ? "styleIds" : "requirementIds"].includes(item.id) ? <><Check size={12}/>{tr("已选用")}</> : tr("可选用") : tr("待蒸馏或填写")}</span></div><span className="writing-row-actions">
        <Button disabled={busy || saving} onClick={() => open(item)}><PencilSimple size={15} />{tr("编辑")}</Button>
        {item.source.trim() && <Button variant={item.body.trim() ? "" : "primary-soft"} disabled={busy || saving} onClick={() => void onGenerate(item.id)}><Sparkle size={15} />{tr("AI 蒸馏")}</Button>}
        <Menu label={tr("更多操作：{0}", { 0: item.title })} trigger={<DotsThree size={19} />}>
          <button disabled={saving} onClick={() => void perform(async () => { const file = await api<string | null>("writing:export", { bookId: book.id, id: item.id }); if (file) notify(tr("写作资料已导出")); })}><Export size={15} />{tr("导出")}</button>
          <span className="menu-divider" />
          <button disabled={busy || saving} onClick={() => { setError(""); setRemove(item); }}><Trash size={15} />{tr("删除")}</button>
        </Menu>
      </span></div>
      <p className="writing-row-preview">{item.body || tr("已保存原文，等待蒸馏")}</p>
      <p className="writing-row-meta">{item.body.trim() && tr("{0} 字符", { 0: item.body.replace(/\s/g, "").length.toLocaleString() })}{item.body.trim() && item.source && " · "}{item.source && tr("蒸馏原文：{0}", { 0: item.sourceName || tr("已保存") })}</p>
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
