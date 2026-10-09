import { tr } from "./i18n";
import { useEffect, useState } from "react";
import {
  Plus,
  Trash,
  PencilSimple,
  BookOpen,
  ArrowRight,
  CircleDashed,
  ListChecks,
  CheckCircle,
} from "@phosphor-icons/react";
import type { Book, Chapter, Volume, Kind } from "./types";
import { api } from "./api";
import { Button, Field, Modal } from "./ui";
import { PlanExcerpt } from "./PlanningText";
import "./planner-hierarchy.css";
export default function VolumePlanner({
  panel,
  book,
  onGenerate,
  generating,
  onChange,
  flush,
  editChapter,
  onOpen,
  notify,
  onNavigateToPlan,
  onSwitchToVolumes,
  focusRequest,
}: {
  panel: "timeline" | "volumes" | "board";
  book: Book;
  onGenerate: (kind: Kind, chapterId?: string, volumeId?: string) => void;
  generating: boolean;
  onChange: (b: Book) => void;
  flush: () => Promise<void>;
  editChapter: (id: string, p: Partial<Chapter>) => void;
  onOpen: (id: string) => void;
  notify: (s: string) => void;
  onNavigateToPlan: (id: string) => void;
  onSwitchToVolumes: () => void;
  focusRequest?: { id: string; stamp: string };
}) {
  const [draft, setDraft] = useState<Partial<Volume> | null>(null),
    [remove, setRemove] = useState<Volume | null>(null),
    [removeChapter, setRemoveChapter] = useState<Chapter | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [expandedChapter, setExpandedChapter] = useState("");
  const [volumeFilter, setVolumeFilter] = useState("all");
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!focusRequest) return;
    setVolumeFilter("all"); setQuery("");
    if (focusRequest.id.startsWith("plan-")) setExpandedChapter(focusRequest.id.slice(5));
    window.setTimeout(() => document.getElementById(focusRequest.id)?.scrollIntoView({block:"start"}), 50);
  }, [focusRequest?.stamp]);
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
  const groups = [
    ...(book.volumes || []),
    ...(book.chapters.some(c=>!c.volumeId) ? [{ id: "", title: "未分卷章节", outline: "", detail: "" }] : []),
  ];
  const plannedChapterCount = book.chapters.filter((chapter) => chapter.summary?.trim()).length;
  const finalizedChapterCount = book.chapters.filter((chapter) => chapter.status === "final").length;
  const planProgress = book.chapters.length
    ? Math.round((plannedChapterCount / book.chapters.length) * 100)
    : 0;
  const visibleChapters = (volume: { id: string; title: string }) => book.chapters.filter(
    (chapter) => (chapter.volumeId || "") === volume.id &&
      (!query.trim() || volume.title.includes(query.trim()) || chapter.title.includes(query.trim())),
  );
  const boardColumns = [
    { id: "todo", title: "待规划", chapters: book.chapters.filter((c) => !c.summary?.trim() && !c.outline.trim() && !c.body.trim()) },
    { id: "planning", title: "规划中", chapters: book.chapters.filter((c) => !c.body.trim() && (!!c.summary?.trim() || !!c.outline.trim()) && !(c.summary?.trim() && c.outline.trim())) },
    { id: "planned", title: "已规划", chapters: book.chapters.filter((c) => !c.body.trim() && !!c.summary?.trim() && !!c.outline.trim()) },
    { id: "drafted", title: "已完成正文", chapters: book.chapters.filter((c) => !!c.body.trim()) },
  ];
  return (
    <section className="volume-planner">
      {panel === "timeline" && <div className="outline-journey" aria-label={tr("故事发展时间线")}>
        <div className="timeline-top">
          <div>
            <h3>{tr("故事发展时间线")}</h3>
            <p>{tr("从卷目标到章节概要，快速看清故事推进到哪里。")}</p>
          </div>
          <Button variant="primary-soft" onClick={onSwitchToVolumes}>
            <PencilSimple size={15} />{tr("继续规划")}</Button>
        </div>
        <div className="journey-overview" aria-label={tr("章节规划进度")}>
          <div className="journey-overview-label">
            <span>{tr("章节概要")}</span>
            <b>{plannedChapterCount}<i> / {book.chapters.length}</i></b>
          </div>
          <div className="journey-progress-track" role="progressbar" aria-label={tr("章节概要完成度")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={planProgress}>
            <span style={{ transform: `scaleX(${planProgress / 100})` }} />
          </div>
          <small>{finalizedChapterCount}{" "}{tr("章已定稿")}</small>
        </div>
        {groups.length === 0 ? (
          <div className="planner-empty">
            <BookOpen size={22} />
            <strong>{tr("还没有故事计划")}</strong>
            <p>{tr("先创建分卷或章节，时间线就会在这里展示故事推进顺序。")}</p>
            <Button variant="primary-soft" onClick={onSwitchToVolumes}>{tr("开始规划分卷与章节")}<ArrowRight size={15} />
            </Button>
          </div>
        ) : groups
          .filter((v) => v.id || book.chapters.some((c) => !c.volumeId))
          .map((v, i) => (
            <div className="journey-stage" key={v.id}>
              <button
                className="journey-volume"
                onClick={() => onNavigateToPlan("volume-" + (v.id || "none"))}
              >
                <small className="journey-volume-index">
                  {v.id ? "卷 " + String(i + 1).padStart(2, "0") : tr("待归卷")}
                </small>
                <b>{v.title}</b>
                <p>
                  {v.outline
                    ? v.outline.slice(0, 180)
                    : v.id ? tr("补充卷大纲，明确这一阶段的冲突与目标") : tr("这些章节尚未归入任何分卷，可在下方修改、归卷或删除。")}
                </p>
              </button>
              <div className="journey-chapters">
                {book.chapters
                  .filter((c) => (c.volumeId || "") === v.id)
                  .map((c, chapterIndex) => (
                    <button
                      key={c.id}
                      aria-label={tr("打开规划：{0}", {0: c.title})}
                      onClick={() => onNavigateToPlan("plan-" + c.id)}
                    >
                      <span className="journey-chapter-meta">
                        <small>{tr("第")}{" "}{String(chapterIndex + 1).padStart(2, "0")}{" "}{tr("章")}</small>
                        <small className={c.status === "final" ? "is-final" : ""}>
                          {c.status === "final" ? tr("已定稿") : c.summary?.trim() ? tr("概要已写") : tr("待规划")}
                        </small>
                      </span>
                      <b>{c.title || tr("第{0}章", {0: chapterIndex + 1})}</b>
                      <p>{c.summary || tr("待填写章节概要")}</p>
                      <ArrowRight className="journey-chapter-arrow" size={15} aria-hidden="true" />
                    </button>
                  ))}
              </div>
            </div>
          ))}
      </div>}
      {panel === "board" && <div className="chapter-board">
        <div className="chapter-board-heading">
          <div><h3>{tr("章节规划看板")}</h3><p>{tr("按规划进度浏览章节；点卡片编辑计划，或直接进入正文。")}</p></div>
          <span>{book.chapters.length}{" "}{tr("章")}</span>
        </div>
        <div className="chapter-board-lanes">
          {boardColumns.map((column) => <section key={column.id} className="chapter-board-lane" data-stage={column.id} aria-label={tr(column.title)}>
            <header><strong>
              {column.id === "todo" ? <CircleDashed size={17} /> : column.id === "planning" ? <PencilSimple size={17} /> : column.id === "planned" ? <ListChecks size={17} /> : <CheckCircle size={17} />}
              {tr(column.title)}</strong><span>{column.chapters.length}</span></header>
            <div className="chapter-board-cards">
              {column.chapters.map((chapter) => <article key={chapter.id} data-stage={column.id}>
                <button className="chapter-board-card-main" onClick={() => onNavigateToPlan("plan-" + chapter.id)}>
                  <small className="chapter-board-volume">{book.volumes?.find((volume) => volume.id === chapter.volumeId)?.title || tr("未分卷")}</small>
                  <strong>{chapter.title || tr("未命名章节")}</strong>
                  <span>{chapter.summary || chapter.outline || tr("先写下这一章要发生什么")}</span>
                  <small>{chapter.status === "final" ? tr("已定稿") : chapter.body.trim() ? tr("正文草稿") : chapter.summary?.trim() ? tr("概要已写") : tr("待规划")}</small>
                </button>
                <button className="chapter-board-write" onClick={() => onOpen(chapter.id)}>{tr("进入正文")}{" "}<ArrowRight size={13} /></button>
              </article>)}
              {!column.chapters.length && <p className="chapter-board-empty">{tr("暂无章节")}</p>}
            </div>
          </section>)}
        </div>
      </div>}
      {panel === "volumes" && <>
        <div className="timeline-top">
          <div>
            <h3>{tr("分卷与章节规划")}</h3>
            <p>{tr("全文大纲 → 分卷 → 卷大纲/细纲 → 章节大纲/细纲 → 正文。每步生成后核对并采用。")}</p>
          </div>
          <div className="planner-heading-actions"><Button disabled={generating || !book.outline.trim()} onClick={() => onGenerate("volumePlan")}>{tr("生成分卷规划")}</Button><Button
            onClick={() => setDraft({ title: "", outline: "", detail: "" })}
          >
            <Plus size={16} />{tr("新建分卷")}</Button></div>
        </div>
        <div className="planner-filters"><Field label={tr("查看分卷")}><select value={volumeFilter} onChange={e => setVolumeFilter(e.target.value)}><option value="all">{tr("全部分卷")}</option>{groups.map(v => <option key={v.id || "none"} value={v.id || "none"}>{v.title}</option>)}</select></Field><Field label={tr("查找章节")}><input value={query} onChange={e => setQuery(e.target.value)} placeholder={tr("输入卷名或章名")}/></Field></div>
      {groups.filter(v => (volumeFilter === "all" || (v.id || "none") === volumeFilter) && (!query.trim() || v.title.includes(query.trim()) || book.chapters.some(c => (c.volumeId || "") === v.id && c.title.includes(query.trim())))).map((v) => (
        <article
          className="volume-block"
          key={v.id}
          id={"volume-" + (v.id || "none")}
        >
          <header>
            <BookOpen size={19} />
            <h3>{v.title}</h3>
            <span>
              {book.chapters.filter((c) => (c.volumeId || "") === v.id).length}{" "}{tr("章")}</span>
            {v.id && (
              <>
                <Button
                  aria-label={tr("编辑分卷 {0}", {0: v.title})}
                  onClick={() => setDraft({ ...v })}
                >
                  <PencilSimple size={15} />
                </Button>
                <Button
                  aria-label={tr("删除分卷 {0}", {0: v.title})}
                  onClick={() => setRemove(v)}
                >
                  <Trash size={15} />
                </Button>
              </>
            )}
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const c = await api<Chapter>("chapter:create", {
                    bookId: book.id,
                  });
                  const b = await api<Book>("chapter:organize", {
                    id: c.id,
                    volumeId: v.id,
                  });
                  onChange(b);
                  // 以前这里直接 onOpen 把人甩到正文页，想连着规划几章就得来回跑。
                  // 大纲页是「规划」场景：留在原地，列表即时更新，去写用该章的「进入正文」。
                  notify(tr("{0} 已加入本书，可以接着添加，或点它的「进入正文」开始写", {0: c.title}));
                })
              }
            >
              <Plus size={15} />{tr("添加章节")}</Button>
          </header>
          {!v.id && <p className="unassigned-note">{tr("这是尚未归卷的章节集合。选择章节所属分卷即可移入已有卷；移走或删除全部章节后，此分组自动消失。")}</p>}
          {v.id && (
            <>
              <div className="section-generation">
                <Button
                  disabled={generating}
                  onClick={() => onGenerate("volumeOutline", undefined, v.id)}
                >{tr("生成卷大纲")}</Button>
                <Button
                  disabled={generating || !v.outline.trim()}
                  onClick={() => onGenerate("volumeDetail", undefined, v.id)}
                >{tr("生成卷细纲")}</Button>
                <Button disabled={generating || !v.detail.trim()} onClick={() => onGenerate("chapterPlan", undefined, v.id)}>{tr("生成本卷章节规划")}</Button>
                <Button disabled={generating || !book.chapters.some(c => c.volumeId === v.id)} onClick={() => onGenerate("chapterDetails", undefined, v.id)}>{tr("补全本卷章节细纲")}</Button>
              </div>
              <div className="volume-plans">
                <PlanExcerpt title={tr("卷大纲")} text={v.outline} empty={tr("生成或编辑分卷，记录本卷目标、主冲突与结局。")}/>
                <PlanExcerpt title={tr("卷细纲")} text={v.detail} empty={tr("采用卷大纲后，展开阶段事件、转折与伏笔。")}/>
              </div>
            </>
          )}
          <section className="volume-chapters" aria-label={v.title + " · " + tr("本卷章节")}>
            <div className="volume-chapters-heading"><h4>{tr(v.id ? "本卷章节" : "未分卷章节")}</h4><span>{visibleChapters(v).length}{" "}{tr("章")}</span></div>
            <div className="volume-chapter-list">
          {visibleChapters(v)
            .map((c) => (
              <div className="volume-chapter" key={c.id} id={"plan-" + c.id}>
                <div className="volume-chapter-head">
                  <input aria-label={tr("修改章节名称 {0}", {0: c.title})} value={c.title} maxLength={160} onChange={e=>editChapter(c.id,{title:e.target.value})}/>
                  <select
                    aria-label={tr("{0}所属分卷", {0: c.title})}
                    value={c.volumeId || ""}
                    disabled={busy}
                    onChange={(e) => {
                      const volumeId = e.target.value;
                      run(async () =>
                        onChange(
                          await api<Book>("chapter:organize", {
                            id: c.id,
                            volumeId,
                          }),
                        ),
                      );
                    }}
                  >
                    <option value="">{tr("未分卷")}</option>
                    {book.volumes?.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.title}
                      </option>
                    ))}
                  </select>
                  <Button onClick={() => onOpen(c.id)}>{tr("进入正文")}<ArrowRight size={15} />
                  </Button>
                </div>
                <div className="section-generation chapter-steps">
                  <Button
                    className="chapter-flow-button"
                    disabled={generating}
                    onClick={() => onGenerate("summary", c.id)}
                  >
                    <span className="chapter-step-number">1</span>{tr("生成章节概要")}</Button>
                  <Button
                    className="chapter-flow-button"
                    disabled={generating}
                    onClick={() => onGenerate("outline", c.id)}
                  >
                    <span className="chapter-step-number">2</span>{tr("生成本章细纲")}</Button>
                  <Button
                    className="chapter-flow-button"
                    disabled={generating}
                    onClick={() => onGenerate("write", c.id)}
                  >
                    <span className="chapter-step-number">3</span>{tr("按细纲写正文")}</Button>
                  <Button className="chapter-delete-action" aria-label={tr("删除章节 {0}", {0: c.title})} disabled={busy || generating} onClick={()=>setRemoveChapter(c)}><Trash size={15}/>{tr("删除章节")}</Button>
                </div>
                <div className="chapter-plan-status"><span className={c.summary?.trim() ? "is-complete" : "is-pending"}>{tr(c.summary?.trim() ? "概要已填写" : "概要待生成")}</span><span className={c.outline.trim() ? "is-complete" : "is-pending"}>{tr(c.outline.trim() ? "细纲已填写" : "细纲待生成")}</span><span className={c.body.trim() ? "is-complete" : "is-pending"}>{tr(c.body.trim() ? "正文已填写" : "正文待生成")}</span></div>
                <details className="chapter-plan-editor" open={expandedChapter === c.id} onToggle={e => { if (e.currentTarget.open) setExpandedChapter(c.id); else setExpandedChapter(current => current === c.id ? "" : current); }}>
                  <summary>{tr("查看 / 编辑章节规划")}</summary>
                <Field label={tr("{0}章节概要", {0: c.title})}>
                  <textarea
                    rows={2}
                    value={c.summary || ""}
                    onChange={(e) =>
                      editChapter(c.id, { summary: e.target.value })
                    }
                    placeholder={tr("这一章的主要事件与阶段目标")}
                  />
                </Field>
                  <Field label={tr("{0}章节细纲", {0: c.title})}>
                    <textarea
                      rows={4}
                      value={c.outline}
                      onChange={(e) =>
                        editChapter(c.id, { outline: e.target.value })
                      }
                      placeholder={tr("场景、人物、冲突、转折、伏笔、章末钩子")}
                    />
                  </Field>
                </details>
              </div>
            ))}
            </div>
            {!visibleChapters(v).length && <p className="planner-chapter-empty">{tr(query.trim() ? "没有匹配的章节。" : "此分卷还没有章节，可点击上方「添加章节」开始规划。")}</p>}
          </section>
        </article>
      ))}
      </>}
      {error && <p className="error-box">{tr(error)}</p>}
      {draft && (
        <Modal
          title={draft.id ? tr("编辑分卷") : tr("新建分卷")}
          wide
          onClose={() => !busy && setDraft(null)}
        >
          <div className="modal-body">
            <Field label={tr("卷名")}>
              <input
                value={draft.title || ""}
                maxLength={160}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </Field>
            <Field label={tr("卷大纲")}>
              <textarea
                rows={4}
                value={draft.outline || ""}
                onChange={(e) =>
                  setDraft({ ...draft, outline: e.target.value })
                }
                placeholder={tr("本卷目标、核心冲突、高潮与结束状态")}
              />
            </Field>
            <Field label={tr("卷细纲")}>
              <textarea
                rows={7}
                value={draft.detail || ""}
                onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
                placeholder={tr("按阶段或事件展开本卷，并安排伏笔回收")}
              />
            </Field>
            {error && <p className="error-box">{tr(error)}</p>}
          </div>
          <div className="modal-footer">
            <Button onClick={() => setDraft(null)}>{tr("取消")}</Button>
            <Button
              disabled={busy}
              variant="primary"
              onClick={() =>
                run(async () => {
                  onChange(
                    await api<Book>("volume:save", {
                      bookId: book.id,
                      volume: draft,
                    }),
                  );
                  setDraft(null);
                  notify(tr("分卷已保存"));
                })
              }
            >{tr("保存分卷")}</Button>
          </div>
        </Modal>
      )}
      {removeChapter && <Modal title={tr("删除这个章节？")} onClose={()=>!busy && setRemoveChapter(null)}><div className="modal-body"><p>“{removeChapter.title}{tr("”及其正文、概要和细纲将移入回收站，可恢复。相关记忆会标记为待复核。")}</p></div><div className="modal-footer"><Button onClick={()=>setRemoveChapter(null)}>{tr("取消")}</Button><Button disabled={busy} onClick={()=>run(async()=>{await api("chapter:delete",{id:removeChapter.id});onChange(await api<Book>("book:get",{id:book.id}));setRemoveChapter(null);notify(tr("章节已移入回收站"));})}>{tr("确认删除章节")}</Button></div>{error && <p role="alert" className="error-box">{tr(error)}</p>}</Modal>}
      {remove && (
        <Modal title={tr("删除分卷？")} onClose={() => setRemove(null)}>
          <div className="modal-body">
            <p>{tr("卷大纲与细纲移入回收站，章节保留并移到“未分卷章节”。")}</p>
          </div>
          <div className="modal-footer">
            <Button onClick={() => setRemove(null)}>{tr("取消")}</Button>
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  onChange(
                    await api<Book>("volume:delete", {
                      bookId: book.id,
                      id: remove.id,
                    }),
                  );
                  setRemove(null);
                })
              }
            >{tr("确认删除分卷")}</Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
