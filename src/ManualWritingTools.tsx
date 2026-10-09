import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { api, count, date, number } from "./api";
import { tr } from "./i18n";
import type { Book, Job, Version } from "./types";
import { Button, Modal } from "./ui";

type DraftItem = {
  key: string;
  title: string;
  text: string;
  updatedAt: string;
};
type ActionResult = void | Promise<void>;

function timestamp(value: string) {
  return Number.isFinite(new Date(value).getTime())
    ? date(value)
    : tr("时间未记录");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : tr("操作失败，请重试。");
}

function navigateTabs(event: KeyboardEvent<HTMLButtonElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]',
    ) || [],
  );
  if (!tabs.length) return;
  const index = tabs.indexOf(event.currentTarget);
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length;
  event.preventDefault();
  if (!tabs[nextIndex].disabled) {
    tabs[nextIndex].click();
    tabs[nextIndex].focus();
  }
}

export function DraftManager({
  drafts,
  deleted,
  activeKey,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onRestore,
  onClose,
}: {
  drafts: DraftItem[];
  deleted: DraftItem[];
  activeKey: string;
  onOpen: (key: string) => ActionResult;
  onCreate: () => ActionResult;
  onRename: (key: string, title: string) => ActionResult;
  onDelete: (key: string) => ActionResult;
  onRestore: (key: string) => ActionResult;
  onClose: () => void;
}) {
  const id = useId();
  const [tab, setTab] = useState<"drafts" | "deleted">("drafts");
  const [search, setSearch] = useState("");
  const [rename, setRename] = useState<{ key: string; title: string } | null>(
    null,
  );
  const [remove, setRemove] = useState<DraftItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const items = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...(tab === "drafts" ? drafts : deleted)]
      .filter(
        (item) =>
          !query ||
          `${item.title}\n${item.text}`.toLocaleLowerCase().includes(query),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [drafts, deleted, search, tab]);

  async function run(action: () => ActionResult) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function selectTab(next: "drafts" | "deleted") {
    setTab(next);
    setRename(null);
    setError("");
  }

  return (
    <Modal title={tr("临时稿管理")} wide onClose={() => !busy && onClose()}>
      <div className="modal-body mt-draft-manager">
        <div
          className="mt-tools-tabs"
          role="tablist"
          aria-label={tr("文稿分类")}
        >
          {(["drafts", "deleted"] as const).map((value) => (
            <button
              key={value}
              type="button"
              id={`${id}-${value}-tab`}
              role="tab"
              aria-label={tr(value === "drafts" ? "临时稿" : "回收站")}
              aria-selected={tab === value}
              aria-controls={`${id}-panel`}
              tabIndex={tab === value ? 0 : -1}
              onKeyDown={navigateTabs}
              className={tab === value ? "active" : ""}
              disabled={busy}
              onClick={() => selectTab(value)}
            >
              {tr(value === "drafts" ? "临时稿" : "回收站")}
              <small>
                {number(value === "drafts" ? drafts.length : deleted.length)}
              </small>
            </button>
          ))}
        </div>
        <div className="mt-tools-search">
          <input
            type="search"
            aria-label={tr("搜索临时稿")}
            placeholder={tr("搜索标题或正文")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button
            disabled={busy}
            variant="primary"
            onClick={() =>
              void run(async () => {
                await onCreate();
                onClose();
              })
            }
          >
            {tr("新建临时稿")}
          </Button>
        </div>
        <p className="mt-tools-hint">
          {tab === "drafts"
            ? tr("临时稿独立保留在本机。打开后可继续编辑，也可以另存到作品中。")
            : tr("删除的临时稿会保留在这里，恢复后可继续编辑。")}
        </p>
        {error && !remove && (
          <p className="error-box" role="alert">
            {tr(error)}
          </p>
        )}
        <div
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${tab}-tab`}
          className="mt-draft-list"
        >
          {items.length === 0 && (
            <p className="mt-tools-empty">
              {search.trim()
                ? tr("没有找到匹配的临时稿。")
                : tab === "drafts"
                  ? tr("暂无临时稿。")
                  : tr("回收站为空。")}
            </p>
          )}
          {items.map((item) => (
            <article
              key={item.key}
              className={`mt-draft-row ${item.key === activeKey ? "active" : ""}`}
            >
              <div className="mt-draft-detail">
                {rename?.key === item.key && tab === "drafts" ? (
                  <form
                    className="mt-draft-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const title = rename.title.trim();
                      if (!title) {
                        setError(tr("请输入临时稿名称。"));
                        return;
                      }
                      void run(async () => {
                        await onRename(item.key, title);
                        setRename(null);
                      });
                    }}
                  >
                    <input
                      autoFocus
                      aria-label={tr("临时稿名称")}
                      maxLength={120}
                      value={rename.title}
                      disabled={busy}
                      onChange={(event) =>
                        setRename({ key: item.key, title: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          setRename(null);
                        }
                      }}
                    />
                    <Button type="submit" disabled={busy}>
                      {tr("确认重命名")}
                    </Button>
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => setRename(null)}
                    >
                      {tr("取消")}
                    </Button>
                  </form>
                ) : tab === "drafts" ? (
                  <button
                    type="button"
                    className="mt-draft-title"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await onOpen(item.key);
                        onClose();
                      })
                    }
                  >
                    {item.title || tr("未命名临时稿")}
                  </button>
                ) : (
                  <strong>{item.title || tr("未命名临时稿")}</strong>
                )}
                <small>
                  {number(count(item.text))} {tr("字")} ·{" "}
                  {timestamp(item.updatedAt)}
                  {tab === "drafts" && item.key === activeKey && (
                    <> · {tr("正在编辑")}</>
                  )}
                </small>
                <p>
                  {item.text.trim().replace(/\s+/g, " ").slice(0, 90) ||
                    tr("空白临时稿，可以打开后开始写作。")}
                </p>
              </div>
              <div className="mt-draft-actions">
                {tab === "drafts" ? (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await onOpen(item.key);
                          onClose();
                        })
                      }
                    >
                      {tr("继续编辑")}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setRename({ key: item.key, title: item.title });
                        setError("");
                      }}
                    >
                      {tr("重命名")}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setRemove(item);
                        setError("");
                      }}
                    >
                      {tr("删除")}
                    </Button>
                  </>
                ) : (
                  <Button
                    disabled={busy}
                    onClick={() => void run(() => onRestore(item.key))}
                  >
                    {tr("恢复")}
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
      <div className="modal-footer">
        <Button disabled={busy} onClick={onClose}>
          {tr("关闭")}
        </Button>
      </div>
      {remove && (
        <Modal
          title={tr("删除临时稿？")}
          onClose={() => !busy && setRemove(null)}
        >
          <div className="modal-body">
            <p>
              “{remove.title || tr("未命名临时稿")}
              {tr("”将移入回收站，之后可以恢复。")}
            </p>
            {remove.key === activeKey && (
              <p>{tr("当前稿移入回收站后，会打开另一份临时稿。")}</p>
            )}
            {error && (
              <p className="error-box" role="alert">
                {tr(error)}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <Button disabled={busy} onClick={() => setRemove(null)}>
              {tr("取消")}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await onDelete(remove.key);
                  setRemove(null);
                })
              }
            >
              {tr("移入回收站")}
            </Button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

type Source = {
  key: string;
  title: string;
  label: string;
  text: string;
  createdAt: string;
  status: string;
  type: "candidate" | "history";
};

const generationLabels: Partial<Record<Job["kind"], string>> = {
  write: "生成正文",
  continue: "续写正文",
  polish: "润色正文",
};

export function ManualSources({
  bookId,
  chapterId,
  onClose,
  onLoad,
}: {
  bookId: string;
  chapterId: string;
  onClose: () => void;
  onLoad: (source: {
    text: string;
    title: string;
    asScratch: boolean;
    append: boolean;
  }) => ActionResult;
}) {
  const id = useId();
  const [tab, setTab] = useState<"candidate" | "history">("candidate");
  const [book, setBook] = useState<Book | null>(null);
  const [generated, setGenerated] = useState<Job[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({ candidate: "", history: "" });
  const [actionError, setActionError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBook(null);
    setGenerated([]);
    setVersions([]);
    setSelectedKey("");
    setActionError("");
    setErrors({ candidate: "", history: "" });
    void Promise.allSettled([
      api<Book>("book:get", { id: bookId }),
      api<Version[]>("versions:list", { id: chapterId }),
      api<Job[]>("manual:chapter-sources", { chapterId }),
    ]).then(([bookResult, versionResult, candidateResult]) => {
      if (cancelled) return;
      if (bookResult.status === "fulfilled") setBook(bookResult.value);
      if (versionResult.status === "fulfilled")
        setVersions(versionResult.value);
      if (candidateResult.status === "fulfilled")
        setGenerated(candidateResult.value);
      setErrors({
        candidate:
          candidateResult.status === "rejected"
            ? errorMessage(candidateResult.reason)
            : "",
        history:
          versionResult.status === "rejected"
            ? errorMessage(versionResult.reason)
            : "",
      });
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [bookId, chapterId, reload]);

  const sources = useMemo(() => {
    const chapterTitle =
      book?.chapters.find((chapter) => chapter.id === chapterId)?.title ||
      tr("未命名章节");
    const candidates: Source[] = generated
      .filter(
        (job) =>
          job.chapterId === chapterId &&
          ["write", "continue", "polish"].includes(job.kind) &&
          ["done", "error", "interrupted", "cancelled"].includes(job.status) &&
          Boolean(job.output?.trim()),
      )
      .map((job) => ({
        key: `candidate:${job.id}`,
        title: chapterTitle,
        label: tr(generationLabels[job.kind] || "生成正文"),
        text: job.output,
        createdAt: String(job.createdAt || ""),
        status: tr(
          job.adopted ? "已采用" : job.status === "done" ? "未采用" : "未完成",
        ),
        type: "candidate" as const,
      }))
      .sort((a, b) =>
        String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
      );
    const history: Source[] = versions
      .filter((version) => version.chapterId === chapterId)
      .map((version) => ({
        key: `history:${version.id}`,
        title: version.title || chapterTitle,
        label: version.label || tr("章节版本"),
        text: version.body || "",
        createdAt: version.createdAt,
        status: `${tr("版本")} ${number(version.revision)}`,
        type: "history" as const,
      }))
      .sort(
        (a, b) =>
          Number(Boolean(b.text.trim())) - Number(Boolean(a.text.trim())) ||
          String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
      );
    return { candidate: candidates, history };
  }, [book, chapterId, versions, generated]);
  const items = sources[tab];
  const selected = items.find((item) => item.key === selectedKey) || items[0];

  async function load(asScratch: boolean, append: boolean) {
    if (!selected?.text.trim() || busy) return;
    setBusy(true);
    setActionError("");
    try {
      await onLoad({
        text: selected.text,
        title: selected.title,
        asScratch,
        append,
      });
      onClose();
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={tr("稿件与历史")} wide onClose={() => !busy && onClose()}>
      <div className="modal-body mt-manual-sources">
        <div
          className="mt-tools-tabs"
          role="tablist"
          aria-label={tr("稿件来源")}
        >
          {(["candidate", "history"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-label={tr(value === "candidate" ? "生成稿" : "历史版本")}
              id={`${id}-${value}-tab`}
              aria-selected={tab === value}
              aria-controls={`${id}-panel`}
              tabIndex={tab === value ? 0 : -1}
              onKeyDown={navigateTabs}
              className={tab === value ? "active" : ""}
              disabled={busy}
              onClick={() => {
                setTab(value);
                setSelectedKey("");
                setActionError("");
              }}
            >
              {tr(value === "candidate" ? "生成稿" : "历史版本")}
              <small>{number(sources[value].length)}</small>
            </button>
          ))}
        </div>
        <p className="mt-tools-hint">
          {tr(
            "载入只更新码字板草稿。保存到作品后才会修改章节；生成稿不会在这里自动采用。原草稿会保留为临时稿。",
          )}
        </p>
        {errors[tab] && (
          <div className="error-box" role="alert">
            <p>{tr(errors[tab])}</p>
            <Button
              disabled={busy || loading}
              onClick={() => setReload((value) => value + 1)}
            >
              {tr("重新加载")}
            </Button>
          </div>
        )}
        {actionError && (
          <p className="error-box" role="alert">
            {tr(actionError)}
          </p>
        )}
        <div
          className="mt-source-body"
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${tab}-tab`}
          aria-busy={loading}
        >
          <div className="mt-source-list">
            {loading ? (
              <p className="mt-tools-empty" role="status">
                {tr("正在读取稿件…")}
              </p>
            ) : items.length === 0 && !errors[tab] ? (
              <p className="mt-tools-empty">
                {tab === "candidate"
                  ? tr(
                      "本章暂无生成稿。正文生成、续写或润色的结果会显示在这里。",
                    )
                  : tr("本章暂无历史版本。")}
              </p>
            ) : (
              items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  data-source-id={item.key.slice(item.key.indexOf(":") + 1)}
                  className={`mt-source-row ${selected?.key === item.key ? "active" : ""}`}
                  aria-pressed={selected?.key === item.key}
                  disabled={busy}
                  onClick={() => {
                    setSelectedKey(item.key);
                    setActionError("");
                  }}
                >
                  <strong>{item.label}</strong>
                  <span>{item.status}</span>
                  <small>
                    {timestamp(item.createdAt)} · {number(count(item.text))}{" "}
                    {tr("字")}
                  </small>
                  {!item.text.trim() && <small>{tr("空白版本")}</small>}
                </button>
              ))
            )}
          </div>
          <div className="mt-source-preview">
            <div className="mt-source-preview-head">
              <strong>{selected?.title || tr("正文预览")}</strong>
              {selected && (
                <small>
                  {number(count(selected.text))} {tr("字")}
                </small>
              )}
            </div>
            <textarea
              readOnly
              aria-label={tr("稿件正文预览")}
              value={selected?.text || ""}
              placeholder={
                selected ? tr("此版本正文为空。") : tr("选择一份稿件查看正文。")
              }
            />
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <Button disabled={busy} onClick={onClose}>
          {tr("取消")}
        </Button>
        <Button
          disabled={loading || busy || !selected?.text.trim()}
          onClick={() => void load(true, false)}
        >
          {tr("另存临时稿")}
        </Button>
        {tab === "candidate" && (
          <Button
            disabled={loading || busy || !selected?.text.trim()}
            onClick={() => void load(false, true)}
          >
            {tr("追加到当前稿")}
          </Button>
        )}
        <Button
          variant="primary"
          disabled={loading || busy || !selected?.text.trim()}
          onClick={() => void load(false, false)}
        >
          {tr("载入当前章节草稿")}
        </Button>
      </div>
    </Modal>
  );
}
