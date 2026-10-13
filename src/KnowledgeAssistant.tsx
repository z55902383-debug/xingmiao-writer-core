import { useEffect, useRef, useState } from "react";
import {
  ChatCircle,
  PaperPlaneTilt,
  Stop,
  ListBullets,
  Users,
  GlobeHemisphereWest,
  Brain,
  ArrowCounterClockwise,
  Check,
  Trash,
} from "@phosphor-icons/react";
import { api, number } from "./api";
import { tr } from "./i18n";
import { Button, Modal } from "./ui";
import type { Book, KnowledgeSession, KnowledgeChange } from "./types";
import "./knowledge-assistant.css";
const targets: Record<string, string> = {
  book: "故事大纲",
  volume: "分卷大纲",
  character: "人物档案",
  worldRecord: "世界设定",
  memory: "事实记忆",
  timeline: "时间线与关系",
  foreshadow: "伏笔记录",
};
const fields: Record<string, string> = {
  premise: "故事简介",
  outline: "大纲",
  world: "世界观与固定规则",
  title: "名称",
  detail: "细纲",
  name: "人物姓名",
  role: "身份与定位",
  description: "描述",
  authorNotes: "作者秘密设定",
  readerKnown: "读者已知",
  characterKnown: "角色已知",
  category: "分类",
  certainty: "设定状态",
  subject: "主体",
  relation: "关系",
  object: "事实",
  kind: "变化类型",
  entity: "对象",
  characterId: "人物",
  targetId: "关系人物",
  attribute: "变化维度",
  value: "变化后状态",
  phase: "状态",
  storyTime: "故事时间",
  status: "状态",
  note: "说明",
  sourceChapterId: "来源章节",
  sourceRevision: "来源版本",
  evidence: "原文证据",
  stale: "待复核",
};
function shown(value: unknown, book: Book) {
  if (value == null || value === "") return tr("无");
  if (typeof value === "boolean") return tr(value ? "是" : "否");
  if (typeof value === "string") {
    const person = book.characters.find((row) => row.id === value);
    if (person) return person.name;
    const label: Record<string, string> = {
      planned: "计划",
      confirmed: "已确认",
      fixed: "固定",
      provisional: "待确认",
      open: "待回收",
      resolved: "已回收",
      abandoned: "已放弃",
      world: "世界",
      character: "人物",
      relation: "关系",
    };
    return label[value] ? tr(label[value]) : value;
  }
  return String(value);
}
function ChangePreview({
  change,
  book,
}: {
  change: KnowledgeChange;
  book: Book;
}) {
  const keys = [
    ...new Set([
      ...Object.keys(change.before || {}),
      ...Object.keys(change.after || {}),
    ]),
  ].filter(
    (key) =>
      fields[key] &&
      JSON.stringify(change.before?.[key]) !==
        JSON.stringify(change.after?.[key]),
  );
  return (
    <details className="knowledge-change-detail">
      <summary>{tr("查看修改前后")}</summary>
      {keys.map((key) => (
        <div className="knowledge-field-diff" key={key}>
          <strong>{tr(fields[key])}</strong>
          <div>
            <span>{tr("修改前")}</span>
            <p>{shown(change.before?.[key], book)}</p>
          </div>
          <div>
            <span>{tr("修改后")}</span>
            <p>{shown(change.after?.[key], book)}</p>
          </div>
        </div>
      ))}
    </details>
  );
}
export default function KnowledgeAssistant({
  book,
  beforeAction,
  onChanged,
  disabled,
  active,
}: {
  book: Book;
  beforeAction: () => Promise<void>;
  onChanged: (book: Book) => void;
  disabled: boolean;
  active: boolean;
}) {
  const [session, setSession] = useState<KnowledgeSession>({
    bookId: book.id,
    revision: -1,
    messages: [],
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<Record<string, string[]>>({}),
    [clearOpen, setClearOpen] = useState(false);
  const log = useRef<HTMLDivElement>(null),
    follow = useRef(true),
    alive = useRef(true),
    currentBook = useRef(book.id);
  currentBook.current = book.id;
  const running = session.messages.some((row) => row.status === "running"),
    locked = disabled || busy || loading;
  function receive(value: KnowledgeSession) {
    if (alive.current && value.bookId === currentBook.current)
      setSession((old) =>
        old.bookId !== value.bookId || value.revision >= old.revision
          ? value
          : old,
      );
  }
  useEffect(() => {
    const id = book.id;
    alive.current = true;
    setLoading(true);
    setBusy(false);
    setClearOpen(false);
    setInput("");
    setError("");
    setSelected({});
    follow.current = true;
    setSession({ bookId: id, revision: -1, messages: [] });
    const off = window.xingmiao?.onKnowledgeChat(receive);
    api<KnowledgeSession>("knowledge:get", { bookId: id })
      .then(receive)
      .catch((e) => {
        if (alive.current && currentBook.current === id) setError(e.message);
      })
      .finally(() => {
        if (alive.current && currentBook.current === id) setLoading(false);
      });
    return () => {
      alive.current = false;
      off?.();
      void api("knowledge:cancel", { bookId: book.id }).catch(() => {});
    };
  }, [book.id]);
  useEffect(() => {
    if (!active && running)
      void api("knowledge:cancel", { bookId: book.id }).catch(() => {});
  }, [active, running, book.id]);
  useEffect(() => {
    if (active && follow.current)
      log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [session, active]);
  async function perform(action: string, data: Record<string, unknown> = {}) {
    if (locked) return;
    const id = book.id;
    setBusy(true);
    setError("");
    try {
      await beforeAction();
      if (!alive.current || currentBook.current !== id) return;
      const result = await api<{ session: KnowledgeSession; book: Book }>(
        action,
        { bookId: id, ...data },
      );
      if (alive.current && currentBook.current === id) {
        receive(result.session);
        onChanged(result.book);
      }
    } catch (e) {
      if (alive.current && currentBook.current === id)
        setError((e as Error).message);
    } finally {
      if (alive.current && currentBook.current === id) setBusy(false);
    }
  }
  async function send(proposalId?: string) {
    if (locked || running || (!proposalId && !input.trim())) return;
    const id = book.id,
      message = input;
    setBusy(true);
    setError("");
    follow.current = true;
    try {
      await beforeAction();
      if (!alive.current || currentBook.current !== id) return;
      const value = await api<KnowledgeSession>(
        proposalId ? "knowledge:recheck" : "knowledge:send",
        {
          bookId: id,
          message,
          proposalId,
        },
      );
      if (alive.current && currentBook.current === id) {
        receive(value);
        if (!proposalId) setInput("");
      }
    } catch (e) {
      if (alive.current && currentBook.current === id)
        setError((e as Error).message);
    } finally {
      if (alive.current && currentBook.current === id) setBusy(false);
    }
  }
  return (
    <div
      className="knowledge-assistant"
      hidden={!active}
      aria-label={tr("资料整理对话")}
    >
      <div className="knowledge-scope">
        <strong>
          <ChatCircle size={17} />
          {tr("一起整理这部作品的资料")}
        </strong>
        <p>{tr("查询、梳理与调整现有设定。修改先核对，再确认写入。")}</p>
        <div>
          <span>
            <ListBullets size={13} />
            {tr("故事大纲")}
          </span>
          <span>
            <Users size={13} />
            {tr("人物档案")}
          </span>
          <span>
            <GlobeHemisphereWest size={13} />
            {tr("世界设定")}
          </span>
          <span>
            <Brain size={13} />
            {tr("关系与记忆")}
          </span>
        </div>
        <small>{tr("不读取或修改章节正文、章纲、风格档案和备忘录。")}</small>
      </div>
      <div
        className="knowledge-log"
        ref={log}
        onScroll={() => {
          const el = log.current;
          if (el)
            follow.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {loading && <p role="status">{tr("正在读取资料对话…")}</p>}
        {!loading && !session.messages.length && (
          <div className="knowledge-empty">
            <strong>{tr("从一个具体问题开始")}</strong>
            {[
              "列出现有的人物及关系",
              "检查世界规则是否有冲突",
              "梳理大纲中尚未解决的问题",
            ].map((text) => (
              <button
                key={text}
                disabled={locked}
                onClick={() => setInput(tr(text))}
              >
                {tr(text)}
              </button>
            ))}
          </div>
        )}
        {session.messages.map((row) => (
          <article className={`knowledge-message ${row.role}`} key={row.id}>
            <strong>{tr(row.role === "user" ? "我的要求" : "资料助手")}</strong>
            {row.content && (
              <div className="knowledge-reply">{row.content}</div>
            )}
            {row.status === "running" && (
              <p role="status">
                {tr("正在核对资料并整理回答…")}
                <small>
                  {tr("已接收 {0} 字符", { 0: number(row.received || 0) })}
                </small>
              </p>
            )}
            {row.error && (
              <p className="error-box" role="alert">
                {row.error}
              </p>
            )}
            {row.proposal && (
              <div className="knowledge-proposal">
                <strong>
                  {row.proposal.status === "applied" && row.proposal.appliedIds
                    ? tr("已写入 {0}/{1} 项", {
                        0: row.proposal.appliedIds.length,
                        1: row.proposal.changes.length,
                      })
                    : tr(
                        row.proposal.status === "applied"
                          ? "采纳记录不完整"
                          : row.proposal.status === "undone"
                            ? "修改已撤销"
                            : "待确认的修改方案",
                      )}
                </strong>
                {row.proposal.changes.map((change) => {
                  const ids =
                    row.proposal!.status === "pending"
                      ? (selected[row.proposal!.id] ??
                        row.proposal!.changes.map((item) => item.key))
                      : (row.proposal!.appliedIds ?? []);
                  const record = change.after || change.before;
                  return (
                    <div className="knowledge-change" key={change.key}>
                      <label>
                        <input
                          type="checkbox"
                          aria-label={tr("选择此项资料变更")}
                          checked={ids.includes(change.key)}
                          disabled={
                            locked ||
                            running ||
                            row.proposal!.status !== "pending"
                          }
                          onChange={(e) =>
                            setSelected((old) => ({
                              ...old,
                              [row.proposal!.id]: e.target.checked
                                ? [...ids, change.key]
                                : ids.filter((id) => id !== change.key),
                            }))
                          }
                        />
                        <span>
                          <b>{tr(targets[change.target])}</b>
                          <small>
                            {tr(
                              change.operation === "create"
                                ? "新增"
                                : change.operation === "delete"
                                  ? "删除"
                                  : "修改",
                            )}
                            {" · "}
                            {String(
                              record?.name ||
                                record?.title ||
                                record?.subject ||
                                book.title,
                            )}
                          </small>
                          {row.proposal!.status !== "pending" && (
                            <small
                              className="knowledge-item-status"
                              data-applied={ids.includes(change.key)}
                            >
                              {tr(
                                !row.proposal!.appliedIds
                                  ? "采纳记录不完整"
                                  : !ids.includes(change.key)
                                    ? "未采纳"
                                    : row.proposal!.status === "undone"
                                      ? "已撤销"
                                      : "已写入",
                              )}
                            </small>
                          )}
                        </span>
                      </label>
                      <ChangePreview change={change} book={book} />
                    </div>
                  );
                })}
                {row.proposal.status === "applied" &&
                  row.proposal.appliedIds &&
                  row.proposal.appliedIds.length <
                    row.proposal.changes.length && (
                    <Button
                      disabled={locked || running}
                      onClick={() => void send(row.proposal!.id)}
                    >
                      {tr("重新核对未采纳项")}
                    </Button>
                  )}
                {row.proposal.status === "pending" && (
                  <Button
                    variant="primary-soft"
                    disabled={
                      locked ||
                      running ||
                      !(
                        selected[row.proposal.id] ??
                        row.proposal.changes.map((item) => item.key)
                      ).length
                    }
                    onClick={() =>
                      void perform("knowledge:apply", {
                        proposalId: row.proposal!.id,
                        changeIds:
                          selected[row.proposal!.id] ??
                          row.proposal!.changes.map((item) => item.key),
                      })
                    }
                  >
                    <Check size={15} />
                    {tr("确认写入所选修改")}
                  </Button>
                )}
                {row.proposal.status === "applied" && (
                  <Button
                    disabled={locked || running}
                    onClick={() =>
                      void perform("knowledge:undo", {
                        proposalId: row.proposal!.id,
                      })
                    }
                  >
                    <ArrowCounterClockwise size={15} />
                    {tr("撤销这次修改")}
                  </Button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="knowledge-composer">
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <label htmlFor="knowledge-input">{tr("想查询或调整哪些资料？")}</label>
        <textarea
          id="knowledge-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={20000}
          placeholder={tr(
            "例如：列出林舟与周伯的关系，把周伯的公开身份改为退休管理员。",
          )}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div>
          <Button
            variant="ghost"
            disabled={locked || running || !session.messages.length}
            onClick={() => setClearOpen(true)}
          >
            <Trash size={14} />
            {tr("清空对话")}
          </Button>
          {running ? (
            <Button
              variant="stop"
              onClick={() =>
                void api("knowledge:cancel", { bookId: book.id }).catch((e) =>
                  setError(e.message),
                )
              }
            >
              <Stop size={15} />
              {tr("停止")}
            </Button>
          ) : (
            <Button
              variant="primary"
              busy={busy}
              disabled={locked || !input.trim()}
              onClick={() => void send()}
            >
              <PaperPlaneTilt size={16} />
              {tr("发送资料要求")}
            </Button>
          )}
        </div>
      </div>
      {clearOpen && (
        <Modal title={tr("清空资料对话")} onClose={() => setClearOpen(false)}>
          <p>
            {tr(
              "只清空当前作品的对话，不删除作品资料。清空后将失去旧方案的撤销入口。",
            )}
          </p>
          <div className="modal-actions">
            <Button onClick={() => setClearOpen(false)}>{tr("取消")}</Button>
            <Button
              variant="danger"
              onClick={() => {
                void api<KnowledgeSession>("knowledge:clear", {
                  bookId: book.id,
                })
                  .then((value) => {
                    receive(value);
                    setClearOpen(false);
                  })
                  .catch((e) => setError(e.message));
              }}
            >
              {tr("清空对话")}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
