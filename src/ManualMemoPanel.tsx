import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowClockwise,
  ArrowsInSimple,
  ArrowsOutSimple,
  FloppyDisk,
  NotePencil,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import { count, date, number } from "./api";
import { tr } from "./i18n";
import type { BookSummary } from "./types";
import type { ManualMemoModel } from "./useManualMemos";
import { Button, Field, IconButton, Modal } from "./ui";
import "./manual-memo-view.css";

export default function ManualMemoPanel({
  books,
  model,
  onClose,
}: {
  books: BookSummary[];
  model: ManualMemoModel;
  onClose: () => void;
}) {
  const [actionError, setActionError] = useState("");
  const [working, setWorking] = useState(false);
  const actionRunning = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const titleId = useId();
  const contentId = useId();
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const expandedRef = useRef(false);
  const viewScope = useRef("");
  const scrollPositions = useRef({ normal: 0, expanded: 0 });
  const visitedExpanded = useRef(false);
  const pendingRestore = useRef<{
    start: number;
    end: number;
    direction: "forward" | "backward" | "none";
    scrollTop: number;
    focus: boolean;
  } | null>(null);
  const [remove, setRemove] = useState<{ id: string; title: string } | null>(
    null,
  );
  const locked = model.loading || model.busy || working;
  const error = actionError || model.error;
  const notes = useMemo(() => {
    const query = model.query.trim().toLocaleLowerCase();
    return model.notes.filter(
      (note) =>
        !query ||
        `${note.title}\n${note.content}`.toLocaleLowerCase().includes(query),
    );
  }, [model.notes, model.query]);

  async function run(action: () => Promise<void>) {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setWorking(true);
    setActionError("");
    try {
      await action();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : tr("操作失败，请重试。"),
      );
    } finally {
      actionRunning.current = false;
      setWorking(false);
    }
  }

  const selected = model.selected;
  const selectedScope = `${model.bookId}\u0000${selected?.id || ""}`;
  const updatedAt =
    selected && Number.isFinite(new Date(selected.updatedAt).getTime())
      ? date(selected.updatedAt)
      : "";

  const changeExpanded = useCallback((next: boolean) => {
    if (next === expandedRef.current) return;
    const textarea = contentRef.current;
    if (!textarea) return;
    const previousView = expandedRef.current ? "expanded" : "normal";
    const nextView = next ? "expanded" : "normal";
    scrollPositions.current[previousView] = textarea.scrollTop;
    if (next && !visitedExpanded.current) {
      scrollPositions.current.expanded = textarea.scrollTop;
      visitedExpanded.current = true;
    }
    pendingRestore.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
      direction: textarea.selectionDirection,
      scrollTop: scrollPositions.current[nextView],
      focus: !document.querySelector("dialog[open]"),
    };
    expandedRef.current = next;
    setExpanded(next);
  }, []);

  useLayoutEffect(() => {
    if (viewScope.current === selectedScope) return;
    viewScope.current = selectedScope;
    pendingRestore.current = null;
    scrollPositions.current = { normal: 0, expanded: 0 };
    visitedExpanded.current = false;
    expandedRef.current = false;
    setExpanded(false);
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [selectedScope]);

  useLayoutEffect(() => {
    const restore = pendingRestore.current;
    const textarea = contentRef.current;
    if (!restore || !textarea) return;
    pendingRestore.current = null;
    if (restore.focus) textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(restore.start, restore.end, restore.direction);
    // Focus and selection can scroll a textarea; restore the view afterwards.
    textarea.scrollTop = restore.scrollTop;
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const shrinkOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      changeExpanded(false);
    };
    document.addEventListener("keydown", shrinkOnEscape, true);
    return () => document.removeEventListener("keydown", shrinkOnEscape, true);
  }, [expanded, changeExpanded]);

  return (
    <aside
      className={`mt-memo-panel${expanded ? " mt-memo-expanded" : ""}`}
      aria-label={tr("作品备忘录")}
    >
      <header className="mt-side-head">
        <div>
          <NotePencil size={18} />
          <h2 title={expanded ? selected?.title : undefined}>{expanded && selected ? selected.title || tr("未命名备忘录") : tr("备忘录")}</h2>
        </div>
        <div className="mt-memo-head-actions">
          <IconButton
            label={tr("刷新备忘录")}
            disabled={locked || !model.bookId}
            onClick={() => void run(model.reload)}
          >
            <ArrowClockwise size={17} />
          </IconButton>
          <IconButton
            label={tr("收起备忘录")}
            disabled={locked}
            onClick={onClose}
          >
            <X size={18} />
          </IconButton>
        </div>
      </header>
      <div className="mt-memo-filter">
        <Field label={tr("选择作品")}>
          <select
            aria-label={tr("选择作品")}
            value={model.bookId}
            disabled={locked}
            onChange={(event) =>
              void run(() => model.selectBook(event.target.value))
            }
          >
            <option value="">{tr("请选择作品")}</option>
            {books.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title}
              </option>
            ))}
          </select>
        </Field>
        {!model.bookId && (
          <p className="mt-memo-hint">
            {tr("临时稿也可以查看作品备忘录，先选择一本作品。")}
          </p>
        )}
        <Field label={tr("搜索备忘录")}>
          <input
            type="search"
            aria-label={tr("搜索备忘录")}
            placeholder={tr("搜索标题或内容")}
            disabled={!model.bookId || model.loading}
            value={model.query}
            onChange={(event) => model.setQuery(event.target.value)}
          />
        </Field>
        <Button
          disabled={locked || !model.bookId}
          onClick={() => void run(model.create)}
        >
          <Plus size={15} />
          {tr("新建备忘录")}
        </Button>
      </div>
      {error && (
        <>
          <p className="mt-side-error" role="alert">{tr(error)}</p>
          {selected && <Button className="mt-memo-recover" disabled={locked} onClick={() => void run(model.saveAsNew)}>{tr("另存为新备忘录")}</Button>}
        </>
      )}
      <div
        className="mt-memo-list"
        aria-label={tr("备忘录列表")}
        aria-busy={model.loading}
      >
        {model.loading ? (
          <p className="mt-memo-empty" role="status">
            {tr("正在读取备忘录…")}
          </p>
        ) : notes.length ? (
          notes.map((note) => (
            <button
              key={note.id}
              type="button"
              data-memo-id={note.id}
              className={`mt-memo-note ${selected?.id === note.id ? "active" : ""}`}
              aria-pressed={selected?.id === note.id}
              disabled={locked}
              onClick={() => void run(() => model.selectNote(note.id))}
            >
              <strong>{note.title || tr("未命名备忘录")}</strong>
              <span>
                {note.content.replace(/\s+/g, " ").trim().slice(0, 80) ||
                  tr("暂无内容")}
              </span>
            </button>
          ))
        ) : (
          <p className="mt-memo-empty">
            {!model.bookId
              ? tr("选择作品后查看和记录写作灵感。")
              : model.query.trim()
                ? tr("没有找到匹配的备忘录。")
                : tr("本作品还没有备忘录，可以新建一条记录灵感。")}
          </p>
        )}
      </div>
      {selected && model.bookId && (
        <section className="mt-memo-editor" aria-label={tr("编辑备忘录")}>
          <div className="field mt-memo-title-field">
            <label htmlFor={titleId}>{tr("备忘录标题")}</label>
            <input
              id={titleId}
              aria-label={tr("备忘录标题")}
              maxLength={160}
              value={selected.title}
              readOnly={locked}
              onChange={(event) => {
                setActionError("");
                model.edit({ title: event.target.value });
              }}
            />
          </div>
          <div className="field mt-memo-content-field">
            <div className="mt-memo-content-head">
              <label htmlFor={contentId}>{tr("备忘录内容")}</label>
              <IconButton
                label={tr(expanded ? "缩小备忘录内容" : "放大备忘录内容")}
                aria-expanded={expanded}
                aria-controls={contentId}
                onClick={() => changeExpanded(!expandedRef.current)}
              >
                {expanded ? <ArrowsInSimple size={17} /> : <ArrowsOutSimple size={17} />}
              </IconButton>
            </div>
            <textarea
              id={contentId}
              ref={contentRef}
              aria-label={tr("备忘录内容")}
              value={selected.content}
              readOnly={locked}
              rows={8}
              placeholder={tr("记下人物、情节或下一段的想法…")}
              onChange={(event) => {
                setActionError("");
                model.edit({ content: event.target.value });
              }}
              onScroll={(event) => {
                scrollPositions.current[expandedRef.current ? "expanded" : "normal"] =
                  event.currentTarget.scrollTop;
              }}
            />
          </div>
          <div className="mt-memo-detail">
            <span>
              {number(count(selected.content))} {tr("字")}
            </span>
            {updatedAt && (
              <time dateTime={selected.updatedAt}>{updatedAt}</time>
            )}
          </div>
          <div className="mt-memo-actions">
            <Button
              variant="primary-soft"
              disabled={locked}
              onClick={() => void run(model.save)}
            >
              <FloppyDisk size={15} />
              {tr("保存备忘录")}
            </Button>
            <Button
              disabled={locked}
              onClick={() => {
                setActionError("");
                setRemove({ id: selected.id, title: selected.title });
              }}
            >
              <Trash size={15} />
              {tr("删除备忘录")}
            </Button>
          </div>
        </section>
      )}
      <footer className="mt-memo-status" role="status" aria-live="polite">
        <span>{tr(model.status)}</span>
        {model.bookTitle && <small>{model.bookTitle}</small>}
      </footer>
      {remove && (
        <Modal
          title={tr("删除这条备忘录？")}
          onClose={() => !locked && setRemove(null)}
        >
          <div className="modal-body">
            <p>
              {tr("确定删除「{0}」？", {
                0: remove.title || tr("未命名备忘录"),
              })}
            </p>
            {actionError && (
              <p className="mt-side-error" role="alert">
                {tr(actionError)}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <Button disabled={locked} onClick={() => setRemove(null)}>
              {tr("取消")}
            </Button>
            <Button
              variant="danger"
              disabled={locked}
              onClick={() =>
                void run(async () => {
                  if (model.selected?.id !== remove.id)
                    throw new Error(tr("当前备忘录已变化，请重新选择后删除。"));
                  await model.remove();
                  setRemove(null);
                })
              }
            >
              {tr("确认删除备忘录")}
            </Button>
          </div>
        </Modal>
      )}
    </aside>
  );
}
