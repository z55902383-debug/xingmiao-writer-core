import { tr } from "./i18n";
import { Component, lazy, Suspense, type ReactNode } from "react";
const RelationshipGraph = lazy(() => import("./RelationshipGraph"));
import ChapterRail from "./ChapterRail";
import { useEffect, useState } from "react";
import { Plus, Trash, PencilSimple, ArrowRight } from "@phosphor-icons/react";
import { api } from "./api";
import { Button, Field, Modal } from "./ui";
import type { Book, Character, TimelineEvent, TimelineSnapshot } from "./types";
const statuses: Record<string, string> = {
  active: "当前有效",
  superseded: "已被后续变化替代",
  planned: "计划中",
  future: "尚未到达",
  stale: "来源变化 · 待复核",
};

class RelationshipGraphBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="graph-load-error" role="alert">
          <div>
            <strong>{tr("关系图谱暂时无法显示")}</strong>
            <p>{tr("人物和关系资料仍保存在作品中，可以先在下方变化历程里查看或编辑；重新打开软件后可再试。")}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
export default function TimelinePanel({
  book,
  kind,
  chapterId,
  onChange,
  flush,
  notify,
  onEditPerson,
  onCreatePerson,
  editorOnly = false,
  initialEvent,
  createOnMount = false,
  onEditorClose,
}: {
  book: Book;
  kind: "world" | "people" | "all";
  chapterId: string;
  onChange: (b: Book) => void;
  flush: () => Promise<void>;
  notify: (s: string) => void;
  onEditPerson?: (c: Character) => void;
  onCreatePerson?: () => void;
  editorOnly?: boolean;
  initialEvent?: TimelineEvent;
  createOnMount?: boolean;
  onEditorClose?: () => void;
}) {
  const [at, setAt] = useState(chapterId),
    [snap, setSnap] = useState<TimelineSnapshot | null>(null),
    [draft, setDraft] = useState<TimelineEvent | null>(initialEvent || null),
    [remove, setRemove] = useState<TimelineEvent | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [person, setPerson] = useState(""),
    [layout, setLayout] = useState("vertical"),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [simpleRelation, setSimpleRelation] = useState(false);
  useEffect(() => {
    let live = true;
    api<TimelineSnapshot>("timeline:preview", {
      bookId: book.id,
      chapterId: at,
    })
      .then((v) => {
        if (live) setSnap(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [book, at]);
  const name = (id: string) =>
    book.characters.find((c) => c.id === id)?.name || "已删除人物";
  const filtered = (snap?.events || []).filter(
    (e) =>
      (kind === "all" ||
        (kind === "world" && e.kind === "world") ||
        (kind === "people" && e.kind !== "world")) &&
      (!person || e.characterId === person || e.targetId === person) &&
      (filter === "all" || e.state === filter) &&
      `${e.title}${e.entity}${e.value}${e.storyTime}`.includes(search),
  );
  const subject = (e: TimelineEvent) =>
    e.kind === "world"
      ? e.entity
      : e.kind === "relation"
        ? `${name(e.characterId)} → ${name(e.targetId)}`
        : name(e.characterId);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await flush();
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function create(from?: string, to?: string, simple = false) {
    setSimpleRelation(simple);
    setError("");
    setDraft({
      kind: kind === "world" ? "world" : "relation",
      title: "",
      entity: "",
      characterId: from || person || book.characters[0]?.id || "",
      targetId:
        to ||
        book.characters.find(
          (c) => c.id !== (from || person || book.characters[0]?.id),
        )?.id ||
        "",
      attribute: kind === "world" ? "政局" : "关系",
      value: "",
      chapterId: simple ? "" : at,
      phase: simple ? "confirmed" : "planned",
      sequence: 1,
      storyTime: "",
      evidence: "",
    });
  }
  useEffect(() => {
    if (createOnMount) create();
    // A canvas request mounts a fresh editor; source updates must not reset its draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function closeDraft() {
    setDraft(null);
    onEditorClose?.();
  }
  return (
    <section
      className={
        editorOnly ? "timeline-panel canvas-event-editor" : "timeline-panel"
      }
    >
      {!editorOnly && (
        <>
          <div className="timeline-top">
            <div>
              <h3>
                {kind === "world"
                  ? tr("世界演变")
                  : kind === "people"
                    ? tr("人物关系与状态")
                    : tr("跨章节变化记录")}
              </h3>
              <p>{tr("按章节回看状态，同一对象的同一维度保留完整变化历史。")}</p>
            </div>
            <Button variant="primary-soft" onClick={() => create()}>
              <Plus size={16} />{tr("记录变化")}</Button>
          </div>
          <div className="time-controls">
            <Field label={tr("查看时间点")}>
              <select value={at} onChange={(e) => setAt(e.target.value)}>
                <option value="">{tr("故事开始前")}</option>
                {book.chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}{" "}{tr("· 章末")}</option>
                ))}
              </select>
            </Field>
            {kind !== "world" && (
              <Field label={tr("聚焦人物")}>
                <select
                  value={person}
                  onChange={(e) => setPerson(e.target.value)}
                >
                  <option value="">{tr("全部人物")}</option>
                  {book.characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <p className="timeline-note">{tr("这里展示所选章末状态；AI 写该章时使用章首状态。计划、未来变化及来源失效的记录不会混入此前事实。")}</p>
          <ChapterRail book={book} value={at} onChange={setAt} />
          {kind === "people" && (
            <RelationshipGraphBoundary>
              <Suspense
                fallback={
                  <div className="graph-loading" role="status">
                    正在载入人物关系图谱…
                  </div>
                }
              >
                <RelationshipGraph
                  book={book}
                  snap={snap}
                  person={person}
                  onPerson={setPerson}
                  onEdit={onEditPerson}
                  onCreate={onCreatePerson}
                  onRelation={(from, to) => create(from, to, true)}
                  onEvent={(e) => {
                    setSimpleRelation(true);
                    setError("");
                    setDraft({ ...e });
                  }}
                />
              </Suspense>
            </RelationshipGraphBoundary>
          )}
          {kind === "world" && !!snap?.world.length && (
            <div className="current-world">
              {snap.world.map((e) => (
                <article key={e.id}>
                  <small>
                    {e.entity} · {e.attribute}
                  </small>
                  <b>{e.value}</b>
                </article>
              ))}
            </div>
          )}
          <div className="timeline-view-tools">
            <b>{tr("变化历程 ·")}{" "}{filtered.length}</b>
            <input
              aria-label={tr("搜索时间线")}
              placeholder={tr("搜索事件、对象、状态")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label={tr("筛选变化状态")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">{tr("全部状态")}</option>
              {Object.entries(statuses).map(([v, label]) => (
                <option key={v} value={v}>
                  {tr(label)}
                </option>
              ))}
            </select>
            <select
              aria-label={tr("时间线布局")}
              value={layout}
              onChange={(e) => setLayout(e.target.value)}
            >
              <option value="vertical">{tr("纵向时间线")}</option>
              <option value="alternating">{tr("交错时间线")}</option>
              <option value="horizontal">{tr("横向时间线")}</option>
            </select>
          </div>
          <div className={"event-timeline chrono-timeline " + layout}>
            <div className="timeline-origin">
              <span />{tr("故事起点 ·")}{" "}{kind === "world" ? tr("世界初始背景") : tr("人物初始档案")}{tr("保留在基础资料中")}</div>
            {filtered.map((e) => (
              <article key={e.id} className={`event-row ${e.state}`}>
                <span className="event-dot" />
                <div className="event-date">
                  {e.storyTime || e.chapterTitle}
                  <small>{tr("顺序")}{" "}{e.sequence}</small>
                </div>
                <div className="event-content">
                  <div className="event-title">
                    <b>{e.title}</b>
                    <span className="status-tag">
                      {tr(statuses[e.state || ""] || e.phase)}
                    </span>
                  </div>
                  <small>
                    {subject(e)} · {e.attribute}
                  </small>
                  <p>{e.value}</p>
                  {e.evidence && <blockquote>{e.evidence}</blockquote>}
                  <div className="event-actions">
                    <Button
                      onClick={() => {
                        setSimpleRelation(e.kind === "relation");
                        setError("");
                        setDraft({ ...e });
                      }}
                    >
                      <PencilSimple size={14} />
                      {e.state === "stale" ? tr("重新核对") : tr("编辑")}
                    </Button>
                    <Button
                      aria-label={tr("删除变化 {0}", {0: e.title})}
                      onClick={() => setRemove(e)}
                    >
                      <Trash size={14} />
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!filtered.length && (
            <p className="empty-timeline">{tr("记录一次变化，例如“王朝更替”“由盟友变成敌人”或“人物死亡”。初始资料继续保留，变化单独记在时间线上。")}</p>
          )}
          {error && (
            <p role="alert" className="error-box">
              {tr(error)}
            </p>
          )}
        </>
      )}
      {draft && simpleRelation && (
        <Modal
          title={draft.id ? tr("编辑人物关系") : tr("添加人物关系")}
          onClose={() => !busy && closeDraft()}
        >
          <div className="modal-body">
            <p className="timeline-note">{tr("选好两个人物，填上他们的关系就可以了。")}</p>
            <div className="form-row">
              <Field label={tr("人物一")}>
                <select
                  value={draft.characterId}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      characterId: e.target.value,
                      targetId:
                        e.target.value === draft.targetId ? "" : draft.targetId,
                    })
                  }
                >
                  <option value="">{tr("选择人物")}</option>
                  {book.characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr("人物二")}>
                <select
                  value={draft.targetId}
                  onChange={(e) =>
                    setDraft({ ...draft, targetId: e.target.value })
                  }
                >
                  <option value="">{tr("选择另一人物")}</option>
                  {book.characters
                    .filter((c) => c.id !== draft.characterId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <Field label={tr("他们是什么关系？")}>
              <input
                value={draft.value}

                placeholder={tr("例如：兄妹、朋友、恋人，也可以自己填写")}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              />
            </Field>
            <div className="relation-presets">
              {[
                "兄妹",
                "姐弟",
                "兄弟",
                "姐妹",
                "父子",
                "母女",
                "朋友",
                "恋人",
                "夫妻",
                "师徒",
                "同事",
                "盟友",
                "敌对",
              ].map((label) => (
                <Button
                  key={tr(label)}
                  aria-pressed={draft.value === label}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      value: label,
                      attribute: [
                        "兄妹",
                        "姐弟",
                        "兄弟",
                        "姐妹",
                        "父子",
                        "母女",
                      ].includes(label)
                        ? "亲属关系"
                        : ["恋人", "夫妻"].includes(label)
                          ? "情感关系"
                          : label === "师徒"
                            ? "师承关系"
                            : "相处关系",
                    })
                  }
                >
                  {tr(label)}
                </Button>
              ))}
            </div>
            <details>
              <summary>{tr("关系分类（可选）")}</summary>
              <Field
                label={tr("关系类别")}
                hint={tr("亲属、感情、相处等关系可以同时存在。例如兄妹也可以互相敌对。")}
              >
                <input
                  list="relation-categories"
                  value={draft.attribute}
                  onChange={(e) =>
                    setDraft({ ...draft, attribute: e.target.value })
                  }
                />
              </Field>
              <datalist id="relation-categories">
                {["亲属关系", "情感关系", "相处关系", "师承关系", "关系"].map(
                  (x) => (
                    <option key={x} value={x} />
                  ),
                )}
              </datalist>
            </details>
            <p className="notice">
              {draft.chapterId
                ? "这条关系记录属于：" +
                  (book.chapters.find((c) => c.id === draft.chapterId)?.title ||
                    "原章节")
                : tr("故事开始时就有的关系")}{" "}
              ·{" "}
              {draft.phase === "confirmed"
                ? tr("保存后直接显示在图谱中")
                : tr("这是后续计划，尚未发生")}
            </p>
            <Button
              onClick={() => {
                setDraft({
                  ...draft,
                  title:
                    draft.title ||
                    name(draft.characterId) +
                      "与" +
                      name(draft.targetId) +
                      "的关系",
                });
                setSimpleRelation(false);
              }}
            >{tr("设置后续变化 / 时间（可选）")}</Button>
            {error && (
              <p className="error-box" role="alert">
                {tr(error)}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <Button onClick={() => closeDraft()}>{tr("取消")}</Button>
            <Button
              variant="primary"
              disabled={
                busy ||
                !draft.characterId ||
                !draft.targetId ||
                draft.characterId === draft.targetId ||
                !draft.value.trim() ||
                !draft.attribute.trim()
              }
              onClick={() =>
                run(async () => {
                  onChange(
                    await api<Book>("timeline:save", {
                      bookId: book.id,
                      event: {
                        ...draft,
                        title:
                          draft.title ||
                          name(draft.characterId) +
                            "与" +
                            name(draft.targetId) +
                            "：" +
                            draft.value.slice(0, 60),
                      },
                    }),
                  );
                  closeDraft();
                  notify(tr("人物关系已保存"));
                })
              }
            >{tr("保存关系")}</Button>
          </div>
        </Modal>
      )}
      {draft && !simpleRelation && (
        <Modal
          title={draft.id ? tr("编辑时间线变化") : tr("记录时间线变化")}
          wide
          onClose={() => !busy && closeDraft()}
        >
          <div className="modal-body">
            <div className="form-row">
              <Field label={tr("变化类型")}>
                <select
                  value={draft.kind}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      kind: e.target.value as TimelineEvent["kind"],
                      attribute:
                        e.target.value === "relation"
                          ? "关系"
                          : e.target.value === "character"
                            ? "生存状态"
                            : "政局",
                    })
                  }
                >
                  <option value="world">{tr("世界变化")}</option>
                  <option value="character">{tr("人物状态")}</option>
                  <option value="relation">{tr("人物关系")}</option>
                </select>
              </Field>
              <Field label={tr("记录性质")}>
                <select
                  value={draft.phase}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      phase: e.target.value as TimelineEvent["phase"],
                    })
                  }
                >
                  <option value="planned">{tr("计划中 · 不作为事实")}</option>
                  <option value="confirmed">{tr("已确认 · 来源章须定稿")}</option>
                </select>
              </Field>
            </div>
            <Field label={tr("事件标题")}>
              <input
                maxLength={160}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder={tr("例如：旧王朝覆灭 / 林晚与陈默决裂")}
              />
            </Field>
            {draft.kind === "world" ? (
              <Field label={tr("变化对象")}>
                <input
                  value={draft.entity}
                  onChange={(e) =>
                    setDraft({ ...draft, entity: e.target.value })
                  }
                  placeholder={tr("例如：北境王国")}
                />
              </Field>
            ) : (
              <div className="form-row">
                <Field label={tr("主体人物")}>
                  <select
                    value={draft.characterId}
                    onChange={(e) =>
                      setDraft({ ...draft, characterId: e.target.value })
                    }
                  >
                    <option value="">{tr("选择人物")}</option>
                    {book.characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {draft.kind === "relation" && (
                  <Field label={tr("关系对象")}>
                    <select
                      value={draft.targetId}
                      onChange={(e) =>
                        setDraft({ ...draft, targetId: e.target.value })
                      }
                    >
                      <option value="">{tr("选择另一人物")}</option>
                      {book.characters
                        .filter((c) => c.id !== draft.characterId)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
              </div>
            )}
            <div className="form-row">
              <Field
                label={tr("变化维度")}
                hint={tr("同一对象、同一维度的新记录覆盖旧状态。如生存状态、阵营、关系。")}
              >
                <input
                  list="event-attributes"
                  value={draft.attribute}
                  onChange={(e) =>
                    setDraft({ ...draft, attribute: e.target.value })
                  }
                />
              </Field>
              <Field label={tr("生效章节")}>
                <select
                  value={draft.chapterId}
                  onChange={(e) =>
                    setDraft({ ...draft, chapterId: e.target.value })
                  }
                >
                  <option value="">{tr("故事开始前")}</option>
                  {book.chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                      {c.status === "final" ? tr(" · 已定稿") : tr(" · 草稿")}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <datalist id="event-attributes">
              {["生存状态", "关系", "阵营", "身份", "地点", "政局", "规则"].map(
                (x) => (
                  <option key={x} value={x} />
                ),
              )}
            </datalist>
            <Field label={tr("变化后的状态")}>
              <textarea
                rows={3}
                value={draft.value}

                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                placeholder={tr("例如：死亡；由盟友转为敌对；北境进入封锁状态。")}
              />
            </Field>
            <div className="form-row">
              <Field label={tr("故事内时间（可选）")}>
                <input
                  value={draft.storyTime}
                  onChange={(e) =>
                    setDraft({ ...draft, storyTime: e.target.value })
                  }
                  placeholder={tr("第三日清晨 / 帝国历 102 年")}
                />
              </Field>
              <Field label={tr("章内先后顺序")}>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={draft.sequence}
                  onChange={(e) =>
                    setDraft({ ...draft, sequence: Number(e.target.value) })
                  }
                />
              </Field>
            </div>
            <Field
              label={tr("原文证据（可选）")}
              hint={tr("填写时必须能在来源章找到；留空表示作者手动确认。")}
            >
              <textarea
                rows={2}
                value={draft.evidence}
                onChange={(e) =>
                  setDraft({ ...draft, evidence: e.target.value })
                }
              />
            </Field>
            {error && <p className="error-box">{tr(error)}</p>}
          </div>
          <div className="modal-footer">
            <Button onClick={() => closeDraft()}>{tr("取消")}</Button>
            <Button
              disabled={busy}
              variant="primary"
              onClick={() =>
                run(async () => {
                  onChange(
                    await api<Book>("timeline:save", {
                      bookId: book.id,
                      event: draft,
                    }),
                  );
                  closeDraft();
                  notify(tr("时间线变化已保存"));
                })
              }
            >{tr("保存变化")}</Button>
          </div>
        </Modal>
      )}
      {remove && (
        <Modal title={tr("删除时间线变化？")} onClose={() => setRemove(null)}>
          <div className="modal-body">
            <p>{tr("记录移入回收站；删除最新变化后，该维度会重新使用之前的有效状态。")}</p>
          </div>
          <div className="modal-footer">
            <Button onClick={() => setRemove(null)}>{tr("取消")}</Button>
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  onChange(
                    await api<Book>("timeline:delete", {
                      bookId: book.id,
                      id: remove.id,
                    }),
                  );
                  setRemove(null);
                })
              }
            >{tr("确认删除变化")}</Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
