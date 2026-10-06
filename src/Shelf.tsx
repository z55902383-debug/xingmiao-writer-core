import LanguageSwitcher from "./LanguageSwitcher";
import { tr, genreLabel, useLanguage } from "./i18n";
import { useMemo, useState } from "react";
import {
  Plus,
  MagnifyingGlass,
  ArrowUpRight,
  BookOpen,
  Archive,
  Sparkle,
  
  ArrowCounterClockwise,
  
  PencilLine,
  DownloadSimple,
  UploadSimple,
  Trash,
  GearSix,
  Books,
  Sun,
  Moon,
  DotsThree,
  Export,
  ListDashes,
  SquaresFour,
  CaretRight,
} from "@phosphor-icons/react";
import { api, number, date } from "./api";
import { currentTheme, toggleThemeFrom } from "./theme";
import type { BookSummary } from "./types";
import { Button, Empty, Field, IconButton, Menu, Modal } from "./ui";



/* 书架浏览偏好（排序 / 筛选 / 视图）只影响本机显示，存在 localStorage */
const SHELF_KEY = "xm-shelf-view";
type ShelfView = { sort: "recent" | "created" | "title"; compact: boolean };
function loadShelfView(): ShelfView {
  try {
    const raw = JSON.parse(localStorage.getItem(SHELF_KEY) || "{}");
    return {
      sort: ["recent", "created", "title"].includes(raw.sort)
        ? raw.sort
        : "recent",
      compact: !!raw.compact,
    };
  } catch {
    return { sort: "recent", compact: false };
  }
}
/* 创作状态由数据推导，不新增存储字段 */
function bookStage(b: BookSummary) {
  if (b.archived) return { id: "archived", label: "已归档" };
  if (!b.chapterCount) return { id: "idea", label: "构思中" };
  if (b.target > 0 && b.words >= b.target)
    return { id: "done", label: "已完成" };
  return { id: "writing", label: "连载中" };
}
// Keep each cover's identity when sorting or filtering the library.
function coverVariant(id: string) {
  return Array.from(id).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 3;
}
function sinceLabel(iso: string) {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return tr("今天");
  if (days === 1) return tr("昨天");
  if (days < 30) return tr("{0} 天前", {0: days});
  return date(iso);
}
export function NewBook({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (v: {
    title: string;
    genre: string;
    premise: string;
    target: number;
  }) => Promise<void>;
}) {
  const [value, setValue] = useState({
    title: "",
    genre: "都市",
    premise: "",
    target: 200000,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={tr("开始一个新的故事")} onClose={() => !busy && onClose()}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onCreate(value);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <p className="muted">{tr("先记下故事的起点。人物、设定和章节，之后慢慢展开。")}</p>
          <Field label={tr("书名 *")}>
            <input
              autoFocus
              required
              maxLength={120}
              value={value.title}
              onChange={(e) => setValue({ ...value, title: e.target.value })}
              placeholder={tr("给这个故事起个名字")}
            />
          </Field>
          <div className="form-row">
            <Field label={tr("题材")}>
              <select
                value={value.genre}
                onChange={(e) => setValue({ ...value, genre: e.target.value })}
              >
                {[
                  "都市",
                  "悬疑",
                  "玄幻",
                  "仙侠",
                  "科幻",
                  "言情",
                  "历史",
                  "奇幻",
                  "其他",
                ].map((x) => (
                  <option key={x} value={x}>{tr(x)}</option>
                ))}
              </select>
            </Field>
            <Field label={tr("目标字数")}>
              <input
                type="number"
                min={1000}
                max={10000000}
                step={1000}
                value={value.target}
                onChange={(e) =>
                  setValue({ ...value, target: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <Field label={tr("故事灵感")} hint={tr("一句话的设想也可以，暂时没有就留空。")}>
            <textarea
              rows={4}
              value={value.premise}

              onChange={(e) => setValue({ ...value, premise: e.target.value })}
              placeholder={tr("谁，在什么处境里，想完成什么？")}
            />
          </Field>
          {error && (
            <p className="error-box" role="alert">
              {tr(error)}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>{tr("暂不创建")}</Button>
          <Button variant="primary" busy={busy} type="submit">
            <Plus size={18} />{tr("创建作品")}</Button>
        </div>
      </form>
    </Modal>
  );
}
export default function Shelf({
  books,
  onNew,
  onOpen,
  onDemo,
  onArchive,
  onDelete,
  onSettings,
  
  
  
  onBackup,
  onRestore,
  busy,
}: {
  books: BookSummary[];
  onNew: () => void;
  onOpen: (id: string, chapterId?: string) => void;
  onDemo: () => void;
  onArchive: (b: BookSummary) => void;
  onDelete: (b: BookSummary) => void;
  onSettings: () => void;
  
  
  
  onBackup: () => void;
  onRestore: () => void;
  busy: boolean;
}) {
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  
  const [genre, setGenre] = useState("");
  const [view, setView] = useState<ShelfView>(loadShelfView);
  const setShelfView = (patch: Partial<ShelfView>) =>
    setView((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SHELF_KEY, JSON.stringify(next));
      } catch {
        /* 忽略持久化失败 */
      }
      return next;
    });
  const [light, setLight] = useState(() => currentTheme() === "light");
  const language = useLanguage();
  const genres = useMemo(
    () => [...new Set(books.map((b) => b.genre).filter(Boolean))].sort(),
    [books]);
  const visible = useMemo(() => {
    const match = books.filter(
      (b) =>
        b.archived === archived &&
        `${b.title} ${b.genre} ${genreLabel(b.genre)} ${b.premise || ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) &&
        (!genre || b.genre === genre));
    const by: Record<
      ShelfView["sort"],
      (a: BookSummary, b: BookSummary) => number
    > = {
      recent: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
      title: (a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"),
    };
    return [...match].sort(by[view.sort]);
  }, [books, search, archived, genre, view.sort, language]);
  const active = books.filter((b) => !b.archived);
  const recentBook = active.reduce<BookSummary | null>(
    (latest, book) =>
      !latest || book.updatedAt > latest.updatedAt ? book : latest,
    null);
  const total = active.reduce((s, b) => s + b.words, 0);
  const finished = active.filter(
    (b) => b.target > 0 && b.words >= b.target).length;
  const lastTouched = active.reduce(
    (acc, b) => (b.updatedAt > acc ? b.updatedAt : acc),
    "");
  const dayKeys = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (6 - i));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const week = dayKeys.map((key) =>
    active.reduce(
      (sum, book) =>
        sum +
        ((book.writingActivity || []).find((d) => d.date === key)?.netWords ??
          0),
      0));
  const weekTotal = week.reduce((sum, n) => sum + n, 0);
  const writingDays = week.filter((n) => n > 0).length;
  const chartMax = Math.max(1, ...week.map((n) => Math.max(0, n)));
  return (
    <div className="shelf-shell">
      <aside className="shelf-nav">
        <div className="brand">
          <div className="brand-mark">
            <img src="./cat-avatar.png" alt={tr("星喵头像")} className="cat-avatar" />
          </div>
          <div>
            <strong>{tr("星喵写作")}</strong>
            <small>{tr("让故事，慢慢生长")}</small>
          </div>
        </div>
        <div className="nav-caption">{tr("创作空间")}</div>
        <button
          className={`nav-item ${!archived ? "active" : ""}`}
          aria-current={!archived ? "page" : undefined}
          onClick={() => { setArchived(false); }}
        >
          <Books size={20} />{tr("我的书架")}<span>{active.length}</span>
        </button>
        <button
          className={`nav-item ${archived ? "active" : ""}`}
          aria-current={archived ? "page" : undefined}
          onClick={() => { setArchived(true); }}
        >
          <Archive size={20} />{tr("已归档")}<span>{books.length - active.length}</span>
        </button>
        
        
        <div className="shelf-nav-bottom">
          <button
            type="button"
            className="nav-item"
            onClick={(event) =>
              setLight(toggleThemeFrom(event.currentTarget) === "light")
            }
            title={tr("切换深浅主题")}
            aria-label={light ? tr("切换到深色模式") : tr("切换到浅色模式")}
          >
            {light ? <Moon size={20} /> : <Sun size={20} />}
            {light ? tr("深色模式") : tr("浅色模式")}
          </button>
          <button className="nav-item" onClick={onBackup}>
            <DownloadSimple size={20} />{tr("备份作品")}</button>
          <button className="nav-item" onClick={onRestore}>
            <UploadSimple size={20} />{tr("恢复备份")}</button>
          <button className="nav-item" onClick={onSettings}>
            <GearSix size={20} />{tr("模型与设置")}</button>
          
          <div className="local-note">
            <i />{tr("本地创作空间")}</div>
        </div>
      </aside>
      <main className={`shelf-main ${"shelf-home"}`}>
        {<>
        <header className="shelf-top">
          <span>{tr("创作工作台")}{" "}<span className="slash">/</span>{" "}
            {archived ? tr("已归档") : tr("我的书架")}
          </span>
          <div className="shelf-top-actions">
          <LanguageSwitcher />
          <span className="quiet-pill">
            <span className="dot" />{tr("作品保存在本机")}</span>
          </div>
        </header>
        <div className="shelf-content">
          <div className="shelf-heading">
            <div>
              <h1>
                {archived ? tr("暂时合上的故事") : tr("我的书架")}
              </h1>
              <p>{tr("写下一个念头，让它成为一个世界。")}</p>
            </div>
            <Button variant="primary" onClick={onNew} disabled={busy}>
              <Plus size={19} />{tr("新建作品")}</Button>
          </div>
          {!archived && !search && !genre && recentBook && (
            <section className="recent-project" aria-label={tr("最近创作")}>
              <div className="recent-project-mark" aria-hidden="true"><PencilLine size={25} weight="duotone" /></div>
              <div className="recent-project-copy">
                <span>{tr("最近创作")}</span>
                <strong>{recentBook.title}</strong>
                <small>
                  {recentBook.recentChapterTitle || tr("还没有章节")}
                  <i>·</i>{tr("上次编辑于")}{" "}{sinceLabel(recentBook.updatedAt)}
                </small>
              </div>
              <Button
                variant="primary-soft"
                onClick={() =>
                  onOpen(recentBook.id, recentBook.recentChapterId)
                }
                disabled={busy}
              >{tr("继续写作")}{" "}<ArrowUpRight size={16} />
              </Button>
            </section>
          )}
          <div className="shelf-summary">
            <div>
              <b>{number(active.length)}</b>
              <span>{tr("部进行中的作品", {count: active.length})}</span>
            </div>
            <div>
              <b>{number(total)}</b>
              <span>{tr("累计字数 ·")}{" "}{finished}{" "}{tr("部达到目标", {count: finished})}</span>
            </div>
            <div>
              <b>{sinceLabel(lastTouched)}</b>
              <span>{tr("最近一次动笔")}</span>
            </div>
            <div className="summary-note">
              <div className="shelf-week-copy">
                <b>
                  {weekTotal > 0 ? `+${number(weekTotal)}` : number(weekTotal)}
                </b>
                <span>{tr("近 7 天净增字数 · 写作")}{" "}{writingDays}{" "}{tr("天", {count: writingDays})}</span>
              </div>
              <div
                className="shelf-week-chart"
                aria-label={tr("近7天每日净增字数：{0}", {0: week.join("、")})}
              >
                {week.map((n, i) => (
                  <span key={dayKeys[i]} title={tr("{0}：{1} 字", {0: dayKeys[i], 1: n})}>
                    <i
                      style={{
                        height: `${Math.max(4, (Math.max(0, n) / chartMax) * 30)}px`,
                      }}
                    />
                    <small>
                      {
                        ["一", "二", "三", "四", "五", "六", "日"].map(trDay => tr(trDay).slice(0, 1))[
                          new Date(`${dayKeys[i]}T12:00:00`).getDay() === 0
                            ? 6
                            : new Date(`${dayKeys[i]}T12:00:00`).getDay() - 1
                        ]
                      }
                    </small>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="shelf-tools">
            <h2>
              {archived ? tr("归档作品") : tr("全部作品")} <span>{visible.length}</span>
            </h2>
            <div className="shelf-filters">
              <div className="search">
                <MagnifyingGlass size={18} />
                <input
                  aria-label={tr("搜索作品")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={tr("搜索书名、题材或简介")}
                />
              </div>
              {genres.length > 1 && (
                <select
                  aria-label={tr("按题材筛选")}
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                >
                  <option value="">{tr("全部题材")}</option>
                  {genres.map((g) => (
                    <option key={g} value={g}>
                      {genreLabel(g)}
                    </option>
                  ))}
                </select>
              )}
              <select
                aria-label={tr("排序方式")}
                value={view.sort}
                onChange={(e) =>
                  setShelfView({ sort: e.target.value as ShelfView["sort"] })
                }
              >
                <option value="recent">{tr("最近编辑")}</option>
                <option value="created">{tr("创建时间")}</option>
                <option value="title">{tr("作品名")}</option>
              </select>
              <IconButton
                label={view.compact ? tr("切换为网格视图") : tr("切换为紧凑列表")}
                aria-pressed={view.compact}
                onClick={() => setShelfView({ compact: !view.compact })}
              >
                {view.compact ? (
                  <SquaresFour size={18} />
                ) : (
                  <ListDashes size={18} />
                )}
              </IconButton>
            </div>
          </div>
          <div className="shelf-library" aria-label={tr("作品列表")}>
          {visible.length ? (
            <div className={`book-grid ${view.compact ? "compact" : ""}`}>
              {visible.map((b) => {
                const stage = bookStage(b);
                const pct =
                  b.target > 0 ? Math.min(100, (b.words / b.target) * 100) : 0;
                return (
                  <article className="book-card" key={b.id}>
                    <button
                      className={`book-cover cover-${coverVariant(b.id)}`}
                      onClick={() => onOpen(b.id)}
                      aria-label={tr("打开 {0}", {0: b.title})}
                    >
                      <span className="cover-tag">{genreLabel(b.genre)}</span>
                      <div className="cover-lines" />
                      <strong>{b.title}</strong>
                      <div className="cover-footer">
                        <span>{tr("星喵 · 原创作品")}</span>
                        <ArrowUpRight size={23} />
                      </div>
                    </button>
                    <div className="book-info">
                      <div className="book-head">
                        <h3 className="book-title">{b.title}</h3>
                        <span className={`stage-tag ${stage.id}`}>
                          {tr(stage.label)}
                        </span>
                        <Menu
                          label={tr("更多操作 {0}", {0: b.title})}
                          trigger={<DotsThree size={17} />}
                        >
                          <button onClick={() => onOpen(b.id)}>
                            <CaretRight size={15} />{tr("打开继续写作")}</button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void api("book:export", {
                                id: b.id,
                                format: "md",
                              })
                            }
                          >
                            <Export size={15} />{tr("导出作品")}</button>
                          <button onClick={() => onArchive(b)}>
                            {b.archived ? (
                              <ArrowCounterClockwise size={15} />
                            ) : (
                              <Archive size={15} />
                            )}
                            {b.archived ? tr("恢复到书架") : tr("将作品归档")}
                          </button>
                          <span className="menu-divider" />
                          <button
                            className="danger"
                            onClick={() => onDelete(b)}
                          >
                            <Trash size={15} />{tr("删除作品")}</button>
                        </Menu>
                      </div>
                      <p>{b.premise || tr("故事尚未展开，下一句由你来写。")}</p>
                      <div className="book-meta">
                        <span>
                          {number(b.words)}{" "}{tr("字 ·")}{" "}{b.chapterCount}{" "}{tr("章", {count: b.chapterCount})}</span>
                        <span>
                          {b.target > 0 ? `${Math.round(pct)}% · ` : ""}
                          {sinceLabel(b.updatedAt)}
                        </span>
                      </div>
                      <div
                        className="progress"
                        role="progressbar"
                        aria-label={tr("{0} 写作进度", {0: b.title})}
                        aria-valuenow={Math.round(pct)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <i style={{ transform: `scaleX(${pct / 100})` }} />
                      </div>
                      <Button
                        variant="primary-soft"
                        className="book-primary"
                        onClick={() => onOpen(b.id)}
                        aria-label={tr("继续写作：{0}", {0: b.title})}
                      >
                        {b.chapterCount ? tr("继续写作") : tr("开始写第一章")}
                        <ArrowUpRight size={15} />
                      </Button>
                    </div>
                  </article>
                );
              })}
              {!archived && !search && !genre && (
                <button className="new-book-card" onClick={onNew}>
                  <div>
                    <Plus size={26} />
                  </div>
                  <b>{tr("开启下一个故事")}</b>
                  <span>{tr("每个世界，都从一个念头开始")}</span>
                </button>
              )}
            </div>
          ) : (
            <div className="shelf-empty">
              {!search && !genre && !archived ? (
                <>
                  <div className="intro-art">
                    <BookOpen size={76} weight="duotone" />
                    <Sparkle size={26} className="intro-spark" />
                  </div>
                  <h2>{tr("你的第一部作品，等你落笔")}</h2>
                  <p>{tr("从灵感、大纲到章节，让 AI 陪你把故事写下去。")}<br />{tr("人物与关系有迹可循，每一次修改都能回看。")}</p>
                  <div className="inline-actions">
                    <Button variant="primary" onClick={onNew}>
                      <Plus size={18} />{tr("创建第一部作品")}</Button>
                    <Button onClick={onDemo} disabled={busy}>{tr("打开示例体验")}<ArrowUpRight size={17} />
                    </Button>
                  </div>
                  <small>{tr("示例会单独创建，不影响你的其他作品")}</small>
                </>
              ) : (
                <Empty
                  icon={<Books size={32} />}
                  title={search || genre ? tr("没有找到作品") : tr("这里还没有归档作品")}
                  action={search || genre ? (
                    <Button onClick={() => { setSearch(""); setGenre(""); }}>{tr("清除筛选")}</Button>
                  ) : undefined}
                >{tr("换个关键词，或回到我的书架继续写作。")}</Empty>
              )}
            </div>
          )}
          </div>
          <footer className="shelf-footer">
            <span>{tr("每一个未完待续，都值得被认真对待。")}</span>
            <span>{tr("星喵写作 · 本地优先")}</span>
          </footer>
        </div>
          </>}
      </main>
    </div>
  );
}
