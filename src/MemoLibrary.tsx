import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Copy,
  MagnifyingGlass,
  NotePencil,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import { Button, IconButton } from "./ui";
import { MemoCategoryInput, MemoCategoryFilter } from "./MemoCategory";
import { memoCategory } from "../electron/memo-metadata.mjs";
import { copyText } from "./api";
import { tr } from "./i18n";
import type { MemoNote } from "./types";
import "./memo-library.css";

export default function MemoLibrary({
  notes,
  bookTitle,
  selectedId,
  onSelect,
  onChange,
  onDelete,
  notify,
  drawer = false,
}: {
  notes: MemoNote[];
  bookTitle: string;
  selectedId: string;
  onSelect: (id: string) => void;
  onChange: (notes: MemoNote[]) => void;
  onDelete?: (note: MemoNote) => void;
  notify: (message: string) => void;
  drawer?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("updated");
  const [reading, setReading] = useState(false);
  const [selection, setSelection] = useState({ id: "", start: 0, end: 0 });
  useEffect(() => {
    if (selectedId) setReading(true);
  }, [selectedId]);
  const visible = useMemo(
    () =>
      notes
        .filter(
          (note) =>
            (!category || memoCategory(note) === category) &&
            `${note.title} ${memoCategory(note)} ${note.content}`
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase()),
        )
        .sort((a, b) =>
          sort === "title"
            ? a.title.localeCompare(b.title)
            : b.updatedAt.localeCompare(a.updatedAt),
        ),
    [notes, category, search, sort],
  );
  // Keep an active draft stable if editing changes whether it matches the filter.
  const selected = notes.find((note) => note.id === selectedId) || visible[0];
  const choose = (id: string) => {
    onSelect(id);
    setReading(true);
    setSelection({ id, start: 0, end: 0 });
  };
  const reset = () => {
    setSearch("");
    setCategory("");
    onSelect("");
  };
  const create = () => {
    const now = new Date().toISOString();
    const note: MemoNote = {
      id: crypto.randomUUID(),
      title: "新备忘录",
      category: category || undefined,
      content: "",
      createdAt: now,
      updatedAt: now,
    };
    setSearch("");
    onChange([note, ...notes]);
    choose(note.id);
  };
  const update = (patch: Partial<MemoNote>) => {
    if (!selected) return;
    onSelect(selected.id);
    onChange(
      notes.map((note) =>
        note.id === selected.id
          ? { ...note, ...patch, updatedAt: new Date().toISOString() }
          : note,
      ),
    );
  };
  const copy = async (text: string) => {
    try {
      await copyText(text);
      notify(tr("已复制备忘录内容，可粘贴到当前编辑内容中"));
    } catch {
      notify(tr("复制失败，请手动选择内容复制"));
    }
  };
  const hasSelection =
    selected && selection.id === selected.id && selection.end > selection.start;
  return (
    <div className={`memo-library${reading ? " is-reading" : ""}`}>
      <div className="memo-library-grid">
        <aside className="memo-browser" aria-label={tr("备忘录列表")}>
          <div className="memo-browser-tools">
            <div className="memo-browser-heading">
              <strong>{tr("备忘录")}</strong>
              <span>
                {visible.length} / {notes.length}
              </span>
              <Button onClick={create}>
                <Plus size={15} />
                {tr("新建")}
              </Button>
            </div>
            <label className="memo-browser-search">
              <MagnifyingGlass size={16} />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  onSelect("");
                }}
                aria-label={tr("搜索备忘录")}
                placeholder={tr("搜索标题、分类或正文")}
              />
              {search && (
                <IconButton
                  label={tr("清除搜索")}
                  onClick={() => {
                    setSearch("");
                    onSelect("");
                  }}
                >
                  <X size={14} />
                </IconButton>
              )}
            </label>
            <MemoCategoryFilter
              notes={notes}
              value={category}
              onChange={(value) => {
                setCategory(value);
                onSelect("");
              }}
            />
            <select
              className="memo-browser-sort"
              aria-label={tr("备忘录排序")}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="updated">{tr("最近更新优先")}</option>
              <option value="title">{tr("按标题排序")}</option>
            </select>
          </div>
          <div
            className="memo-browser-items"
            tabIndex={0}
            aria-label={tr("备忘录列表")}
          >
            {visible.map((note) => (
              <button
                type="button"
                key={note.id}
                className={`memo-browser-item${selected?.id === note.id ? " active" : ""}`}
                aria-pressed={selected?.id === note.id}
                onClick={() => choose(note.id)}
              >
                <strong title={note.title}>
                  {note.title || tr("未命名备忘录")}
                </strong>
                <span className="memo-browser-meta">
                  <span>{tr(memoCategory(note))}</span>
                  <time dateTime={note.updatedAt}>
                    {new Date(note.updatedAt).toLocaleDateString(undefined, {
                      month: "numeric",
                      day: "numeric",
                    })}
                  </time>
                </span>
                <small>
                  {note.content
                    .replace(/[#*`>]/g, "")
                    .trim()
                    .slice(0, 100) || tr("空白备忘录")}
                </small>
              </button>
            ))}
            {!visible.length && (
              <div className="memo-browser-empty">
                <NotePencil size={23} />
                <p>
                  {tr(notes.length ? "没有匹配的备忘录" : "先收下一条灵感")}
                </p>
                {notes.length > 0 && (
                  <Button onClick={reset}>{tr("清除筛选")}</Button>
                )}
              </div>
            )}
          </div>
        </aside>
        {selected ? (
          <section
            className="memo-detail"
            key={selected.id}
            aria-label={tr("备忘录编辑")}
          >
            <div className="memo-detail-actions">
              <button
                className="memo-browser-back"
                onClick={() => setReading(false)}
              >
                <ArrowLeft size={15} />
                {tr("返回列表")}
              </button>
              <span className="memo-detail-save" title={bookTitle}>
                {tr("自动保存到「")}
                {bookTitle}」
              </span>
              <Button
                disabled={!selected.content.trim()}
                onClick={() => void copy(selected.content)}
              >
                <Copy size={15} />
                {tr("复制内容")}
              </Button>
              {onDelete && (
                <IconButton
                  label={tr("删除备忘录")}
                  onClick={() => onDelete(selected)}
                >
                  <Trash size={16} />
                </IconButton>
              )}
            </div>
            <div className="memo-detail-fields">
              <label className="memo-detail-title">
                <span>{tr("标题")}</span>
                <input
                  aria-label={tr("备忘录标题")}
                  value={selected.title}
                  maxLength={160}
                  onChange={(e) => update({ title: e.target.value })}
                  placeholder={tr("给灵感起个标题")}
                />
              </label>
              <div className="memo-detail-category">
                <MemoCategoryInput
                  value={memoCategory(selected)}
                  onChange={(value) => update({ category: value })}
                />
                {selected.sourceToolName && (
                  <small>
                    {tr("来源工具：{0}", { 0: tr(selected.sourceToolName) })}
                  </small>
                )}
              </div>
            </div>
            <textarea
              className="memo-detail-content"
              aria-label={tr(
                drawer ? "备忘录内容，可粘贴生成结果" : "备忘录内容",
              )}
              value={selected.content}
              onChange={(e) => {
                setSelection({ id: selected.id, start: 0, end: 0 });
                update({ content: e.target.value });
              }}
              onSelect={(e) => {
                const el = e.currentTarget;
                setSelection({
                  id: selected.id,
                  start: el.selectionStart,
                  end: el.selectionEnd,
                });
              }}
              placeholder={tr(
                "在这里粘贴创意工具箱的生成结果，或记下写作灵感…",
              )}
            />
            <footer className="memo-detail-footer">
              <span>
                {selected.content.length.toLocaleString()} {tr("字")}
              </span>
              <Button
                disabled={!hasSelection}
                onClick={() =>
                  void copy(
                    selected.content.slice(selection.start, selection.end),
                  )
                }
              >
                {tr("复制选中文字")}
              </Button>
            </footer>
          </section>
        ) : (
          <section className="memo-detail-empty">
            <NotePencil size={32} />
            <p>{tr(notes.length ? "没有匹配的备忘录" : "先收下一条灵感")}</p>
            <Button onClick={notes.length ? reset : create}>
              {tr(notes.length ? "清除筛选" : "新建备忘录")}
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}
