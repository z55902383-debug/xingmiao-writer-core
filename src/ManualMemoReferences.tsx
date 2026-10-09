import { useId, useMemo, useRef, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { splitMemoSections } from "../electron/memo-sections.mjs";
import type { MemoNote } from "./types";
import { count, number } from "./api";
import { tr } from "./i18n";
import { Button, Modal } from "./ui";
import "./manual-memo-references.css";

export type MemoReferenceChoice = {
  mode: "all" | "parts";
  blockIds: string[];
  blockSource: string;
  fragments: { start: number; end: number; text: string }[];
  fragmentSource: string;
};
export const emptyMemoReference = (): MemoReferenceChoice => ({
  mode: "all", blockIds: [], blockSource: "", fragments: [], fragmentSource: "",
});
export function memoReferenceOptions(notes: MemoNote[]) {
  const totals = new Map<string, number>(), seen = new Map<string, number>();
  for (const note of notes) totals.set(note.title, (totals.get(note.title) || 0) + 1);
  return notes.map((note) => {
    const title = note.title || tr("未命名备忘录");
    const index = (seen.get(note.title) || 0) + 1;
    seen.set(note.title, index);
    const preview = note.content.replace(/\s+/g, " ").trim().slice(0, 32);
    return { id: note.id, label: (totals.get(note.title) || 0) > 1
      ? `${title} · ${number(index)}${preview ? " · " + preview : ""}` : title };
  });
}
function splitsCharacter(content: string, offset: number) {
  return offset > 0 && offset < content.length &&
    /[\uD800-\uDBFF]/.test(content[offset - 1]) && /[\uDC00-\uDFFF]/.test(content[offset]);
}
function validFragment(content: string, fragment: MemoReferenceChoice["fragments"][number]) {
  return Number.isInteger(fragment.start) && Number.isInteger(fragment.end) &&
    fragment.start >= 0 && fragment.end > fragment.start && fragment.end <= content.length &&
    !splitsCharacter(content, fragment.start) && !splitsCharacter(content, fragment.end) &&
    content.slice(fragment.start, fragment.end) === fragment.text && !!fragment.text.trim();
}
export function resolveMemoReference(content: string, choice: MemoReferenceChoice) {
  if (choice.mode === "all") return { ranges: [], count: 0, invalidCount: 0 };
  const blocks = new Map(splitMemoSections(content).map((block) => [block.id, block]));
  const ranges: { start: number; end: number }[] = [];
  let invalidCount = 0;
  for (const id of choice.blockIds) {
    const block = blocks.get(id);
    // Repeated identical blocks can change occurrence IDs after an edit.
    // Require the chosen source so an old ID cannot point to another character's note.
    if (block && choice.blockSource === content) ranges.push({ start: block.start, end: block.end });
    else invalidCount++;
  }
  for (const fragment of choice.fragments) {
    if (choice.fragmentSource === content && validFragment(content, fragment))
      ranges.push({ start: fragment.start, end: fragment.end });
    else invalidCount++;
  }
  const selectedCount = choice.blockIds.length + choice.fragments.length;
  if (selectedCount > 100) invalidCount += selectedCount - 100;
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const union: typeof ranges = [];
  for (const range of ranges) {
    const previous = union[union.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else union.push({ ...range });
  }
  return { ranges: union, count: selectedCount, invalidCount };
}
// Textareas normalize CRLF to LF. Map their selection back to the unchanged source.
function sourceOffset(source: string, displayedOffset: number) {
  let raw = 0, displayed = 0;
  while (raw < source.length && displayed < displayedOffset) {
    raw += source[raw] === "\r" && source[raw + 1] === "\n" ? 2 : 1;
    displayed++;
  }
  return raw;
}

export default function MemoReferencePicker({ memo: initialMemo, notes = [], choices = {}, value, onApply, onClose }: {
  memo: MemoNote;
  notes?: MemoNote[];
  choices?: Record<string, MemoReferenceChoice>;
  value: MemoReferenceChoice;
  onApply: (choice: MemoReferenceChoice, memoId: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const [memoId, setMemoId] = useState(initialMemo.id);
  const [drafts, setDrafts] = useState<Record<string, MemoReferenceChoice>>(() => ({
    [initialMemo.id]: { ...value, blockIds: [...value.blockIds], fragments: value.fragments.map((fragment) => ({ ...fragment })) },
  }));
  const available = notes.length ? notes.map((note) => note.id === initialMemo.id ? initialMemo : note) : [initialMemo];
  const selectedMemo = available.find((note) => note.id === memoId);
  const memo = selectedMemo || { ...initialMemo, id: memoId, title: "", content: "" };
  const draft = Object.hasOwn(drafts, memoId) ? drafts[memoId]
    : Object.hasOwn(choices, memoId) ? choices[memoId] : emptyMemoReference();
  const setDraft = (choice: MemoReferenceChoice) => setDrafts((old) => ({ ...old, [memoId]: choice }));
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const original = useRef<HTMLTextAreaElement>(null);
  const blocks = useMemo(() => splitMemoSections(memo.content), [memo.content]);
  const matching = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return blocks.filter((block) => !needle ||
      (block.section + "\n" + block.label + "\n" + memo.content.slice(block.start, block.end)).toLocaleLowerCase().includes(needle));
  }, [blocks, query, memo.content]);
  const resolved = resolveMemoReference(memo.content, draft);
  const selectedText = draft.mode === "all" ? memo.content :
    resolved.ranges.map((range) => memo.content.slice(range.start, range.end)).join("\n\n");
  const canApply = !!selectedMemo && (draft.mode === "all" || (resolved.ranges.length > 0 && !resolved.invalidCount));

  async function apply() {
    if (!canApply || applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    setError("");
    try {
      await onApply({ ...draft, blockIds: [...draft.blockIds], fragments: draft.fragments.map((fragment) => ({ ...fragment })) }, memo.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("操作失败，请重试。"));
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  }

  function toggleBlock(blockId: string, selected: boolean) {
    if (selected && draft.blockIds.length && draft.blockSource !== memo.content) {
      setError(tr("原文已变化，请先清除失效选择，再选择信息。"));
      return;
    }
    const next = selected ? [...draft.blockIds, blockId] : draft.blockIds.filter((value) => value !== blockId);
    if (next.length + draft.fragments.length > 100) {
      setError(tr("一次最多选择100项内容。"));
      return;
    }
    setError("");
    setDraft({ ...draft, blockIds: [...new Set(next)], blockSource: selected ? memo.content : draft.blockSource });
  }
  function selectMatching() {
    if (draft.blockIds.length && draft.blockSource !== memo.content) {
      setError(tr("原文已变化，请先清除失效选择，再选择信息。"));
      return;
    }
    const next = [...new Set([...draft.blockIds, ...matching.map((block) => block.id)])];
    if (next.length + draft.fragments.length > 100) {
      setError(tr("一次最多选择100项内容。"));
      return;
    }
    setError("");
    setDraft({ ...draft, blockIds: next, blockSource: memo.content });
  }
  function clearInvalid() {
    const ids = new Set(blocks.map((block) => block.id));
    const fragments = draft.fragmentSource === memo.content
      ? draft.fragments.filter((fragment) => validFragment(memo.content, fragment)) : [];
    const blockIds = draft.blockSource === memo.content ? draft.blockIds.filter((value) => ids.has(value)) : [];
    setDraft({ ...draft, blockIds, blockSource: blockIds.length ? memo.content : "",
      fragments, fragmentSource: fragments.length ? draft.fragmentSource : "" });
    setError("");
  }
  function addFragment() {
    const field = original.current;
    if (!field) return;
    if (draft.fragments.length && draft.fragmentSource !== memo.content) {
      setError(tr("原文已变化，请先清除失效选择，再选取文字。"));
      return;
    }
    const start = sourceOffset(memo.content, field.selectionStart);
    const end = sourceOffset(memo.content, field.selectionEnd);
    const fragment = { start, end, text: memo.content.slice(start, end) };
    if (!validFragment(memo.content, fragment)) {
      setError(tr("请先选中要引用的完整文字或表情。"));
      return;
    }
    if (draft.fragments.some((value) => value.start === start && value.end === end)) {
      setError(tr("这段文字已在选择中。"));
      return;
    }
    if (resolved.count >= 100) {
      setError(tr("一次最多选择100项内容。"));
      return;
    }
    setDraft({ ...draft, fragments: [...draft.fragments, fragment], fragmentSource: memo.content });
    setError("");
  }
  return (
    <Modal title={tr("选择备忘录参考内容")} wide onClose={() => !applyingRef.current && onClose()}>
      <div className="mt-reference-body" inert={applying} aria-busy={applying}>
        <div className="mt-reference-note-select">
          <label htmlFor={id + "-memo"}>{tr("选择脑洞或备忘录")}</label>
          <select id={id + "-memo"} aria-label={tr("选择参考脑洞或备忘录")} value={memoId}
            onChange={(event) => { setMemoId(event.target.value); setQuery(""); setError(""); }}>
            {!selectedMemo && <option value={memoId} disabled>{tr("所选备忘录已不存在，请重新选择")}</option>}
            {memoReferenceOptions(available).map((note) => <option key={note.id} value={note.id}>{note.label}</option>)}
          </select>
          <span>{tr("{0} 条脑洞或备忘录", {0: available.length})}</span>
        </div>
        {!selectedMemo && <p className="mt-reference-error" role="alert">{tr("所选备忘录已不存在，请重新选择")}</p>}
        <div className="mt-reference-modes" role="radiogroup" aria-label={tr("参考范围")}>
          {(["all", "parts"] as const).map((mode) => (
            <label key={mode}>
              <input type="radio" name={id} checked={draft.mode === mode}
                onChange={() => { setDraft({ ...draft, mode }); setError(""); }} />
              {mode === "all" ? tr("整篇备忘录") : tr("指定内容")}
            </label>
          ))}
        </div>
        <p className="mt-reference-hint">{draft.mode === "all"
          ? tr("围绕当前备忘录的全部内容构思。")
          : tr("勾选需要讨论的信息，也可以从原文选取文字。")}</p>
        {draft.mode === "parts" && <>
          <input type="search" aria-label={tr("搜索参考内容")}
            placeholder={tr("搜索段落、标题或内容")} value={query}
            onChange={(event) => setQuery(event.target.value)} />
          <div className="mt-reference-toolbar">
            <span>{tr("{0} 项信息", { 0: number(matching.length) })}</span>
            <Button disabled={!matching.length} onClick={selectMatching}>
              {query.trim() ? tr("全选搜索结果") : tr("全选")}
            </Button>
            <Button onClick={() => { setDraft({ ...draft, blockIds: [], blockSource: "", fragments: [], fragmentSource: "" }); setError(""); }}>
              {tr("清空选择")}
            </Button>
          </div>
          <div className="mt-reference-list" aria-label={tr("可选参考内容")}>
            {matching.length ? matching.map((block, index) => {
              const raw = memo.content.slice(block.start, block.end);
              const fence = /^[ \t]*(?:`{3,}|~{3,})(.*)/.exec(raw);
              const label = fence ? (fence[1].trim() ? tr("代码：{0}", {0: fence[1].trim()}) : tr("代码片段")) : block.label;
              const heading = /^ {0,3}#{1,6}\s/.test(raw) || /\n {0,3}(?:=+|-{3,})[ \t]*$/.test(raw);
              const preview = raw.replace(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/, "").trim();
              return (
                <div className="mt-reference-item" key={block.id}>
                  <input id={id + "-block-" + index} data-reference-block={block.id}
                    type="checkbox" checked={draft.blockIds.includes(block.id)}
                    onChange={(event) => toggleBlock(block.id, event.target.checked)} />
                  <label htmlFor={id + "-block-" + index}>
                    {!heading && block.section && <small>{block.section}</small>}
                    <strong>{label}</strong>
                    {!heading && preview !== label && <span>{raw.length > 180 ? raw.slice(0, 180) + "…" : raw}</span>}
                  </label>
                  {raw.length > 180 && <details>
                    <summary>{tr("查看完整内容")}</summary><pre>{raw}</pre>
                  </details>}
                </div>
              );
            }) : <p className="mt-reference-hint">{tr("没有找到匹配的信息。")}</p>}
          </div>
          {draft.fragments.length > 0 && <div className="mt-reference-fragments" aria-label={tr("自选文字片段")}>
            {draft.fragments.map((fragment, index) => (
              <div key={index}>
                <span>{fragment.text}</span>
                <Button aria-label={tr("移除片段 {0}", { 0: index + 1 })}
                  onClick={() => setDraft({ ...draft, fragments: draft.fragments.filter((_, at) => at !== index) })}>
                  <Trash size={14} />{tr("移除")}
                </Button>
              </div>
            ))}
          </div>}
          <details className="mt-reference-original">
            <summary>{tr("从原文选取")}</summary>
            <p className="mt-reference-hint">{tr("选中一段文字后添加，可重复添加多个片段。")}</p>
            <textarea ref={original} aria-label={tr("备忘录原文")} readOnly value={memo.content} rows={6} spellCheck={false} />
            <Button onClick={addFragment}>{tr("添加选中文字")}</Button>
          </details>
        </>}
        {draft.mode === "parts" && resolved.invalidCount > 0 && <div className="mt-reference-warning" role="alert">
          <p>{tr("有 {0} 项参考已变化，请重新选择。", { 0: resolved.invalidCount })}</p>
          <Button onClick={clearInvalid}>{tr("清除失效选择")}</Button>
        </div>}
        {error && <p className="mt-reference-error" role="alert">{tr(error)}</p>}
      </div>
      <div className="modal-footer mt-reference-footer">
        <span role="status">{draft.mode === "all" ? tr("整篇备忘录") : tr("已选 {0} 项内容", {0: resolved.count})}
          {" · "}{number(count(selectedText))} {tr("字")}</span>
        <Button disabled={applying} onClick={onClose}>{tr("取消")}</Button>
        <Button variant="primary" disabled={!canApply} busy={applying} onClick={() => void apply()}>
          {tr("确定")}
        </Button>
      </div>
    </Modal>
  );
}
