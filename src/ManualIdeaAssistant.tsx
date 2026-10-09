import { useCallback, useEffect, useId, useRef, useState, type MutableRefObject } from "react";
import { ChatCircle, GearSix, ListChecks, Stop, X } from "@phosphor-icons/react";
import { api } from "./api";
import { tr } from "./i18n";
import { Button, IconButton } from "./ui";
import type { BrainstormEvent, MemoNote } from "./types";
import MemoReferencePicker, { emptyMemoReference, memoReferenceOptions, resolveMemoReference, type MemoReferenceChoice } from "./ManualMemoReferences";

type Mode = "brainstorm" | "conflict" | "twist" | "questions" | "trend";
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  requestId?: string;
  status?: BrainstormEvent["status"];
  error?: string;
  title?: string;
  referenceKey?: string;
};
type Session = {
  idea: string;
  trend: string;
  mode: Mode;
  referenceMemo: boolean;
  memoChoices: Record<string, MemoReferenceChoice>;
  messages: Message[];
};
const MODES: Mode[] = ["brainstorm", "conflict", "twist", "questions", "trend"];
const emptySession = (): Session => ({
  idea: "",
  trend: "",
  mode: "brainstorm",
  referenceMemo: true,
  memoChoices: {},
  messages: [],
});
const storageKey = (scope: string) => `xm-manual-ideas-v1:${scope}`;
// Retain whole conversations across panel remounts even when disk storage fails.
const sessionMemory = new Map<string, Session>();
function readMemoChoices(value: unknown): Record<string, MemoReferenceChoice> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([memoId, raw]) => {
    const choice = raw && typeof raw === "object" ? raw as Partial<MemoReferenceChoice> : {};
    if (choice.mode === "all") return [memoId, emptyMemoReference()];
    return [memoId, {
      mode: "parts",
      blockIds: Array.isArray(choice.blockIds) ? choice.blockIds.filter((id) => typeof id === "string") : [],
      blockSource: typeof choice.blockSource === "string" ? choice.blockSource : "",
      fragments: Array.isArray(choice.fragments) ? choice.fragments.filter((fragment) => fragment && Number.isInteger(fragment.start) && Number.isInteger(fragment.end) && typeof fragment.text === "string") : [],
      fragmentSource: typeof choice.fragmentSource === "string" ? choice.fragmentSource : "",
    } satisfies MemoReferenceChoice];
  }));
}
async function referenceContextKey(memo: MemoNote | null, choice: MemoReferenceChoice, ranges: {start:number;end:number}[]) {
  if (!memo) return "no-memo";
  const content = choice.mode === "all" ? [memo.content] : ranges.map((range) => memo.content.slice(range.start, range.end));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({
    title: memo.title,
    ranges: choice.mode === "all" ? null : ranges,
    content,
  })));
  const fingerprint = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${memo.id}:${choice.mode}:${fingerprint}`;
}
function memoChoice(choices: Record<string, MemoReferenceChoice> | undefined, memoId: string): MemoReferenceChoice {
  return choices && Object.hasOwn(choices, memoId) ? choices[memoId] : emptyMemoReference();
}
function readSession(scope: string): Session {
  const cached = sessionMemory.get(scope);
  if (cached) return cached;
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(scope)) || "null");
    if (!raw || raw.version !== 1) return emptySession();
    const messages: Message[] = (
      Array.isArray(raw.messages) ? raw.messages : []
    )
      .filter(
        (m: Message) =>
          m &&
          typeof m.id === "string" &&
          ["user", "assistant"].includes(m.role) &&
          typeof m.content === "string",
      )
      .slice(-12)
      .map((m: Message) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        requestId: typeof m.requestId === "string" ? m.requestId : undefined,
        title: typeof m.title === "string" ? m.title : undefined,
        referenceKey: typeof m.referenceKey === "string" ? m.referenceKey : undefined,
        status: [
          "running",
          "done",
          "interrupted",
          "cancelled",
          "error",
        ].includes(m.status || "")
          ? m.status
          : undefined,
        error: typeof m.error === "string" ? m.error : "",
        ...(m.status === "running"
          ? {
              status: "cancelled" as const,
              error: tr("上次讨论已结束，收到的想法已保留。"),
            }
          : {}),
      }));
    const session: Session = {
      idea: typeof raw.idea === "string" ? raw.idea : "",
      trend: typeof raw.trend === "string" ? raw.trend : "",
      mode: MODES.includes(raw.mode) ? raw.mode : "brainstorm",
      referenceMemo: raw.referenceMemo !== false,
      memoChoices: readMemoChoices(raw.memoChoices),
      messages,
    };
    sessionMemory.set(scope, session);
    return session;
  } catch {
    return emptySession();
  }
}
function storeSession(scope: string, session: Session): boolean {
  sessionMemory.set(scope, session);
  try {
    // Keep whole replies; history limits count messages rather than slicing their text.
    localStorage.setItem(
      storageKey(scope),
      JSON.stringify({
        ...session,
        version: 1,
        messages: session.messages.slice(-12),
      }),
    );
    return true;
  } catch {
    return false;
  }
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : tr("灵感讨论失败，请重试。");
}

export default function ManualIdeaAssistant({
  bookId,
  bookTitle,
  memo,
  notes,
  memoBusy,
  onSelectMemo,
  onSaveMemo,
  onClose,
  notify,
  beforeSend,
  onSettings,
  closeGuard,
}: {
  bookId: string | null;
  bookTitle: string;
  memo: MemoNote | null;
  notes: MemoNote[];
  memoBusy: boolean;
  onSelectMemo: (id: string) => Promise<void>;
  onSaveMemo: (title: string, content: string) => Promise<void>;
  onClose: () => void;
  notify: (message: string) => void;
  beforeSend?: () => Promise<void>;
  onSettings?: () => void;
  closeGuard?: MutableRefObject<() => Promise<void>>;
}) {
  const scope = bookId ? `book:${bookId}` : "scratch";
  const [sessions, setSessions] = useState<Record<string, Session>>(() => ({
    [scope]: readSession(scope),
  }));
  const sessionsRef = useRef(sessions);
  const scopeRef = useRef(scope);
  const activeRef = useRef<{
    requestId: string;
    scope: string;
    bookId: string | null;
  } | null>(null);
  const requestsRef = useRef(
    new Map<string, { scope: string; bookId: string | null }>(),
  );
  const mountedRef = useRef(true);
  const closingRef = useRef(false);
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [savingMessage, setSavingMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [showReferencePicker, setShowReferencePicker] = useState(false);
  const [selectingMemo, setSelectingMemo] = useState(false);
  const selectingMemoRef = useRef(false);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const memoRef = useRef(memo);
  memoRef.current = memo;
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const followLatest = useRef(true);
  const id = useId();
  const session = sessions[scope] || emptySession();
  const running = session.messages.some((m) => m.status === "running");
  const busy = running || starting || selectingMemo || memoBusy;
  const referenceChoice = memo ? memoChoice(session.memoChoices, memo.id) : emptyMemoReference();
  const referenceState = memo ? resolveMemoReference(memo.content, referenceChoice) : {ranges: [], count: 0, invalidCount: 0};
  useEffect(() => setShowReferencePicker(false), [scope, memo?.id]);

  const commit = useCallback((key: string, fn: (old: Session) => Session) => {
    const current = sessionsRef.current;
    const next = { ...current, [key]: fn(current[key] || readSession(key)) };
    sessionsRef.current = next;
    sessionMemory.set(key, next[key]);
    setSessions(next);
  }, []);
  const retainAndStop = useCallback((key: string) => {
    const active = activeRef.current;
    if (active?.scope === key) {
      activeRef.current = null;
      void api("manual:brainstorm-cancel", {
        requestId: active.requestId,
      }).catch(() => {});
      const current = sessionsRef.current[key];
      if (current)
        sessionsRef.current = {
          ...sessionsRef.current,
          [key]: {
            ...current,
            messages: current.messages.map((m) =>
              m.requestId === active.requestId && m.role === "assistant"
                ? {
                    ...m,
                    status: "cancelled",
                    error: tr("已停止，收到的想法已保留。"),
                  }
                : m,
            ),
          },
        };
    }
    const current = sessionsRef.current[key];
    return !current || storeSession(key, current);
  }, []);

  useEffect(() => {
    if (!closeGuard) return;
    const guard = async () => {
      closingRef.current = true;
      try {
        const requestIds = new Set(requestsRef.current.keys());
        if (activeRef.current) requestIds.add(activeRef.current.requestId);
        await Promise.all([...requestIds].map((requestId) =>
          api("manual:brainstorm-cancel", { requestId })));
        activeRef.current = null;
        requestsRef.current.clear();
        for (const [key, current] of Object.entries(sessionsRef.current)) {
          const retained = {
            ...current,
            messages: current.messages.map((message) => message.status === "running"
              ? { ...message, status: "cancelled" as const,
                  error: tr("已停止，收到的想法已保留。") } : message),
          };
          sessionsRef.current[key] = retained;
          sessionMemory.set(key, retained);
        }
        if (mountedRef.current) setSessions({ ...sessionsRef.current });
        let failed = false;
        for (const [key, cached] of sessionMemory) {
          if (!cached.messages.length && !cached.idea.trim() && !cached.trend.trim() &&
            cached.referenceMemo && cached.mode === "brainstorm" &&
            !Object.keys(cached.memoChoices || {}).length) continue;
          if (!storeSession(key, cached)) failed = true;
        }
        if (mountedRef.current) setStorageError(failed);
        if (failed) throw new Error(tr("对话草稿保留失败，请复制想法或另存为备忘录后再关闭。"));
      } finally {
        closingRef.current = false;
      }
    };
    // Keep this recovery guard after unmount; the parent still needs it on exit.
    closeGuard.current = guard;
  }, [closeGuard]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    scopeRef.current = scope;
    closingRef.current = false;
    if (!sessionsRef.current[scope]) commit(scope, () => readSession(scope));
    setSessions(sessionsRef.current);
    setActionError("");
    setStorageError(false);
    setStarting(false);
    setStopping(false);
    followLatest.current = true;
    return () => {
      retainAndStop(scope);
    };
  }, [scope, commit, retainAndStop]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const current = sessionsRef.current[scope];
      if (current) setStorageError(!storeSession(scope, current));
    }, 250);
    return () => clearTimeout(timer);
  }, [sessions, scope]);
  useEffect(() => {
    const flush = () => {
      const key = scopeRef.current;
      const current = sessionsRef.current[key];
      if (current) storeSession(key, current);
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, []);
  useEffect(
    () =>
      window.xingmiao?.onBrainstorm?.((event) => {
        const request = requestsRef.current.get(event.requestId);
        if (
          !request ||
          event.bookId !== request.bookId ||
          (request.scope !== scopeRef.current && event.status === "running")
        )
          return;
        commit(request.scope, (old) => ({
          ...old,
          messages: old.messages.map((message) =>
            message.role === "assistant" &&
            message.requestId === event.requestId
              ? {
                  ...message,
                  content: event.output,
                  status: event.status,
                  error: event.error,
                }
              : message,
          ),
        }));
        if (event.status !== "running") {
          requestsRef.current.delete(event.requestId);
          if (activeRef.current?.requestId === event.requestId)
            activeRef.current = null;
          if (request.scope === scopeRef.current) setStopping(false);
          storeSession(request.scope, sessionsRef.current[request.scope]);
        }
      }),
    [commit],
  );
  useEffect(() => {
    const element = messagesRef.current;
    if (element && followLatest.current)
      element.scrollTop = element.scrollHeight;
  }, [session.messages]);

  function edit(patch: Partial<Omit<Session, "messages">>) {
    commit(scope, (old) => ({ ...old, ...patch }));
  }
  async function selectMemo(id: string) {
    if (selectingMemoRef.current || busy || closingRef.current) return;
    const targetScope = scope;
    selectingMemoRef.current = true;
    setSelectingMemo(true);
    setActionError("");
    try {
      await onSelectMemo(id);
      if (mountedRef.current && scopeRef.current === targetScope && !closingRef.current)
        commit(targetScope, (old) => ({...old, referenceMemo: true}));
    } catch (cause) {
      if (mountedRef.current && scopeRef.current === targetScope) setActionError(errorMessage(cause));
    } finally {
      selectingMemoRef.current = false;
      if (mountedRef.current) setSelectingMemo(false);
    }
  }
  async function send() {
    if (startingRef.current || selectingMemoRef.current || busy) return;
    const current = sessionsRef.current[scope] || session;
    if (
      !current.idea.trim() &&
      !current.trend.trim() &&
      !(current.referenceMemo && memo)
    ) {
      setActionError(tr("先写下想讨论的问题，或选择一条备忘录。"));
      composerRef.current?.focus();
      return;
    }
    if (!window.xingmiao?.onBrainstorm) {
      setActionError(tr("灵感助手尚未连接，请重启软件后重试。"));
      return;
    }
    const targetScope = scope;
    const targetBookId = bookId;
    const selectedMemo = current.referenceMemo ? memo : null;
    const selectedChoice = selectedMemo ? memoChoice(current.memoChoices, selectedMemo.id) : emptyMemoReference();
    const selectedState = selectedMemo ? resolveMemoReference(selectedMemo.content, selectedChoice) : {ranges: [], count: 0, invalidCount: 0};
    if (selectedMemo && selectedChoice.mode === "parts" && (selectedState.invalidCount || !selectedState.ranges.length)) {
      setActionError(tr(selectedState.invalidCount
        ? "所选参考内容已变化，请重新选择。"
        : "请至少选择一项参考内容，或改为整篇备忘录。"));
      setShowReferencePicker(true);
      return;
    }
    const requestId = crypto.randomUUID();
    const title = (
      current.idea.trim() ||
      memo?.title ||
      current.trend.trim() ||
      tr("灵感想法")
    ).slice(0, 100);
    startingRef.current = true;
    setStarting(true);
    setActionError("");
    try {
      await beforeSend?.();
      if (selectedMemo && (memoRef.current?.id !== selectedMemo.id || memoRef.current.content !== selectedMemo.content)) {
        throw new Error(tr("备忘录内容已变化，请核对参考范围后重新构思。"));
      }
      const contextKey = await referenceContextKey(selectedMemo, selectedChoice, selectedState.ranges);
      if (
        !mountedRef.current ||
        closingRef.current ||
        scopeRef.current !== targetScope
      )
        return;
      if (selectedMemo && (memoRef.current?.id !== selectedMemo.id || memoRef.current.content !== selectedMemo.content)) {
        throw new Error(tr("备忘录内容已变化，请核对参考范围后重新构思。"));
      }
      const history = current.messages
        .filter((message) => message.content && message.referenceKey === contextKey)
        .slice(-12).map(({role, content}) => ({role, content}));
      activeRef.current = {
        requestId,
        scope: targetScope,
        bookId: targetBookId,
      };
      requestsRef.current.set(requestId, {
        scope: targetScope,
        bookId: targetBookId,
      });
      followLatest.current = true;
      commit(targetScope, (old) => ({
        ...old,
        messages: [
          ...old.messages,
          {
            id: crypto.randomUUID(),
            role: "user",
            content:
              [
                current.idea.trim(),
                current.trend.trim()
                  ? tr("热梗或关键词：{0}", { 0: current.trend.trim() })
                  : "",
              ]
                .filter(Boolean)
                .join("\n") || tr("围绕当前备忘录继续发散想法。"),
            title,
            referenceKey: contextKey,
          },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "",
            requestId,
            status: "running",
            title,
            referenceKey: contextKey,
          },
        ].slice(-12) as Message[],
      }));
      await api<BrainstormEvent>("manual:brainstorm", {
        requestId,
        bookId: targetBookId,
        memoIds: selectedMemo && selectedChoice.mode === "all" ? [selectedMemo.id] : [],
        memoReferences: selectedMemo && selectedChoice.mode === "parts" ? [{memoId: selectedMemo.id, sourceContent: selectedMemo.content, ranges: selectedState.ranges}] : [],
        idea: current.idea,
        trend: current.trend,
        mode: current.mode,
        history,
      });
      if (mountedRef.current && scopeRef.current === targetScope)
        commit(targetScope, (old) => ({
          ...old,
          idea: old.idea === current.idea ? "" : old.idea,
        }));
    } catch (error) {
      requestsRef.current.delete(requestId);
      if (activeRef.current?.requestId === requestId) activeRef.current = null;
      if (mountedRef.current) commit(targetScope, (old) => ({
        ...old,
        messages: old.messages.map((message) =>
          message.requestId === requestId
            ? { ...message, status: "error", error: errorMessage(error) }
            : message,
        ),
      }));
      if (mountedRef.current && scopeRef.current === targetScope) setActionError(errorMessage(error));
    } finally {
      startingRef.current = false;
      if (mountedRef.current && scopeRef.current === targetScope) setStarting(false);
    }
  }
  async function stop() {
    const active = activeRef.current;
    if (!active || stopping) return;
    setStopping(true);
    try {
      await api("manual:brainstorm-cancel", { requestId: active.requestId });
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      if (scopeRef.current === scope) setStopping(false);
    }
  }
  async function saveMessage(message: Message) {
    if (!bookId || !message.content || savingMessage) return;
    setSavingMessage(message.id);
    setActionError("");
    try {
      await onSaveMemo(
        tr("灵感：{0}", { 0: message.title || tr("未命名想法") }),
        message.content,
      );
      notify(tr("这条想法已另存为备忘录。"));
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setSavingMessage("");
    }
  }
  async function closePanel() {
    if (closingRef.current) return;
    closingRef.current = true;
    const active = activeRef.current;
    if (active?.scope === scope) {
      try {
        await api("manual:brainstorm-cancel", { requestId: active.requestId });
      } catch {
        /* The local recovery copy below still preserves received content. */
      }
    }
    if (!mountedRef.current || scopeRef.current !== scope) {
      closingRef.current = false;
      return;
    }
    if (!retainAndStop(scope)) {
      closingRef.current = false;
      setStorageError(true);
      setSessions(sessionsRef.current);
      notify(tr("对话草稿保留失败，请复制想法或另存为备忘录后再关闭。"));
      return;
    }
    onClose();
  }
  return (
    <aside className={`mt-idea-panel${session.messages.length ? "" : " mt-idea-no-conversation"}`} aria-label={tr("灵感助手")}>
      <header className="mt-side-head">
        <h2>
          <ChatCircle size={19} />
          {tr("灵感助手")}
        </h2>
        <div>
          {onSettings && (
            <IconButton
              label={tr("灵感模型设置")}
              disabled={busy}
              onClick={onSettings}
            >
              <GearSix size={17} />
            </IconButton>
          )}
          <IconButton
            label={tr("收起灵感助手")}
            onClick={() => void closePanel()}
          >
            <X size={18} />
          </IconButton>
        </div>
      </header>
      <div className="mt-idea-context">
        <p>{bookTitle || tr("独立灵感讨论")}</p>
        <div className="mt-idea-reference-row">
          <label>
          <input
            type="checkbox"
            aria-label={tr("参考备忘录")}
            checked={session.referenceMemo}
            disabled={!memo || busy}
            onChange={(event) => edit({ referenceMemo: event.target.checked })}
          />
          <span>{tr("参考备忘录")}</span>
          </label>
          <IconButton label={tr("选择参考内容")} disabled={!memo || busy} onClick={() => setShowReferencePicker(true)}>
            <ListChecks size={16} />
          </IconButton>
        </div>
        {notes.length ? <label className="mt-idea-memo-select">
          <span>{tr("选择脑洞或备忘录")}</span>
          <select aria-label={tr("选择脑洞或备忘录")} value={memo?.id || ""} disabled={busy}
            onChange={(event) => void selectMemo(event.target.value)}>
            {!memo && <option value="">{tr("请选择备忘录")}</option>}
            {memo && !notes.some((note) => note.id === memo.id) && <option value={memo.id} disabled>{memo.title || tr("未命名备忘录")} · {tr("备忘录需要核对")}</option>}
            {memoReferenceOptions(notes).map((note) => <option key={note.id} value={note.id}>{note.label}</option>)}
          </select>
        </label> : <small>{tr("在备忘录中选择一条笔记，可围绕它讨论。")}</small>}
        {memo && referenceChoice.mode === "parts" && (
          <button type="button" className="mt-reference-summary" disabled={busy} onClick={() => setShowReferencePicker(true)}>
            {referenceState.invalidCount ? tr("参考内容需要重新核对") : tr("已选 {0} 项内容", {0: referenceState.count})}
          </button>
        )}
        <p className="mt-idea-hint">
          {tr("一起找方向、拆冲突、想反转，正文由你来写。")}
        </p>
      </div>
      {session.messages.length > 0 && <div
        className="mt-idea-messages"
        ref={messagesRef}
        role="log"
        aria-label={tr("灵感对话")}
        aria-live="polite"
        aria-relevant="additions"
        onScroll={() => {
          const element = messagesRef.current;
          if (element)
            followLatest.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              80;
        }}
      >
        {session.messages.map((message) => (
          <article
            key={message.id}
            className={`mt-idea-message ${message.role}`}
          >
            <strong>
              {message.role === "user" ? tr("我的构思") : tr("可选想法")}
            </strong>
            <div className="mt-idea-message-text">
              {message.content ||
                (message.status === "running"
                  ? tr("正在整理想法…")
                  : tr("这轮还没有收到想法。"))}
            </div>
            {message.role === "assistant" &&
              message.status &&
              message.status !== "done" && (
                <small className="mt-idea-status" role="status">
                  {message.status === "running"
                    ? tr("正在构思…")
                    : message.error || tr("这轮讨论已结束。")}
                </small>
              )}
            {message.role === "assistant" && message.content && (
              <div className="mt-idea-actions">
                <Button
                  disabled={
                    !bookId || !!savingMessage || message.status === "running"
                  }
                  busy={savingMessage === message.id}
                  onClick={() => void saveMessage(message)}
                >
                  {tr("另存为备忘录")}
                </Button>
                <Button
                  onClick={() =>
                    void api("clipboard:write", { text: message.content })
                      .then(() => notify(tr("想法已复制。")))
                      .catch((error) => setActionError(errorMessage(error)))
                  }
                >
                  {tr("复制想法")}
                </Button>
                {!bookId && <small>{tr("先选择作品，再另存为备忘录。")}</small>}
              </div>
            )}
          </article>
        ))}
      </div>}
      <form
        className="mt-idea-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor={`${id}-mode`}>{tr("发散方式")}</label>
        <select
          id={`${id}-mode`}
          aria-label={tr("发散方式")}
          value={session.mode}
          disabled={busy}
          onChange={(event) => edit({ mode: event.target.value as Mode })}
        >
          <option value="brainstorm">{tr("发散灵感")}</option>
          <option value="conflict">{tr("拆解冲突")}</option>
          <option value="twist">{tr("寻找反转")}</option>
          <option value="questions">{tr("追问探索")}</option>
          <option value="trend">{tr("转化热梗")}</option>
        </select>
        <label htmlFor={`${id}-idea`}>{tr("创意构思")}</label>
        <textarea
          ref={composerRef}
          id={`${id}-idea`}
          aria-label={tr("创意构思")}
          value={session.idea}
          rows={4}
          maxLength={20000}
          disabled={busy}
          placeholder={tr("写下一个想法，或继续追问上一轮的方向…")}
          onChange={(event) => edit({ idea: event.target.value })}
        />
        <label htmlFor={`${id}-trend`}>{tr("热梗或关键词")}</label>
        <input
          id={`${id}-trend`}
          aria-label={tr("热梗或关键词")}
          value={session.trend}
          maxLength={8000}
          disabled={busy}
          placeholder={tr("可选，填写你想讨论的梗或关键词")}
          onChange={(event) => edit({ trend: event.target.value })}
        />
        <small>{tr("填写想结合的梗、关键词或生活观察。")}</small>
        {storageError && (
          <p className="mt-side-error" role="alert">
            {tr("对话草稿保留失败，请复制想法或另存为备忘录后再关闭。")}
          </p>
        )}
        {actionError && (
          <p className="mt-side-error" role="alert">
            {tr(actionError)}
          </p>
        )}
        {running ? (
          <Button type="button" busy={stopping} onClick={() => void stop()}>
            <Stop size={15} />
            {tr("停止构思")}
          </Button>
        ) : (
          <Button type="submit" busy={starting} disabled={!!savingMessage || selectingMemo || memoBusy}>
            {tr("开始构思")}
          </Button>
        )}
      </form>
      {showReferencePicker && memo && (
        <MemoReferencePicker memo={memo} notes={notes} choices={session.memoChoices} value={referenceChoice} onClose={() => setShowReferencePicker(false)} onApply={async (choice, memoId) => {
          const targetScope = scope;
          if (busy || selectingMemoRef.current || closingRef.current) throw new Error(tr("备忘录正在同步，请稍候再开始构思。"));
          const target = notesRef.current.find((note) => note.id === memoId);
          if (!target) throw new Error(tr("所选备忘录已不存在，请重新选择"));
          const resolved = resolveMemoReference(target.content, choice);
          if (choice.mode === "parts" && (resolved.invalidCount || !resolved.ranges.length))
            throw new Error(tr("所选参考内容已变化，请重新选择。"));
          selectingMemoRef.current = true;
          setSelectingMemo(true);
          try { await onSelectMemo(memoId); }
          finally { selectingMemoRef.current = false; if (mountedRef.current) setSelectingMemo(false); }
          if (!mountedRef.current || scopeRef.current !== targetScope || closingRef.current) return;
          commit(targetScope, (old) => ({...old, referenceMemo: true, memoChoices: {...old.memoChoices, [memoId]: choice}}));
          setActionError("");
          setShowReferencePicker(false);
        }} />
      )}
    </aside>
  );
}
