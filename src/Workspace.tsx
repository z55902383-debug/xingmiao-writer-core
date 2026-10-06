import LanguageSwitcher from "./LanguageSwitcher";
import { tr, genreLabel } from "./i18n";
import SyncReview from "./SyncReview";
import CreationGuideIsland from "./CreationGuideIsland";
import TimelinePanel from "./TimelinePanel";
import VolumePlanner from "./VolumePlanner";
import CreativeCanvas from "./CreativeCanvas";
import type { CanvasModule, CanvasNode } from "./canvasModel";
import CanvasSourceEditor, {
  type CanvasSourceRequest,
} from "./CanvasSourceEditor";
import "./canvas-integration.css";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import {
  ArrowLeft,
  BookOpen,
  ListBullets,
  Users,
  GlobeHemisphereWest,
  Brain,
  PaintBrush,
  Plus,
  GearSix,
  CaretRight,
  FileText,
  Check,
  ClockCounterClockwise,
  Export,
  ArrowsOut,
  ArrowsIn,
  Sparkle,
  PaperPlaneTilt,
  Stop,
  Copy,
  CheckCircle,
  WarningCircle,
  ArrowRight,
  Trash,
  PencilSimple,
  UploadSimple,
  FolderOpen,
  CaretDown,
  FloppyDisk,
  MagnifyingGlass,
  Info,
  Sun,
  Moon,
  TextAa,
  DotsThree,
  Selection,
  CopySimple,
  SquaresFour,
  SidebarSimple,
  ChatCircle,
  NotePencil,
  Cpu,
  X,
} from "@phosphor-icons/react";
import type {
  Book,
  Chapter,
  Character,
  Config,
  ContextInfo,
  Job,
  Kind,
  Version,
  WorldRecord,
  MemoNote,
  BookSummary,
  Memory,
  TimelineEvent,
} from "./types";
import { api, count, date, number, copyText } from "./api";
import { Button, Empty, Field, IconButton, Menu, Modal, Splitter } from "./ui";
import { currentTheme, toggleThemeFrom } from "./theme";
import { revealSelection } from "./editorTools";
import { useWorkspace } from "./useWorkspace";
type View =
  "editor" | "outline" | "characters" | "world" | "memory" | "notes" | "style";

/* 阅读偏好：只影响本机显示，不进作品数据。
   默认值取产品规范的推荐区间（字号 18、行高 1.95、正文宽度 760）。 */
type DisplayPrefs = { fontSize: number; lineHeight: number; width: number };
const DISPLAY_KEY = "xm-editor-display";
const editorPositionKey = (bookId: string, chapterId: string) =>
  `xm-editor-position:${bookId}:${chapterId}`;
const DISPLAY_DEFAULT: DisplayPrefs = {
  fontSize: 18,
  lineHeight: 2.0,
  width: 760,
};
const FONT_SIZES = [14, 16, 18, 20, 22, 24];
const LINE_HEIGHTS = [1.8, 1.9, 2.0, 2.2];
const WIDTHS = [
  { value: 680, label: "窄 680" },
  { value: 760, label: "标准 760" },
  { value: 860, label: "宽 860" },
  { value: 1400, label: "铺满窗口" },
];
function loadDisplay(): DisplayPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(DISPLAY_KEY) || "{}");
    return {
      fontSize: FONT_SIZES.includes(raw.fontSize)
        ? raw.fontSize
        : DISPLAY_DEFAULT.fontSize,
      lineHeight: LINE_HEIGHTS.includes(raw.lineHeight)
        ? raw.lineHeight
        : DISPLAY_DEFAULT.lineHeight,
      width: WIDTHS.some((w) => w.value === raw.width)
        ? raw.width
        : DISPLAY_DEFAULT.width,
    };
  } catch {
    return DISPLAY_DEFAULT;
  }
}
function saveDisplay(value: DisplayPrefs) {
  try {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(value));
  } catch {
    /* 忽略持久化失败 */
  }
}
/* 面板尺寸：左栏、写作助手栏、侧栏上半区、细纲框高度、助手底部设置区高度。
   0 表示「跟随内容自然尺寸」，只有作者亲手拖过才落成具体像素值 ——
   这样没拖过的用户看到的就是原本的布局，不会有半点位移。 */
type Panes = {
  side: number;
  assistant: number;
  outline: number;
  compose: number;
};
const PANE_KEY = "xm-workspace-panes";
const PANE_LIMIT = {
  side: { min: 176, max: 420 },
  assistant: { min: 260, max: 560 },
  outline: { min: 60, max: 440 },
  compose: { min: 170, max: 640 },
};
/** 窄屏给窄栏、宽屏给宽栏，跟改造前的断点行为保持一致。 */
function paneDefault(): Panes {
  const w = typeof window === "undefined" ? 1440 : window.innerWidth;
  return {
    side: w >= 1600 ? 246 : w <= 1200 ? 200 : 230,
    assistant: w >= 1600 ? 360 : w <= 1200 ? 290 : 320,
    outline: 0,
    compose: 0,
  };
}
function loadPanes(): Panes {
  const base = paneDefault();
  try {
    const raw = JSON.parse(localStorage.getItem(PANE_KEY) || "{}");
    const pick = (k: keyof Panes) => {
      const v = Math.round(Number(raw[k]));
      if (!Number.isFinite(v)) return base[k];
      if (v === 0) return 0;
      const { min, max } = PANE_LIMIT[k];
      return Math.min(max, Math.max(min, v));
    };
    return {
      side: pick("side") || base.side,
      assistant: pick("assistant") || base.assistant,
      outline: pick("outline"),
      compose: pick("compose"),
    };
  } catch {
    return base;
  }
}
const kinds: Record<Kind, string> = {
  bookOutline: "生成全书总纲",
  worldBuild: "生成世界设定",
  characters: "生成人物档案",
  volumeOutline: "生成卷大纲",
  volumeDetail: "生成卷细纲",
  summary: "生成章节概要",
  timelinePlan: "生成变化计划",
  write: "按大纲写正文",
  continue: "接着往下写",
  polish: "润色本章",
  outline: "生成章节细纲",
  memory: "提取本章记忆",
  check: "检查情节连续性",
  style: "分析参考写法",
};
const sections: { key: View; label: string; icon: typeof BookOpen }[] = [
  { key: "editor", label: "章节正文", icon: BookOpen },
  { key: "outline", label: "故事大纲", icon: ListBullets },
  { key: "characters", label: "人物档案", icon: Users },
  { key: "world", label: "世界设定", icon: GlobeHemisphereWest },
  { key: "memory", label: "关系与记忆", icon: Brain },
  { key: "notes", label: "备忘录", icon: NotePencil },
  { key: "style", label: "风格档案", icon: PaintBrush },
];
/* 任务按「用户想做什么」分组，而不是按当前所在资料页分组——
   作者写到一半想检查设定冲突时，不该先切到某个资料页才找得到入口。 */
const INTENTS: { id: string; label: string; hint: string; kinds: Kind[] }[] = [
  {
    id: "write",
    label: "创作正文",
    hint: "按纲生成、续写、润色改写",
    kinds: ["write", "continue", "polish"],
  },
  {
    id: "plot",
    label: "剧情构思",
    hint: "总纲、分卷、章节安排与变化计划",
    kinds: [
      "outline",
      "bookOutline",
      "volumeOutline",
      "volumeDetail",
      "timelinePlan",
      "summary",
    ],
  },
  {
    id: "check",
    label: "故事检查",
    hint: "连续性、设定冲突、记忆提取",
    kinds: ["check", "memory"],
  },
  {
    id: "consult",
    label: "作品顾问",
    hint: "人物、世界设定与风格",
    kinds: ["characters", "worldBuild", "style"],
  },
];
/* 当前资料页对应的任务，用于在按钮上标「与本页相关」，保住原来的提示价值 */
const VIEW_KINDS: Record<View, Kind[]> = {
  editor: ["write", "continue", "polish", "check"],
  outline: [
    "bookOutline",
    "volumeOutline",
    "volumeDetail",
    "summary",
    "outline",
  ],
  characters: ["characters", "timelinePlan"],
  world: ["worldBuild", "timelinePlan"],
  memory: ["memory", "timelinePlan", "check"],
  notes: [],
  style: ["style"],
};
export default function Workspace({
  initial,
  preferredChapterId,
  config,
  onBack,
  onConfigSaved,
  onSettings,
  notify,
  closeGuard,
}: {
  initial: Book;
  preferredChapterId?: string;
  config: Config;
  onConfigSaved: (c: Config) => void;
  onBack: () => Promise<void>;
  onSettings: () => void;
  notify: (message: string) => void;
  closeGuard: MutableRefObject<() => Promise<void>>;
}) {
  const ws = useWorkspace(initial, notify);
  const {
    book,
    current,
    saveState,
    editBook,
    editChapter,
    flush,
    replace,
    reload,
    mutate,
  } = ws;
  const [chapterId, setChapterId] = useState(() =>
    initial.chapters.some((item) => item.id === preferredChapterId)
      ? preferredChapterId!
      : initial.chapters[0]?.id || "",
  );
  const [view, setView] = useState<View>("editor");
  const [sidebarSection, setSidebarSection] = useState<"chapters" | "features">(
    "chapters",
  );
  const [outlineTab, setOutlineTab] = useState<
    "foundation" | "timeline" | "volumes" | "board"
  >("foundation");
  const [characterTab, setCharacterTab] = useState<"archive" | "relations">(
    "archive",
  );
  const [worldTab, setWorldTab] = useState<"setting" | "evolution">("setting");
  const [memoryTab, setMemoryTab] = useState<
    "facts" | "timeline" | "foreshadows"
  >("facts");
  const [light, setLight] = useState(() => currentTheme() === "light");
  const [focus, setFocus] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [chapterDrawerOpen, setChapterDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [panes, setPanes] = useState<Panes>(loadPanes);
  useLayoutEffect(() => {
    document
      .querySelector<HTMLElement>(".outline-content-scroll")
      ?.scrollTo({ top: 0 });
  }, [outlineTab]);
  const outlineBox = useRef<HTMLTextAreaElement>(null);
  const composeBox = useRef<HTMLDivElement>(null);
  /* 没拖过的区域要保持在它原本的自然尺寸上，所以先量一次真实尺寸，
     拖动的起点就是它 —— 不会因为「加了个调节功能」就让版面走形。
     只在「还是自然尺寸」时量：拖过之后就别再动它，双击复位后再量回来。 */
  const [natural, setNatural] = useState({
    outline: 76,
    compose: 340,
  });
  const needOutline = panes.outline === 0;
  const needCompose = panes.compose === 0;
  const measureOutline = () =>
    outlineBox.current?.getBoundingClientRect().height;
  const measureCompose = () =>
    composeBox.current?.getBoundingClientRect().height;
  useLayoutEffect(() => {
    const o = needOutline ? measureOutline() : 0;
    const c = needCompose ? measureCompose() : 0;
    setNatural((n) => {
      const next = {
        outline: o ? Math.round(o) : n.outline,
        compose: c ? Math.round(c) : n.compose,
      };
      return next.outline === n.outline && next.compose === n.compose
        ? n
        : next;
    });
    // 面板宽度会改变换行、进而改变自动高度，所以宽度变了要重测
  }, [
    chapterId,
    view,
    showOutline,
    needOutline,
    needCompose,
    panes.side,
    panes.assistant,
  ]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(PANE_KEY, JSON.stringify(panes));
      } catch {
        /* 忽略持久化失败 */
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [panes]);
  const setPane = (key: keyof Panes) => (value: number) =>
    setPanes((p) => (p[key] === value ? p : { ...p, [key]: value }));
  const resetPane = (key: "side" | "assistant") => () =>
    setPanes((p) => ({ ...p, [key]: paneDefault()[key] }));
  const [history, setHistory] = useState<Version[] | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [memoryForm, setMemoryForm] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [displayMode, setDisplayMode] = useState<"regular" | "canvas">(() => {
    try {
      return localStorage.getItem(`xm-creative-display:${initial.id}`) ===
        "canvas"
        ? "canvas"
        : "regular";
    } catch {
      return "regular";
    }
  });
  const [canvasSource, setCanvasSource] = useState<CanvasSourceRequest | null>(
    null,
  );
  const [canvasEvent, setCanvasEvent] = useState<{
    key: string;
    event?: TimelineEvent;
    kind: "world" | "people" | "all";
  } | null>(null);
  function changeDisplayMode(mode: "regular" | "canvas") {
    setDisplayMode(mode);
    try {
      localStorage.setItem(`xm-creative-display:${book.id}`, mode);
    } catch {
      /* display preference only */
    }
  }
  function editCanvasEvent(id: string) {
    const event = book.timeline?.find((e) => e.id === id);
    if (!event) {
      notify(tr("这条变化已删除，请刷新资料后重试。"));
      return;
    }
    setCanvasEvent({
      key: id,
      event: { ...event },
      kind: event.kind === "world" ? "world" : "people",
    });
  }
  function editCanvasNode(node: CanvasNode) {
    if (node.kind === "character") {
      const source = book.characters.find((c) => c.id === node.entityId);
      if (source) setCharacter({ ...source });
    } else if (node.kind === "world") {
      const source = book.worldRecords?.find((r) => r.id === node.entityId);
      if (source) setWorldRecord({ ...source });
    } else if (node.kind === "memory") {
      const source = book.memories.find((m) => m.id === node.entityId);
      if (source) {
        setEditingMemory({ ...source });
        setMemoryForm(true);
      }
    } else if (node.kind === "event") {
      editCanvasEvent(node.entityId || "");
    } else {
      setCanvasSource({ kind: node.kind, id: node.entityId || node.chapterId });
    }
  }
  function addCanvasSource(module: CanvasModule, tab: string) {
    if (module === "outline")
      setCanvasSource({
        kind: tab === "foundation" ? "book-outline" : "new-structure",
      });
    else if (module === "characters" && tab === "archive")
      setCharacter({
        id: crypto.randomUUID(),
        name: "",
        role: "",
        description: "",
        knowledgeFromChapterId: chapterId,
      });
    else if (module === "world" && tab === "setting")
      setWorldRecord({
        id: crypto.randomUUID(),
        category: "地点",
        title: "",
        description: "",
        certainty: "fixed",
      });
    else if (module === "memory" && tab === "facts") {
      setEditingMemory(null);
      setMemoryForm(true);
    } else if (module === "memory" && tab === "foreshadows")
      setCanvasSource({ kind: "foreshadow" });
    else
      setCanvasEvent({
        key: crypto.randomUUID(),
        kind:
          module === "world"
            ? "world"
            : module === "characters"
              ? "people"
              : "all",
      });
  }
  function renderCanvas(module: CanvasModule, tab: string) {
    return (
      <div className="module-canvas-content">
        <CreativeCanvas
          book={book}
          module={module}
          tab={tab}
          chapterId={chapterId}
          onEdit={editCanvasNode}
          onAdd={() => addCanvasSource(module, tab)}
          onEditEvent={editCanvasEvent}
          onOpenChapter={(id: string) => {
            setChapterId(id);
            setView("editor");
          }}
          notify={notify}
          flush={flush}
        />
      </div>
    );
  }
  const [worldRecord, setWorldRecord] = useState<WorldRecord | null>(null);
  const [foreshadowTitle, setForeshadowTitle] = useState("");
  const [memoSearch, setMemoSearch] = useState("");
  const [selectedMemoId, setSelectedMemoId] = useState("");
  const [memoDrawerOpen, setMemoDrawerOpen] = useState(false);
  const [memoBooks, setMemoBooks] = useState<BookSummary[]>([]);
  const [memoBook, setMemoBook] = useState<Book | null>(null);
  const [memoDrawerLoading, setMemoDrawerLoading] = useState(false);
  const [memoDrawerError, setMemoDrawerError] = useState("");
  const [memoDrawerSelectedId, setMemoDrawerSelectedId] = useState("");
  const memoDrawerSaveTimer = useRef<number | null>(null);
  const memoDrawerPendingSave = useRef<{
    id: string;
    memos: MemoNote[];
  } | null>(null);
  const [candidateDiff, setCandidateDiff] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    action: () => Promise<void>;
  } | null>(null);
  const [action, setAction] = useState<Kind>("write");
  const [intent, setIntent] = useState("write");
  const [targetVolumeId, setTargetVolumeId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [selectedJob, setSelectedJob] = useState("");
  const [context, setContext] = useState<ContextInfo | null>(null);
  const [contextChapterIds, setContextChapterIds] = useState<string[] | null>(
    null,
  );
  const [contextError, setContextError] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [findText, setFindText] = useState("");
  const [showFind, setShowFind] = useState(false);
  const [showDisplay, setShowDisplay] = useState(false);
  const [display, setDisplay] = useState<DisplayPrefs>(loadDisplay);
  const setDisplayPref = (patch: Partial<DisplayPrefs>) =>
    setDisplay((prev) => {
      const next = { ...prev, ...patch };
      saveDisplay(next);
      return next;
    });
  const editor = useRef<HTMLTextAreaElement>(null);
  /* 「复制选中文字」现在要先点开「更多」菜单才能触发，点击菜单会动焦点，
     所以不能到点击那一刻再去读 selectionStart——改成随选随记。 */
  const lastSelection = useRef<[number, number]>([0, 0]);
  const rememberEditorPosition = (
    chapterKey: string,
    textarea = editor.current,
  ) => {
    if (!textarea) return;
    const scroller = textarea.closest<HTMLElement>(".editor-scroll");
    try {
      localStorage.setItem(
        editorPositionKey(book.id, chapterKey),
        JSON.stringify({
          start: textarea.selectionStart,
          end: textarea.selectionEnd,
          scrollTop: scroller?.scrollTop || 0,
        }),
      );
    } catch {
      /* 浏览器存储不可用时仍可正常编辑 */
    }
  };
  const readSelection = (): [number, number] => {
    const el = editor.current;
    if (el && el.selectionEnd > el.selectionStart)
      return [el.selectionStart, el.selectionEnd];
    return lastSelection.current;
  };
  const persistMemoDrawerPending = async () => {
    if (memoDrawerSaveTimer.current !== null) {
      window.clearTimeout(memoDrawerSaveTimer.current);
      memoDrawerSaveTimer.current = null;
    }
    const pending = memoDrawerPendingSave.current;
    memoDrawerPendingSave.current = null;
    if (!pending) return;
    await api<Book>("book:update", {
      id: pending.id,
      patch: { memos: pending.memos },
    });
  };
  const openMemoDrawer = async () => {
    setMemoDrawerOpen(true);
    setMemoDrawerError("");
    setMemoDrawerLoading(true);
    setMemoBook(book);
    setMemoDrawerSelectedId(book.memos?.[0]?.id || "");
    try {
      setMemoBooks(await api<BookSummary[]>("books:list"));
    } catch (error) {
      setMemoDrawerError((error as Error).message);
    } finally {
      setMemoDrawerLoading(false);
    }
  };
  const selectMemoBook = async (id: string) => {
    if (!id || id === memoBook?.id) return;
    setMemoDrawerLoading(true);
    setMemoDrawerError("");
    try {
      await persistMemoDrawerPending();
      const nextBook = await api<Book>("book:get", { id });
      setMemoBook(nextBook);
      setMemoDrawerSelectedId(nextBook.memos?.[0]?.id || "");
    } catch (error) {
      setMemoDrawerError((error as Error).message);
    } finally {
      setMemoDrawerLoading(false);
    }
  };
  const updateMemoDrawerNotes = (memos: MemoNote[]) => {
    if (!memoBook) return;
    const nextBook = { ...memoBook, memos };
    setMemoBook(nextBook);
    if (memoBook.id === book.id) {
      editBook({ memos });
      return;
    }
    memoDrawerPendingSave.current = { id: memoBook.id, memos };
    if (memoDrawerSaveTimer.current !== null)
      window.clearTimeout(memoDrawerSaveTimer.current);
    memoDrawerSaveTimer.current = window.setTimeout(() => {
      void persistMemoDrawerPending().catch((error) =>
        setMemoDrawerError(tr("保存失败：{0}", {0: (error as Error).message})),
      );
    }, 450);
  };
  const closeMemoDrawer = () => {
    setMemoDrawerOpen(false);
    void (async () => {
      await persistMemoDrawerPending();
      await flush();
    })().catch((error) =>
      notify(tr("备忘录保存失败：{0}", {0: (error as Error).message})),
    );
  };
  useEffect(
    () => () => {
      if (memoDrawerSaveTimer.current !== null)
        window.clearTimeout(memoDrawerSaveTimer.current);
    },
    [],
  );
  const customTarget = useRef<HTMLInputElement>(null);
  const chapter =
    book.chapters.find((c) => c.id === chapterId) || book.chapters[0];
  useLayoutEffect(() => {
    if (!chapter || view !== "editor") return;
    const textarea = editor.current;
    const scroller = textarea?.closest<HTMLElement>(".editor-scroll");
    if (!textarea || !scroller) return;
    try {
      const saved = JSON.parse(
        localStorage.getItem(editorPositionKey(book.id, chapter.id)) || "{}",
      );
      const start = Math.max(
        0,
        Math.min(textarea.value.length, Number(saved.start) || 0),
      );
      const end = Math.max(
        start,
        Math.min(textarea.value.length, Number(saved.end) || start),
      );
      textarea.setSelectionRange(start, end);
      scroller.scrollTop = Math.max(0, Number(saved.scrollTop) || 0);
    } catch {
      textarea.setSelectionRange(0, 0);
      scroller.scrollTop = 0;
    }
  }, [book.id, chapter?.id, view]);
  useEffect(() => setContextChapterIds(null), [chapter?.id]);
  const modelReady = !!config.model || config.provider === "codex";
  /* 显示给作者的「第几章」用当前可见章节的位置，不用底层 order。
     order 是内部排序键（连回收站里的一起保持单调），拿它当编号会让
     删到只剩一章时还显示「第 3 章」。映射整体无序，这里按 book.chapters
     的既有顺序生成，逐个取用即可。 */
  const chapterNo = useMemo(
    () => new Map(book.chapters.map((c, i) => [c.id, i + 1])),
    [book.chapters],
  );
  /* 当前章在全书的位置（1 起）与它的下一章：正文写完后要能直接续下一章，
     不必回「故事大纲」再点一次「添加章节」。 */
  const currentNo = chapter ? (chapterNo.get(chapter.id) ?? 0) : 0;
  const nextChapter = currentNo ? book.chapters[currentNo] : undefined;
  /* 参考资料清单：把「这一轮模型到底读了什么」摊开给作者看，
     而不是只报一个总数。每一项都能追溯到作品里的具体位置。 */
  const refItems = chapter
    ? [
        {
          label: "本章细纲",
          on: !!chapter.outline.trim(),
          note: chapter.outline.trim()
            ? tr("{0} 字", {0: number(count(chapter.outline))})
            : "未填写",
        },
        {
          label: "前文摘要",
          on: !!context?.chapterCount,
          note: context?.chapterCount
            ? tr("{0} 个定稿章节", {0: context.chapterCount})
            : "未引用前章正文",
        },
        {
          label: "人物档案",
          on: !!context?.characterCount,
          note: context?.characterCount ? tr("{0} 位", {0: context.characterCount}) : "无",
        },
        {
          label: "世界设定",
          on: !!book.world.trim(),
          note: book.world.trim() ? "已填写" : "未填写",
        },
        {
          label: "有效记忆",
          on: !!context?.memoryCount,
          note: context?.memoryCount ? tr("{0} 条", {0: context.memoryCount}) : "无",
        },
        {
          label: "时间线状态",
          on: !!context?.timelineCount,
          note: context?.timelineCount ? tr("{0} 条", {0: context.timelineCount}) : "无",
        },
        {
          label: "写作 Skill",
          on: !!context?.skills?.length,
          note: context?.skills?.length
            ? context.skills.map((s) => s.name).join("、")
            : "未启用",
        },
        {
          label: "临时要求",
          on: !!instruction.trim(),
          note: instruction.trim()
            ? instruction.trim().replace(/\s+/g, " ").slice(0, 22)
            : "未填写",
        },
      ]
    : [];
  const refReady = refItems.filter((i) => i.on).length;
  const jobs = book.candidates.filter(
    (j) =>
      j.chapterId === chapter?.id ||
      [
        "bookOutline",
        "worldBuild",
        "characters",
        "volumeOutline",
        "volumeDetail",
        "timelinePlan",
      ].includes(j.kind),
  );
  const selected = jobs.find((j) => j.id === selectedJob) || jobs[0];
  const running = book.candidates.find(
    (j) => j.status === "running" || j.review?.status === "analyzing",
  );
  const words = book.chapters.reduce((s, c) => s + count(c.body), 0);
  const finalizedChapters = book.chapters.filter(
    (item) => item.status === "final",
  ).length;
  const bookProgress =
    book.target > 0 ? Math.min(100, (words / book.target) * 100) : 0;
  useLayoutEffect(() => {
    const size = () => {
      if (editor.current) {
        editor.current.style.height = "auto";
        editor.current.style.height = `${Math.max(400, editor.current.scrollHeight)}px`;
      }
    };
    size();
    window.addEventListener("resize", size);
    return () => window.removeEventListener("resize", size);
  }, [chapter?.body, chapter?.id, display, focus, view]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await flush();
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    closeGuard.current = flush;
    return () => {
      closeGuard.current = async () => {};
    };
  });
  useEffect(
    () =>
      window.xingmiao?.onJob((job) => {
        if (job.bookId === current.current.id)
          mutate((b) => ({
            ...b,
            candidates: [job, ...b.candidates.filter((j) => j.id !== job.id)],
          }));
      }),
    [],
  );
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        flush()
          .then(() => notify(tr("已保存到本机")))
          .catch((e) => notify(e.message));
      }
      if (mod && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setShowFind(true);
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLInputElement>(".chapter-find input")
            ?.focus(),
        );
      }
      // Esc 逐层退出：先关浮层，再退专注模式
      if (event.key === "Escape") {
        if (showDisplay) return setShowDisplay(false);
        if (showFind) return setShowFind(false);
        setFocus(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  // 切资料页时把助手带到对应分组，并把任务落到该页最常用的那个上。
  // 一律以「本页首选任务」为准：避免出现「人在世界设定页、助手却还停在
  // 上一个页面的任务」这种状态漂移。
  useEffect(() => {
    const primary = (VIEW_KINDS[view] || [])[0];
    const group = INTENTS.find((g) => g.kinds.includes(primary));
    if (!group) return;
    setIntent(group.id);
    setAction(primary);
  }, [view]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!chapter) return;
      api<ContextInfo>("context:preview", {
        bookId: book.id,
        chapterId: chapter.id,
        kind: action,
        instruction,
        targetVolumeId,
        chapterIds: contextChapterIds,
      })
        .then((result) => {
          if (!cancelled) {
            setContext(result);
            setContextError("");
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setContext(null);
            setContextError(e.message);
          }
        });
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    chapter?.revision,
    chapter?.id,
    book.memories,
    book.characters,
    book.style,
    book.reference,
    book.world,
    book.outline,
    book.timeline,
    book.volumes,
    book.chapterTargetWords,
    book.contextChapters,
    chapter?.targetWords,
    chapter?.volumeId,
    action,
    targetVolumeId,
    instruction,
    contextChapterIds,
    config,
  ]);
  /* 新建章节时继承「当前这一章」的归属分卷与目标字数。
     否则在正文页点添加，新章会掉进「未分卷」分组，还得回大纲重新归档。 */
  async function addChapter(after?: Chapter) {
    await run(async () => {
      const c = await api<Chapter>("chapter:create", { bookId: book.id });
      const from = after || chapter;
      if (from && (from.volumeId || from.targetWords)) {
        await api<Book>("chapter:organize", {
          id: c.id,
          volumeId: from.volumeId || "",
          targetWords: from.targetWords || 0,
        });
      }
      await reload();
      setChapterId(c.id);
      setView("editor");
      setSelectedJob("");
    });
  }
  async function generateFor(
    kind: Kind,
    targetChapterId?: string,
    volumeId?: string,
  ) {
    setAction(kind);
    setTargetVolumeId(volumeId || "");
    if (targetChapterId) setChapterId(targetChapterId);
    if (!modelReady) {
      notify(tr("请先配置模型，再生成对应资料"));
      onSettings();
      return;
    }
    await run(async () => {
      let cid = targetChapterId || chapter?.id;
      if (!cid) {
        const c = await api<Chapter>("chapter:create", { bookId: book.id });
        await reload();
        cid = c.id;
        setChapterId(cid);
      }
      const j = await api<Job>("ai:generate", {
        bookId: book.id,
        chapterId: cid,
        kind,
        instruction,
        targetVolumeId: ["volumeOutline", "volumeDetail"].includes(kind)
          ? volumeId || targetVolumeId
          : "",
        contextChapterIds,
      });
      mutate((b) => ({
        ...b,
        candidates: [j, ...b.candidates.filter((x) => x.id !== j.id)],
      }));
      setSelectedJob(j.id);
      document.querySelector(".assistant-body")?.scrollTo({ top: 0 });
    });
  }
  async function generate() {
    await generateFor(action, chapter?.id, targetVolumeId);
  }
  async function adopt() {
    if (!selected) return;
    await run(async () => {
      const b = await api<Book>(
        selected.kind === "memory" ? "memory:accept" : "ai:adopt",
        {
          id: selected.id,
          mode: selected.kind === "continue" ? "append" : "replace",
        },
      );
      replace(b);
      if (
        [
          "bookOutline",
          "worldBuild",
          "characters",
          "volumeOutline",
          "volumeDetail",
          "summary",
          "timelinePlan",
        ].includes(selected.kind)
      ) {
        notify(tr("{0}结果已写入对应位置", {0: tr(kinds[selected.kind])}));
        setView(
          selected.kind === "worldBuild"
            ? "world"
            : selected.kind === "characters"
              ? "characters"
              : selected.kind === "timelinePlan"
                ? "memory"
                : "outline",
        );
        return;
      }
      notify(
        selected.kind === "memory"
          ? "记忆已确认并保存"
          : selected.kind === "style"
            ? "已保存为本书风格档案"
            : "候选稿已采用，原文保留在历史版本中",
      );
      if (selected.kind === "style") setView("style");
    });
  }
  const validCount = book.memories.filter((m) => !m.stale).length;
  return (
    <div
      className={`workspace ${focus ? "is-focused" : ""} ${assistantOpen ? "assistant-open" : ""} ${chapterDrawerOpen ? "chapter-drawer-open" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
      style={
        {
          "--side-w": `${panes.side}px`,
          "--asst-w": `${panes.assistant}px`,
        } as CSSProperties
      }
    >
      <CreationGuideIsland
        book={book}
        onNavigate={(step) => {
          setSelectedJob("");
          if (step === "premise" || step === "outline") {
            setView("outline");
            setOutlineTab("foundation");
          } else if (step === "chapters") {
            setView("outline");
            setOutlineTab("volumes");
          } else if (step === "characters") {
            setView("characters");
            setCharacterTab("archive");
          } else if (step === "world") {
            setView("world");
            setWorldTab("setting");
          } else if (step === "draft") {
            if (book.chapters[0]) {
              setChapterId(book.chapters[0].id);
              setView("editor");
            } else {
              void addChapter();
            }
          } else {
            setView("memory");
            setMemoryTab("facts");
          }
        }}
      />
      <aside className="workspace-sidebar">
        <div className="sidebar-top">
          <div className="workspace-brand">
            <div className="brand-mark small">
              <img
                className="cat-avatar"
                src="./cat-avatar.png"
                alt={tr("星喵头像")}
              />
            </div>
            <strong>{tr("星喵写作")}</strong>
            <span>{tr("创作空间")}</span>
            <IconButton
              className="sidebar-collapse-toggle"
              label={sidebarCollapsed ? tr("展开侧栏") : tr("收起侧栏")}
              aria-expanded={!sidebarCollapsed}
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            >
              <SidebarSimple size={17} />
            </IconButton>
            <IconButton
              className="chapter-drawer-close"
              label={tr("关闭章节目录")}
              onClick={() => setChapterDrawerOpen(false)}
            >
              <X size={18} />
            </IconButton>
          </div>
          <button className="back-link" onClick={() => run(onBack)}>
            <ArrowLeft size={16} />{tr("返回书架")}</button>
          <div className="current-book">
            <div className="mini-cover">
              <BookOpen size={22} />
            </div>
            <div>
              <h2 title={book.title}>{book.title}</h2>
              <span>
                {genreLabel(book.genre)} · {number(words)}{" "}{tr("字")}</span>
            </div>
          </div>
        </div>
        <div className="sidebar-switcher" role="tablist" aria-label={tr("侧栏内容")}>
          <button
            role="tab"
            aria-selected={sidebarSection === "chapters"}
            className={sidebarSection === "chapters" ? "active" : ""}
            onClick={() => setSidebarSection("chapters")}
          >
            <BookOpen size={15} />{tr("章节")}<span>{book.chapters.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={sidebarSection === "features"}
            className={sidebarSection === "features" ? "active" : ""}
            onClick={() => setSidebarSection("features")}
          >
            <SquaresFour size={15} />{tr("功能")}</button>
        </div>
        {sidebarSection === "features" ? (
          <nav className="workspace-nav" role="tabpanel">
            {sections.map((s) => (
              <button
                key={s.key}
                className={`nav-item ${view === s.key ? "active" : ""}`}
                title={s.label}
                onClick={() => setView(s.key)}
              >
                <s.icon size={19} />
                {tr(s.label)}
                {s.key === "memory" && validCount > 0 && (
                  <span>{validCount}</span>
                )}
              </button>
            ))}
          </nav>
        ) : (
          <>
            <div className="chapter-list-head">
              <span>{tr("卷与章节")}</span>
              <IconButton
                label={tr("新建章节")}
                onClick={() => addChapter()}
                disabled={busy}
              >
                <Plus size={18} />
              </IconButton>
            </div>
            <div className="chapter-list" role="tabpanel">
              {[
                ...(book.volumes || []),
                { id: "", title: book.volumes?.length ? "未分卷" : "章节" },
              ].map((volume) => (
                <details className="chapter-volume" key={volume.id} open>
                  <summary>
                    {volume.id ? volume.title : tr(volume.title)}
                    <span>
                      {
                        book.chapters.filter(
                          (c) => (c.volumeId || "") === volume.id,
                        ).length
                      }
                    </span>
                  </summary>
                  {book.chapters
                    .filter((c) => (c.volumeId || "") === volume.id)
                    .map((c) => (
                      <button
                        key={c.id}
                        className={`chapter-item ${chapter?.id === c.id && view === "editor" ? "active" : ""}`}
                        title={tr("{0} · {1} · {2} 字", {0: String(chapterNo.get(c.id) ?? 0).padStart(2, "0"), 1: c.title || "未命名章节", 2: number(count(c.body))})}
                        onClick={() => {
                          setChapterId(c.id);
                          setView("editor");
                          setSelectedJob("");
                        }}
                      >
                        <span className="chapter-index">
                          {String(chapterNo.get(c.id) ?? 0).padStart(2, "0")}
                        </span>
                        <div>
                          <strong>{c.title || tr("未命名章节")}</strong>
                          <small>
                            {number(count(c.body))}{" "}{tr("字")}{" "}
                            <span>
                              · {c.status === "final" ? tr("已定稿") : tr("草稿")}
                            </span>
                          </small>
                        </div>
                        {c.status === "final" && <Check size={14} />}
                      </button>
                    ))}
                </details>
              ))}
            </div>
            <button
              className="add-chapter"
              onClick={() => addChapter()}
              disabled={busy}
            >
              <Plus size={16} />{tr("添加新章节")}</button>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="book-progress">
            <span>{tr("创作进度")}</span>
            <span>
              {words > 0 && bookProgress < 0.1
                ? "<0.1"
                : bookProgress.toFixed(1)}
              %
            </span>
          </div>
          <div className="progress">
            <i
              style={{
                transform: `scaleX(${Math.min(1, words / book.target)})`,
              }}
            />
          </div>
          <small>
            {number(words)} / {number(book.target)}{" "}{tr("字")}</small>
          <small className="chapter-progress-meta">{tr("已定稿")}{" "}{finalizedChapters} / {book.chapters.length}{" "}{tr("章")}</small>
          <button
            type="button"
            className="nav-item"
            onClick={(event) =>
              setLight(toggleThemeFrom(event.currentTarget) === "light")
            }
            title={tr("切换深浅主题")}
            aria-label={light ? tr("切换到深色模式") : tr("切换到浅色模式")}
          >
            {light ? <Moon size={18} /> : <Sun size={18} />}
            {light ? tr("深色模式") : tr("浅色模式")}
          </button>
          <button className="nav-item" onClick={onSettings}>
            <GearSix size={18} />{tr("模型与设置")}</button>
        </div>
      </aside>
      {/* 左栏 ↔ 正文：拖动改左侧栏宽度 */}
      <Splitter
        className="sidebar-splitter"
        axis="x"
        label={tr("调整左侧栏宽度")}
        value={panes.side}
        min={PANE_LIMIT.side.min}
        max={PANE_LIMIT.side.max}
        onChange={setPane("side")}
        onReset={resetPane("side")}
      />
      <div className="work-area">
        <header className="workspace-top">
          <div className="breadcrumb">
            <span>{book.title}</span>
            <CaretRight size={14} />
            <b>{tr(sections.find((s) => s.key === view)?.label)}</b>
          </div>
          <div className="top-actions">
            <LanguageSwitcher />
            <IconButton
              className="chapter-drawer-trigger"
              label={tr("打开章节目录")}
              aria-expanded={chapterDrawerOpen}
              onClick={() => {
                setAssistantOpen(false);
                setChapterDrawerOpen((open) => !open);
              }}
            >
              <BookOpen size={18} />
            </IconButton>
            <IconButton
              className="assistant-drawer-trigger"
              label={assistantOpen ? tr("关闭写作助手") : tr("打开写作助手")}
              aria-expanded={assistantOpen}
              onClick={() => {
                setChapterDrawerOpen(false);
                setAssistantOpen((open) => !open);
              }}
            >
              <ChatCircle size={18} />
            </IconButton>
            <button
              className={`save-state ${saveState === "保存失败" ? "failed" : ""}`}
              onClick={() =>
                flush()
                  .then(() => notify(tr("保存完成")))
                  .catch((e) => notify(e.message))
              }
            >
              {saveState === "已保存" ? (
                <CheckCircle size={15} />
              ) : (
                <FloppyDisk size={15} />
              )}
              <span>{tr(saveState)}</span>
            </button>
            <span className="top-divider" />
            <IconButton
              label={focus ? tr("退出专注模式") : tr("专注模式")}
              onClick={() => setFocus(!focus)}
            >
              {focus ? <ArrowsIn size={18} /> : <ArrowsOut size={18} />}
            </IconButton>
            <Button
              variant="quiet"
              onClick={() =>
                run(async () => {
                  const path = await api<string | null>("book:export", {
                    id: book.id,
                    format: "md",
                  });
                  if (path) notify(tr("已导出：{0}", {0: path}));
                })
              }
            >
              <Export size={16} />{tr("导出作品")}</Button>
          </div>
        </header>
        {view === "editor" && !chapter && (
          <Empty
            icon={<BookOpen size={32} />}
            title={tr("还没有章节")}
            action={<Button onClick={() => addChapter()}>{tr("添加新章节")}</Button>}
          >{tr("创建章节开始写作，也可以到设置中的回收站恢复。")}</Empty>
        )}
        {view === "editor" && chapter && (
          <>
            <div className="editor-toolbar">
              <div className="editor-tabs">
                <span className="selected">
                  <FileText size={17} />{tr("正文编辑")}</span>
                <button
                  onClick={() => setShowOutline(!showOutline)}
                  className={showOutline ? "on" : ""}
                >
                  <ListBullets size={16} />{tr("本章细纲")}</button>
              </div>
              <div className="toolbar-actions">
                <IconButton
                  label={tr("打开备忘录")}
                  className={memoDrawerOpen ? "memo-toolbar-active" : ""}
                  aria-expanded={memoDrawerOpen}
                  onClick={() =>
                    memoDrawerOpen ? closeMemoDrawer() : void openMemoDrawer()
                  }
                >
                  <NotePencil size={18} />
                </IconButton>
                <IconButton
                  label={tr("历史版本")}
                  onClick={() =>
                    run(async () =>
                      setHistory(
                        await api<Version[]>("versions:list", {
                          id: chapter.id,
                        }),
                      ),
                    )
                  }
                >
                  <ClockCounterClockwise size={18} />
                </IconButton>
                <Button
                  variant={
                    chapter.status === "final" ? "quiet" : "primary-soft"
                  }
                  title={
                    chapter.status === "final"
                      ? tr("本章已确认；修改正文后会自动标记为草稿并要求重新核对")
                      : tr("确认本章正文，后续 AI 才会把它作为可靠事实提取记忆")
                  }
                  disabled={
                    busy || chapter.status === "final" || !chapter.body.trim()
                  }
                  onClick={() =>
                    run(async () => {
                      await api("chapter:finalize", {
                        id: chapter.id,
                        revision: current.current.chapters.find(
                          (c) => c.id === chapter.id,
                        )!.revision,
                      });
                      await reload();
                      notify(tr("章节已定稿，现在可以在助手中提取本章记忆"));
                    })
                  }
                >
                  <Check size={16} />
                  {chapter.status === "final" ? tr("已定稿") : tr("本章定稿")}
                </Button>
              </div>
            </div>
            <div className="chapter-quickbar">
              <Button
                variant={showFind ? "primary-soft" : ""}
                onClick={() => setShowFind((v) => !v)}
              >
                <MagnifyingGlass size={16} />{tr("查找")}</Button>
              <Menu label={tr("更多")} icon={<DotsThree size={16} />} align="start">
                <button
                  onClick={() =>
                    copyText(chapter.body)
                      .then(() => notify(tr("正文已复制")))
                      .catch((e) => notify(e.message))
                  }
                >
                  <Copy size={15} />{tr("复制整章正文")}</button>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const [from, to] = readSelection();
                    const text = chapter.body.slice(from, to);
                    if (!text) {
                      notify(tr("请先在正文中选中文字"));
                      return;
                    }
                    copyText(text)
                      .then(() => notify(tr("选中文字已复制")))
                      .catch((e) => notify(e.message));
                  }}
                >
                  <Selection size={15} />{tr("复制选中文字")}</button>
                <span className="menu-divider" />
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const p = await api<string | null>("chapter:export", {
                        id: chapter.id,
                      });
                      if (p) notify(tr("本章已导出"));
                    })
                  }
                >
                  <Export size={15} />{tr("导出本章")}</button>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const c = await api<Chapter>("chapter:duplicate", {
                        id: chapter.id,
                      });
                      await reload();
                      setChapterId(c.id);
                      notify(tr("已创建章节副本"));
                    })
                  }
                >
                  <CopySimple size={15} />{tr("创建章节副本")}</button>
                <span className="menu-divider" />
                <button
                  onClick={() => setShowDisplay((v) => !v)}
                  aria-pressed={showDisplay}
                >
                  <TextAa size={15} />{tr("显示设置（字号/行距/宽度）")}</button>
                <span className="menu-divider" />
                <button
                  className="danger"
                  disabled={busy || !!running}
                  onClick={() =>
                    setConfirm({
                      title: "删除本章？",
                      message:
                        "章节和历史记录会保留在回收站，关联记忆将停止参与创作。",
                      action: async () => {
                        await api("chapter:delete", { id: chapter.id });
                        await reload();
                        setChapterId("");
                        notify(tr("章节已移入回收站"));
                      },
                    })
                  }
                >
                  <Trash size={15} />{tr("删除本章")}</button>
              </Menu>
            </div>
            {showFind && (
              <div className="chapter-find">
                <input
                  aria-label={tr("查找正文")}
                  placeholder={tr("输入要查找的文字")}
                  value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                />
                <Button
                  disabled={!findText}
                  onClick={() => {
                    const el = editor.current;
                    if (!el || !findText) return;
                    const start = el.selectionEnd;
                    let at = chapter.body.indexOf(findText, start);
                    if (at < 0) at = chapter.body.indexOf(findText);
                    if (at < 0) {
                      notify(tr("正文中未找到"));
                      return;
                    }
                    revealSelection(el, at, at + findText.length);
                    lastSelection.current = [at, at + findText.length];
                    notify(tr("已选中匹配文字，位置 {0}", {0: at + 1}));
                  }}
                >{tr("下一个")}</Button>
                <span className="find-hint">{tr("Enter 继续查找 · Esc 关闭")}</span>
              </div>
            )}
            {showDisplay && (
              <div
                className="chapter-display"
                role="group"
                aria-label={tr("显示设置")}
              >
                <label>{tr("字号")}<select
                    aria-label={tr("正文字号")}
                    value={display.fontSize}
                    onChange={(e) =>
                      setDisplayPref({ fontSize: Number(e.target.value) })
                    }
                  >
                    {FONT_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s} px
                      </option>
                    ))}
                  </select>
                </label>
                <label>{tr("行距")}<select
                    aria-label={tr("正文行距")}
                    value={display.lineHeight}
                    onChange={(e) =>
                      setDisplayPref({ lineHeight: Number(e.target.value) })
                    }
                  >
                    {LINE_HEIGHTS.map((h) => (
                      <option key={h} value={h}>
                        {h.toFixed(1)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>{tr("正文宽度")}<select
                    aria-label={tr("正文宽度")}
                    value={display.width}
                    onChange={(e) =>
                      setDisplayPref({ width: Number(e.target.value) })
                    }
                  >
                    {WIDTHS.map((w) => (
                      <option key={w.value} value={w.value}>
                        {tr(w.label)}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  onClick={() => setDisplayPref(DISPLAY_DEFAULT)}
                  disabled={
                    display.fontSize === DISPLAY_DEFAULT.fontSize &&
                    display.lineHeight === DISPLAY_DEFAULT.lineHeight &&
                    display.width === DISPLAY_DEFAULT.width
                  }
                >{tr("恢复默认")}</Button>
                <IconButton
                  label={tr("收起显示设置")}
                  onClick={() => setShowDisplay(false)}
                >
                  <X size={16} />
                </IconButton>
              </div>
            )}
            <div
              className="editor-scroll"
              onScroll={() => rememberEditorPosition(chapter.id)}
            >
              <div className="manuscript" style={{ maxWidth: display.width }}>
                <div className="chapter-kicker">
                  <span>
                    CHAPTER{" "}
                    {String(chapterNo.get(chapter.id) ?? 0).padStart(2, "0")}
                  </span>
                  <span
                    className={`status-tag ${chapter.status === "final" ? "final" : ""}`}
                  >
                    {chapter.status === "final" ? tr("已定稿") : tr("创作中")}
                  </span>
                </div>
                <input
                  className="chapter-title-input"
                  aria-label={tr("章节标题")}
                  maxLength={160}
                  value={chapter.title}
                  onChange={(e) =>
                    editChapter(chapter.id, { title: e.target.value })
                  }
                  placeholder={tr("写下章节标题")}
                />
                {showOutline && (
                  <div className="outline-inline">
                    <div>
                      <ListBullets size={16} />
                      <b>{tr("本章细纲")}</b>
                      <span>
                        {chapter.outline.trim()
                          ? tr("已写 {0} 字", {0: number(count(chapter.outline))})
                          : tr("给故事一个清晰的方向")}
                      </span>
                      <IconButton
                        label={tr("收起细纲")}
                        onClick={() => setShowOutline(false)}
                      >
                        <CaretDown size={16} />
                      </IconButton>
                    </div>
                    <textarea
                      ref={outlineBox}
                      aria-label={tr("本章细纲")}
                      value={chapter.outline}
                      onChange={(e) =>
                        editChapter(chapter.id, { outline: e.target.value })
                      }
                      rows={3}
                      style={
                        panes.outline ? { height: panes.outline } : undefined
                      }
                      placeholder={tr("这一章发生什么？谁出场，有什么冲突，在哪里留下悬念……")}
                    />
                    {/* 细纲 ↔ 正文：拖这个框的底边调整细纲高度 */}
                    <Splitter
                      axis="y"
                      className="outline-splitter"
                      label={tr("调整细纲高度")}
                      value={panes.outline || natural.outline}
                      min={PANE_LIMIT.outline.min}
                      max={PANE_LIMIT.outline.max}
                      measure={measureOutline}
                      onChange={setPane("outline")}
                      onReset={() => setPanes((p) => ({ ...p, outline: 0 }))}
                    />
                  </div>
                )}
                {!showOutline && (
                  <button
                    className="outline-collapsed"
                    onClick={() => setShowOutline(true)}
                    aria-label={tr("展开本章细纲")}
                  >
                    <ListBullets size={15} />
                    <b>{tr("本章细纲")}</b>
                    <span className="outline-collapsed-preview">
                      {chapter.outline.trim()
                        ? `${chapter.outline.replace(/\s+/g, " ").trim().slice(0, 72)}${chapter.outline.replace(/\s+/g, " ").trim().length > 72 ? "…" : ""}`
                        : tr("点击补充本章目标、冲突和悬念")}
                    </span>
                    {chapter.outline.trim() && (
                      <small>{number(count(chapter.outline))}{" "}{tr("字")}</small>
                    )}
                    <CaretDown size={14} />
                  </button>
                )}
                <textarea
                  ref={editor}
                  className="manuscript-input"
                  aria-label={tr("章节正文")}
                  spellCheck={false}
                  onSelect={(e) => {
                    const el = e.currentTarget;
                    if (el.selectionEnd > el.selectionStart)
                      lastSelection.current = [
                        el.selectionStart,
                        el.selectionEnd,
                      ];
                    rememberEditorPosition(chapter.id, el);
                  }}
                  onBlur={(e) =>
                    rememberEditorPosition(chapter.id, e.currentTarget)
                  }
                  style={{
                    fontSize: display.fontSize,
                    lineHeight: display.lineHeight,
                  }}
                  value={chapter.body}
                  onChange={(e) =>
                    editChapter(chapter.id, { body: e.target.value })
                  }
                  placeholder={
                    tr("故事，从这里开始。\n\n写下第一句话，或让右侧的 AI 助手陪你一起构思。")
                  }
                />
                <div className="manuscript-end">
                  <span />{tr("未完待续")}<span />
                </div>
                {/* 连续写作入口：写完这一章直接进下一章，删掉「回大纲再加一章」那一趟 */}
                <div className="chapter-next">
                  {nextChapter ? (
                    <>
                      <Button
                        variant="primary-soft"
                        onClick={() => {
                          setChapterId(nextChapter.id);
                          setSelectedJob("");
                        }}
                        aria-label={tr("前往下一章 {0}", {0: nextChapter.title})}
                      >{tr("下一章：")}{nextChapter.title}
                        <ArrowRight size={15} />
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => addChapter(chapter)}
                      >
                        <Plus size={16} />{tr("在末尾新建一章")}</Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() => addChapter(chapter)}
                      >
                        <Plus size={16} />{tr("写下一章")}</Button>
                      <small>{tr("会沿用本章的分卷与目标字数")}{chapter.volumeId
                          ? ` · ${book.volumes?.find((v) => v.id === chapter.volumeId)?.title || ""}`
                          : ""}
                      </small>
                    </>
                  )}
                </div>
              </div>
            </div>
            <footer className="editor-status">
              <span>
                <span
                  className={`dot ${saveState === "保存失败" ? "error" : ""}`}
                />
                {chapter.status === "final" && saveState === "已保存"
                  ? tr("定稿已保存")
                  : tr(saveState)}
                {saveState !== "已保存" && saveState !== "保存失败" && (
                  <>
                    <span className="slash">/</span>{" "}{tr("Ctrl + S 保存")}</>
                )}
              </span>
              <span>
                {number(count(chapter.body))}{" "}{tr("字")}{" "}
                <span className="slash">·</span>{" "}{tr("约")}{" "}
                {Math.max(1, Math.ceil(count(chapter.body) / 500))}{" "}{tr("分钟阅读")}</span>
            </footer>
          </>
        )}
        {view === "outline" && (
          <div
            className={`document-page outline-page ${displayMode === "canvas" ? "canvas-active" : ""}`}
          >
            <div className="outline-sticky-head">
              <PageHeading
                icon={<ListBullets size={23} />}
                title={
                  outlineTab === "timeline"
                    ? tr("按顺序梳理剧情")
                    : outlineTab === "volumes"
                      ? tr("拆分成卷与章节")
                      : outlineTab === "board"
                        ? tr("按章节进度看计划")
                        : tr("把故事的方向，写清楚")
                }
                text={
                  outlineTab === "timeline"
                    ? "先看每卷目标，再检查章节概要是否完整。点击章节可跳到对应规划。"
                    : outlineTab === "volumes"
                      ? "先定每卷目标，再逐章补概要和细纲；完成后可以直接进入正文。"
                      : outlineTab === "board"
                        ? "从待规划逐步推进到正文完成；卡片可直接打开计划或继续写作。"
                        : "建议先定故事总纲，再拆分卷章，最后进入正文。AI 结果会先在右侧供你核对。"
                }
              />
              <CanvasModeSwitch
                mode={displayMode}
                onChange={changeDisplayMode}
              />
              <div
                className="outline-tabs"
                role="tablist"
                aria-label={tr("大纲模块")}
              >
                <button
                  role="tab"
                  aria-selected={outlineTab === "foundation"}
                  className={outlineTab === "foundation" ? "active" : ""}
                  onClick={() => setOutlineTab("foundation")}
                >
                  <BookOpen size={15} />{tr("故事总纲")}</button>
                <button
                  role="tab"
                  aria-selected={outlineTab === "timeline"}
                  className={outlineTab === "timeline" ? "active" : ""}
                  onClick={() => setOutlineTab("timeline")}
                >
                  <ClockCounterClockwise size={15} />{tr("剧情时间线")}</button>
                <button
                  role="tab"
                  aria-selected={outlineTab === "volumes"}
                  className={outlineTab === "volumes" ? "active" : ""}
                  onClick={() => setOutlineTab("volumes")}
                >
                  <ListBullets size={15} />{tr("分卷章节")}</button>
                <button
                  role="tab"
                  aria-selected={outlineTab === "board"}
                  className={outlineTab === "board" ? "active" : ""}
                  onClick={() => setOutlineTab("board")}
                >
                  <SquaresFour size={15} />{tr("章节看板")}</button>
              </div>
            </div>
            {displayMode === "canvas" ? (
              renderCanvas("outline", outlineTab)
            ) : (
              <div className="outline-content-scroll">
                {outlineTab === "foundation" && (
                  <section
                    className="outline-foundation"
                    aria-label={tr("故事基础信息")}
                    role="tabpanel"
                  >
                    <div className="outline-foundation-head">
                      <div>
                        <span className="overline">{tr("故事基础")}</span>
                        <h2>{tr("先确定故事要走向哪里")}</h2>
                        <p className="outline-guidance">{tr("填写故事简介后，可生成全书总纲；生成结果会出现在右侧，核对后再采用。")}</p>
                      </div>
                      <Button
                        disabled={busy || !!running}
                        onClick={() => generateFor("bookOutline")}
                      >
                        <Sparkle size={16} />{tr("生成全书总纲")}</Button>
                    </div>
                    <div className="outline-foundation-grid">
                      <Field label={tr("作品名称")}>
                        <input
                          value={book.title}
                          maxLength={120}
                          onChange={(e) => editBook({ title: e.target.value })}
                        />
                      </Field>
                      <Field label={tr("全书每章默认字数")}>
                        <input
                          type="number"
                          min={100}
                          max={20000}
                          defaultValue={book.chapterTargetWords || 2000}
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isInteger(n) && n >= 100 && n <= 20000)
                              editBook({ chapterTargetWords: n });
                            else {
                              e.target.value = String(
                                book.chapterTargetWords || 2000,
                              );
                              notify(tr("每章默认字数请填写 100–20000 的整数"));
                            }
                          }}
                        />
                      </Field>
                    </div>
                    <Field label={tr("故事简介")}>
                      <textarea
                        rows={3}
                        value={book.premise}
                        onChange={(e) => editBook({ premise: e.target.value })}
                        placeholder={tr("主角的目标、阻碍与故事的核心变化")}
                      />
                    </Field>
                    <Field
                      label={tr("全书总纲")}
                      hint={tr("已有文本会完整保留。规划中的未来剧情不会被当成已经发生的事实。")}
                    >
                      <textarea
                        className="large-textarea"
                        value={book.outline}
                        onChange={(e) => editBook({ outline: e.target.value })}
                        placeholder={tr("故事起点 → 主要冲突 → 关键转折 → 最终结局")}
                      />
                    </Field>
                  </section>
                )}
                {outlineTab !== "foundation" && (
                  <VolumePlanner
                    panel={outlineTab}
                    onGenerate={(kind, cid, vid) => generateFor(kind, cid, vid)}
                    generating={busy || !!running}
                    book={book}
                    onChange={replace}
                    flush={flush}
                    editChapter={editChapter}
                    notify={notify}
                    onNavigateToPlan={(id) => {
                      setOutlineTab("volumes");
                      window.setTimeout(
                        () =>
                          document
                            .getElementById(id)
                            ?.scrollIntoView({ block: "center" }),
                        0,
                      );
                    }}
                    onSwitchToVolumes={() => setOutlineTab("volumes")}
                    onOpen={(id) => {
                      setChapterId(id);
                      setView("editor");
                      setShowOutline(true);
                    }}
                  />
                )}
              </div>
            )}
          </div>
        )}
        {view === "characters" && (
          <div
            className={`document-page module-page ${displayMode === "canvas" ? "canvas-active" : ""}`}
          >
            <div className="module-page-head">
              <PageHeading
                icon={<Users size={23} />}
                title={tr("让每个人物，都有来处")}
                text="先建立人物档案，再记录关系和状态变化；AI 结果会在右侧供你核对。"
                action={
                  characterTab === "archive" ? (
                    <Button
                      variant="primary"
                      onClick={() =>
                        setCharacter({
                          id: crypto.randomUUID(),
                          name: "",
                          role: "",
                          description: "",
                          knowledgeFromChapterId: chapter?.id || "",
                        })
                      }
                    >
                      <Plus size={17} />{tr("新建人物")}</Button>
                  ) : (
                    <Button
                      disabled={busy || !!running}
                      onClick={() => generateFor("timelinePlan")}
                    >
                      <Sparkle size={16} />{tr("生成关系变化计划")}</Button>
                  )
                }
              />
              <CanvasModeSwitch
                mode={displayMode}
                onChange={changeDisplayMode}
              />
              <div
                className="outline-tabs module-tabs"
                role="tablist"
                aria-label={tr("人物模块")}
              >
                <button
                  id="characters-archive-tab"
                  role="tab"
                  aria-selected={characterTab === "archive"}
                  className={characterTab === "archive" ? "active" : ""}
                  onClick={() => setCharacterTab("archive")}
                >
                  <Users size={15} />{tr("人物档案")}</button>
                <button
                  id="characters-relations-tab"
                  role="tab"
                  aria-selected={characterTab === "relations"}
                  className={characterTab === "relations" ? "active" : ""}
                  onClick={() => setCharacterTab("relations")}
                >
                  <Brain size={15} />{tr("关系与变化")}</button>
              </div>
            </div>
            {displayMode === "canvas" ? (
              renderCanvas("characters", characterTab)
            ) : (
              <div className="module-content-scroll">
                {characterTab === "archive" ? (
                  <section
                    role="tabpanel"
                    aria-labelledby="characters-archive-tab"
                  >
                    <div className="module-section-intro">
                      <strong>{tr("先添加故事中的重要人物")}</strong>
                      <span>{tr("填写身份、动机和背景，后续生成时 AI 会参考这些资料。")}</span>
                      <Button
                        variant="primary-soft"
                        disabled={busy || !!running}
                        onClick={() => generateFor("characters")}
                      >
                        <Sparkle size={15} />{tr("AI 生成人物档案")}</Button>
                    </div>
                    {book.characters.length ? (
                      <div className="character-grid">
                        {book.characters.map((c) => (
                          <article className="character-card" key={c.id}>
                            <div className="character-card-top">
                              <div className="avatar">{c.name.slice(0, 1)}</div>
                              <div>
                                <h3>{c.name}</h3>
                                <small>{c.role || tr("尚未设置定位")}</small>
                              </div>
                              <IconButton
                                label={tr("编辑{0}", {0: c.name})}
                                onClick={() => setCharacter(c)}
                              >
                                <PencilSimple size={17} />
                              </IconButton>
                            </div>
                            <p>
                              {c.description || tr("补充人物的性格、动机与背景。")}
                            </p>
                            {(c.characterKnown || c.readerKnown) && (
                              <div className="character-knowledge-hint">
                                <span>{tr("角色认知已设置")}</span>
                                <small>
                                  {c.characterKnown
                                    ? tr("角色知道的内容已记录")
                                    : tr("可补充角色已知信息")}
                                  {c.readerKnown ? tr(" · 已记录读者已知信息") : ""}
                                </small>
                              </div>
                            )}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        icon={<Users size={36} />}
                        title={tr("先创建第一位人物")}
                        action={
                          <>
                            <Button
                              variant="primary"
                              onClick={() =>
                                setCharacter({
                                  id: crypto.randomUUID(),
                                  name: "",
                                  role: "",
                                  description: "",
                                  knowledgeFromChapterId: chapter?.id || "",
                                })
                              }
                            >
                              <Plus size={16} />{tr("新建人物")}</Button>
                            <Button
                              variant="primary-soft"
                              disabled={busy || !!running}
                              onClick={() => generateFor("characters")}
                            >
                              <Sparkle size={15} />{tr("AI 生成人物档案")}</Button>
                          </>
                        }
                      >{tr("添加姓名、身份、性格与动机，让后续创作有据可依；也可以先写简介，再用 AI 生成人物档案。")}</Empty>
                    )}
                  </section>
                ) : (
                  <section
                    role="tabpanel"
                    aria-labelledby="characters-relations-tab"
                  >
                    <div className="module-section-intro">
                      <strong>{tr("关系与状态会随剧情变化")}</strong>
                      <span>{tr("选择章节查看状态，点击人物节点查看或编辑关系。")}</span>
                    </div>
                    <TimelinePanel
                      book={book}
                      kind="people"
                      onEditPerson={setCharacter}
                      onCreatePerson={() =>
                        setCharacter({
                          id: crypto.randomUUID(),
                          name: "",
                          role: "",
                          description: "",
                          knowledgeFromChapterId: chapter?.id || "",
                        })
                      }
                      chapterId={chapter?.id || ""}
                      onChange={replace}
                      flush={flush}
                      notify={notify}
                    />
                  </section>
                )}
              </div>
            )}
          </div>
        )}
        {view === "world" && (
          <div
            className={`document-page module-page ${displayMode === "canvas" ? "canvas-active" : ""}`}
          >
            <div className="module-page-head">
              <PageHeading
                icon={<GlobeHemisphereWest size={23} />}
                title={tr("给想象，一个自洽的世界")}
                text="先记录故事开始时的世界规则，再按章节追踪它如何改变。AI 结果会在右侧供你核对。"
                action={
                  <Button
                    disabled={busy || !!running}
                    onClick={() =>
                      generateFor(
                        worldTab === "setting" ? "worldBuild" : "timelinePlan",
                      )
                    }
                  >
                    <Sparkle size={16} />
                    {worldTab === "setting" ? tr("生成世界设定") : tr("生成变化计划")}
                  </Button>
                }
              />
              <CanvasModeSwitch
                mode={displayMode}
                onChange={changeDisplayMode}
              />
              <div
                className="outline-tabs module-tabs"
                role="tablist"
                aria-label={tr("世界设定模块")}
              >
                <button
                  id="world-setting-tab"
                  role="tab"
                  aria-selected={worldTab === "setting"}
                  className={worldTab === "setting" ? "active" : ""}
                  onClick={() => setWorldTab("setting")}
                >
                  <GlobeHemisphereWest size={15} />{tr("世界初始设定")}</button>
                <button
                  id="world-evolution-tab"
                  role="tab"
                  aria-selected={worldTab === "evolution"}
                  className={worldTab === "evolution" ? "active" : ""}
                  onClick={() => setWorldTab("evolution")}
                >
                  <ClockCounterClockwise size={15} />{tr("世界变化")}</button>
              </div>
            </div>
            {displayMode === "canvas" ? (
              renderCanvas("world", worldTab)
            ) : (
              <div className="module-content-scroll">
                {worldTab === "setting" ? (
                  <section role="tabpanel" aria-labelledby="world-setting-tab">
                    <div className="module-section-intro">
                      <strong>{tr("故事开始时，世界是什么样？")}</strong>
                      <span>{tr("记录时代、地点、组织和固定规则。后续变化单独记入时间线。")}</span>
                    </div>
                    <Field label={tr("世界观与固定规则")}>
                      <textarea
                        className="large-textarea world-input"
                        value={book.world}
                        onChange={(e) => editBook({ world: e.target.value })}
                        placeholder={
                          tr("时代与背景\n\n主要地点\n\n组织与阵营\n\n不可违背的规则")
                        }
                      />
                    </Field>
                    <div className="world-record-heading">
                      <div>
                        <strong>{tr("世界资料卡")}</strong>
                        <small>{tr("把地点、组织、物件和规则拆成可检索的小卡片")}</small>
                      </div>
                      <Button
                        variant="primary-soft"
                        onClick={() =>
                          setWorldRecord({
                            id: crypto.randomUUID(),
                            category: "地点",
                            title: "",
                            description: "",
                            certainty: "fixed",
                          })
                        }
                      >
                        <Plus size={15} />{tr("新增资料卡")}</Button>
                    </div>
                    {(book.worldRecords || []).length ? (
                      <div className="world-record-grid">
                        {book.worldRecords!.map((record) => (
                          <article
                            className="world-record-card"
                            key={record.id}
                          >
                            <div>
                              <span>{record.category}</span>
                              <small>
                                {record.certainty === "fixed"
                                  ? tr("已确认")
                                  : tr("待确认")}
                              </small>
                            </div>
                            <h3>{record.title}</h3>
                            <p>{record.description}</p>
                            <button onClick={() => setWorldRecord(record)}>{tr("编辑资料")}</button>
                            <button
                              onClick={() =>
                                editBook({
                                  worldRecords: book.worldRecords!.filter(
                                    (item) => item.id !== record.id,
                                  ),
                                })
                              }
                            >{tr("删除")}</button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="world-record-empty">{tr("资料卡适合记录会反复用到的名词和规则；原有整段设定仍会继续保留。")}</p>
                    )}
                  </section>
                ) : (
                  <section
                    role="tabpanel"
                    aria-labelledby="world-evolution-tab"
                  >
                    <div className="module-section-intro">
                      <strong>{tr("按章节记录世界的变化")}</strong>
                      <span>{tr("例如政局更迭、组织变动、地点开放或规则被打破。")}</span>
                    </div>
                    <TimelinePanel
                      book={book}
                      kind="world"
                      chapterId={chapter?.id || ""}
                      onChange={replace}
                      flush={flush}
                      notify={notify}
                    />
                  </section>
                )}
              </div>
            )}
          </div>
        )}
        {view === "memory" && (
          <div
            className={`document-page module-page ${displayMode === "canvas" ? "canvas-active" : ""}`}
          >
            <div className="module-page-head">
              <PageHeading
                icon={<Brain size={23} />}
                title={tr("让关系与细节有迹可循")}
                text="事实记忆保留来源证据，时间线展示跨章节变化；有疑问时可回到来源章节核对。"
                action={
                  memoryTab === "facts" ? (
                    <Button
                      variant="primary"
                      onClick={() => setMemoryForm(true)}
                    >
                      <Plus size={17} />{tr("添加记忆")}</Button>
                  ) : memoryTab === "timeline" ? (
                    <Button
                      disabled={busy || !!running}
                      onClick={() => generateFor("timelinePlan")}
                    >
                      <Sparkle size={16} />{tr("生成变化计划")}</Button>
                  ) : undefined
                }
              />
              <CanvasModeSwitch
                mode={displayMode}
                onChange={changeDisplayMode}
              />
              <div
                className="outline-tabs module-tabs three-tabs"
                role="tablist"
                aria-label={tr("关系与记忆模块")}
              >
                <button
                  id="memory-facts-tab"
                  role="tab"
                  aria-selected={memoryTab === "facts"}
                  className={memoryTab === "facts" ? "active" : ""}
                  onClick={() => setMemoryTab("facts")}
                >
                  <Brain size={15} />{tr("事实记忆")}</button>
                <button
                  id="memory-timeline-tab"
                  role="tab"
                  aria-selected={memoryTab === "timeline"}
                  className={memoryTab === "timeline" ? "active" : ""}
                  onClick={() => setMemoryTab("timeline")}
                >
                  <ClockCounterClockwise size={15} />{tr("变化时间线")}</button>
                <button
                  id="memory-foreshadows-tab"
                  role="tab"
                  aria-selected={memoryTab === "foreshadows"}
                  className={memoryTab === "foreshadows" ? "active" : ""}
                  onClick={() => setMemoryTab("foreshadows")}
                >
                  <Sparkle size={15} />{tr("伏笔台账")}</button>
              </div>
            </div>
            {displayMode === "canvas" ? (
              renderCanvas("memory", memoryTab)
            ) : (
              <div className="module-content-scroll">
                {memoryTab === "facts" ? (
                  <section role="tabpanel" aria-labelledby="memory-facts-tab">
                    <div className="module-section-intro">
                      <strong>{tr("已确认的事实会参与后续创作")}</strong>
                      <span>{tr("章节事实保留原文证据；修改来源章节后，相关记录会等待复核。")}</span>
                    </div>
                    <div className="memory-summary">
                      <div>
                        <b>{validCount}</b>
                        <span>{tr("条有效记录")}</span>
                      </div>
                      <div>
                        <b>{book.memories.filter((m) => m.stale).length}</b>
                        <span>{tr("条需要复核")}</span>
                      </div>
                      <Button
                        disabled={busy || !!running || !chapter}
                        onClick={() => generateFor("memory")}
                      >
                        <Sparkle size={17} />{tr("从当前章提取")}</Button>
                    </div>
                    <div className="search memory-search">
                      <MagnifyingGlass size={18} />
                      <input
                        aria-label={tr("搜索记忆")}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={tr("搜索人物、关系或事实")}
                      />
                    </div>
                    {book.memories.length ? (
                      <div className="memory-list memory-timeline">
                        {book.memories
                          .filter((m) =>
                            `${m.subject}${m.relation}${m.object}`.includes(
                              query,
                            ),
                          )
                          .map((m) => (
                            <article
                              className={`memory-item ${m.stale ? "stale" : ""}`}
                              key={m.id}
                            >
                              <div className="memory-time-label">
                                {book.chapters.find(
                                  (c) => c.id === m.sourceChapterId,
                                )?.title || tr("故事起点 · 作者设定")}
                              </div>
                              <div className="memory-line">
                                <strong>{m.subject}</strong>
                                <span>{m.relation}</span>
                                <ArrowRight size={15} />
                                <b>{m.object}</b>
                                <IconButton
                                  label={tr("编辑记忆")}
                                  onClick={() => {
                                    setEditingMemory({ ...m });
                                    setMemoryForm(true);
                                  }}
                                >
                                  <PencilSimple size={16} />
                                </IconButton>
                                <IconButton
                                  label={tr("删除记忆")}
                                  onClick={() =>
                                    setConfirm({
                                      title: "删除这条记忆？",
                                      message:
                                        "删除后，这条记录不再参与后续创作。原章节正文不会改变。",
                                      action: async () => {
                                        replace(
                                          await api<Book>("memory:delete", {
                                            bookId: book.id,
                                            id: m.id,
                                          }),
                                        );
                                      },
                                    })
                                  }
                                >
                                  <Trash size={16} />
                                </IconButton>
                              </div>
                              {m.evidence && (
                                <blockquote>{m.evidence}</blockquote>
                              )}
                              <div className="memory-source">
                                {m.stale ? (
                                  <span className="warning">
                                    <WarningCircle size={14} />{tr("来源变化，等待复核")}</span>
                                ) : (
                                  <span>
                                    <CheckCircle size={14} />{tr("已确认")}</span>
                                )}
                                {m.sourceChapterId ? (
                                  <button
                                    onClick={() => {
                                      setChapterId(m.sourceChapterId);
                                      setView("editor");
                                    }}
                                  >
                                    {
                                      book.chapters.find(
                                        (c) => c.id === m.sourceChapterId,
                                      )?.title
                                    }{" "}{tr("· 版本")}{" "}{m.sourceRevision}
                                    <ArrowUpRightMini />
                                  </button>
                                ) : (
                                  <span>{tr("固定设定 · 作者录入")}</span>
                                )}
                              </div>
                            </article>
                          ))}
                      </div>
                    ) : (
                      <Empty
                        icon={<Brain size={36} />}
                        title={tr("还没有事实记忆")}
                        action={
                          <div className="memory-empty-actions">
                            <Button
                              variant="primary"
                              disabled={!chapter || busy || !!running}
                              onClick={() => generateFor("memory")}
                            >
                              <Sparkle size={15} />{tr("从当前章提取")}</Button>
                            <Button onClick={() => setMemoryForm(true)}>
                              <Plus size={16} />{tr("手动添加事实")}</Button>
                          </div>
                        }
                      >{tr("固定设定可以手动记录；章节记忆需先定稿，再从正文提取，之后可在时间线中查看变化。")}</Empty>
                    )}
                    <p className="footnote">{tr("来源变化的记录不会自动重建。请核对原文后重新提取或手动修正。")}</p>
                  </section>
                ) : memoryTab === "timeline" ? (
                  <section
                    role="tabpanel"
                    aria-labelledby="memory-timeline-tab"
                  >
                    <div className="module-section-intro">
                      <strong>{tr("按章节回看人物关系与世界变化")}</strong>
                      <span>{tr("计划中的变化会标记为计划，不会自动当成已经发生的事实。")}</span>
                    </div>
                    <TimelinePanel
                      book={book}
                      kind="all"
                      chapterId={chapter?.id || ""}
                      onChange={replace}
                      flush={flush}
                      notify={notify}
                    />
                  </section>
                ) : (
                  <section
                    role="tabpanel"
                    aria-labelledby="memory-foreshadows-tab"
                  >
                    <div className="module-section-intro">
                      <strong>{tr("追踪埋下、回收和暂时搁置的线索")}</strong>
                      <span>{tr("每条伏笔都标记首次出现章节，回收后可补上对应章节。")}</span>
                    </div>
                    <form
                      className="foreshadow-add"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!foreshadowTitle.trim() || !chapter) return;
                        editBook({
                          foreshadows: [
                            {
                              id: crypto.randomUUID(),
                              title: foreshadowTitle.trim(),
                              plantedChapterId: chapter.id,
                              status: "open",
                              note: "",
                            },
                            ...(book.foreshadows || []),
                          ],
                        });
                        setForeshadowTitle("");
                      }}
                    >
                      <input
                        aria-label={tr("伏笔内容")}
                        value={foreshadowTitle}
                        onChange={(event) =>
                          setForeshadowTitle(event.target.value)
                        }
                        placeholder={tr("记录一个需要后续回收的线索")}
                      />
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={!chapter || !foreshadowTitle.trim()}
                      >
                        <Plus size={15} />{tr("记下伏笔")}</Button>
                    </form>
                    {(book.foreshadows || []).length ? (
                      <div className="foreshadow-list">
                        {book.foreshadows!.map((item) => (
                          <article
                            key={item.id}
                            className={`foreshadow-card ${item.status}`}
                          >
                            <div>
                              <span className="foreshadow-status">
                                {item.status === "open"
                                  ? tr("待回收")
                                  : item.status === "resolved"
                                    ? tr("已回收")
                                    : tr("已搁置")}
                              </span>
                              <h3>{item.title}</h3>
                              <small>{tr("埋下于：")}{book.chapters.find(
                                  (c) => c.id === item.plantedChapterId,
                                )?.title || tr("已删除章节")}
                                {item.payoffChapterId
                                  ? tr(" · 回收于：{0}", {0: book.chapters.find((c) => c.id === item.payoffChapterId)?.title || "已删除章节"})
                                  : ""}
                              </small>
                            </div>
                            <div className="foreshadow-actions">
                              <button
                                onClick={() =>
                                  setCanvasSource({
                                    kind: "foreshadow",
                                    id: item.id,
                                  })
                                }
                              >{tr("编辑")}</button>
                              <select
                                aria-label={tr("伏笔状态")}
                                value={item.status}
                                onChange={(event) =>
                                  editBook({
                                    foreshadows: book.foreshadows!.map((f) =>
                                      f.id === item.id
                                        ? {
                                            ...f,
                                            status: event.target.value as
                                              "open" | "resolved" | "abandoned",
                                            payoffChapterId:
                                              event.target.value === "resolved"
                                                ? chapter?.id ||
                                                  f.payoffChapterId
                                                : "",
                                          }
                                        : f,
                                    ),
                                  })
                                }
                              >
                                <option value="open">{tr("待回收")}</option>
                                <option value="resolved">{tr("已回收")}</option>
                                <option value="abandoned">{tr("已搁置")}</option>
                              </select>
                              <button
                                onClick={() =>
                                  editBook({
                                    foreshadows: book.foreshadows!.filter(
                                      (f) => f.id !== item.id,
                                    ),
                                  })
                                }
                              >{tr("删除")}</button>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        icon={<Sparkle size={34} />}
                        title={tr("还没有追踪中的伏笔")}
                      >{tr("先记录一个线索，后续可将它标记为已回收或搁置。")}</Empty>
                    )}
                  </section>
                )}
              </div>
            )}
          </div>
        )}
        {view === "notes" && (
          <div className="document-page module-page memo-page">
            <div className="module-page-head">
              <PageHeading
                icon={<NotePencil size={23} />}
                title={tr("把灵感先收好")}
                text="备忘录只属于这本作品。把工具箱生成的点子粘贴进来，写作时随时查阅和复制。"
                action={
                  <Button
                    variant="primary"
                    onClick={() => {
                      const now = new Date().toISOString();
                      const memo: MemoNote = {
                        id: crypto.randomUUID(),
                        title: "新备忘录",
                        content: "",
                        createdAt: now,
                        updatedAt: now,
                      };
                      editBook({ memos: [memo, ...(book.memos || [])] });
                      setSelectedMemoId(memo.id);
                    }}
                  >
                    <Plus size={17} />{tr("新建备忘录")}</Button>
                }
              />
            </div>
            <div className="module-content-scroll memo-content-scroll">
              {(() => {
                const memos = book.memos || [];
                const visibleMemos = memos.filter((memo) =>
                  `${memo.title} ${memo.content}`
                    .toLocaleLowerCase()
                    .includes(memoSearch.toLocaleLowerCase()),
                );
                const selected =
                  memos.find((memo) => memo.id === selectedMemoId) ||
                  visibleMemos[0];
                return memos.length ? (
                  <div className="memo-layout">
                    <aside className="memo-list-panel">
                      <label className="search memo-search">
                        <MagnifyingGlass size={17} />
                        <input
                          aria-label={tr("搜索备忘录")}
                          value={memoSearch}
                          onChange={(e) => setMemoSearch(e.target.value)}
                          placeholder={tr("搜索备忘录")}
                        />
                      </label>
                      <div className="memo-list">
                        {visibleMemos.map((memo) => (
                          <button
                            key={memo.id}
                            className={`memo-list-item ${selected?.id === memo.id ? "active" : ""}`}
                            onClick={() => setSelectedMemoId(memo.id)}
                          >
                            <NotePencil size={17} />
                            <span>
                              <strong>{memo.title || tr("未命名备忘录")}</strong>
                              <small>
                                {memo.content.trim().slice(0, 56) ||
                                  tr("空白备忘录")}
                              </small>
                            </span>
                            <time>
                              {new Date(memo.updatedAt).toLocaleDateString(
                                "zh-CN",
                                { month: "numeric", day: "numeric" },
                              )}
                            </time>
                          </button>
                        ))}
                        {!visibleMemos.length && (
                          <p className="memo-no-results">{tr("没有匹配的备忘录")}</p>
                        )}
                      </div>
                    </aside>
                    {selected ? (
                      <article className="memo-editor-card">
                        <div className="memo-editor-toolbar">
                          <span>
                            <i />{tr("自动保存到「")}{book.title}」
                          </span>
                          <div>
                            <Button
                              disabled={!selected.content.trim()}
                              onClick={() => {
                                void copyText(selected.content).then(() =>
                                  notify(tr("备忘录内容已复制，可以粘贴到正文")),
                                );
                              }}
                            >
                              <Copy size={15} />{tr("复制内容")}</Button>
                            <IconButton
                              label={tr("删除备忘录")}
                              onClick={() =>
                                setConfirm({
                                  title: "删除这条备忘录？",
                                  message: "删除后无法恢复。",
                                  action: async () => {
                                    editBook({
                                      memos: memos.filter(
                                        (memo) => memo.id !== selected.id,
                                      ),
                                    });
                                    setSelectedMemoId(
                                      visibleMemos.find(
                                        (memo) => memo.id !== selected.id,
                                      )?.id || "",
                                    );
                                  },
                                })
                              }
                            >
                              <Trash size={16} />
                            </IconButton>
                          </div>
                        </div>
                        <input
                          className="memo-title-input"
                          aria-label={tr("备忘录标题")}
                          value={selected.title}
                          maxLength={160}
                          onChange={(e) =>
                            editBook({
                              memos: memos.map((memo) =>
                                memo.id === selected.id
                                  ? {
                                      ...memo,
                                      title: e.target.value,
                                      updatedAt: new Date().toISOString(),
                                    }
                                  : memo,
                              ),
                            })
                          }
                          placeholder={tr("给这条备忘录起个标题")}
                        />
                        <textarea
                          className="memo-textarea"
                          aria-label={tr("备忘录内容")}
                          value={selected.content}

                          onChange={(e) =>
                            editBook({
                              memos: memos.map((memo) =>
                                memo.id === selected.id
                                  ? {
                                      ...memo,
                                      content: e.target.value,
                                      updatedAt: new Date().toISOString(),
                                    }
                                  : memo,
                              ),
                            })
                          }
                          placeholder={tr("粘贴创意工具箱生成的结果，或记下写作时突然想到的内容……")}
                        />
                        <footer className="memo-editor-footer">
                          <span>
                            {selected.content.length.toLocaleString("zh-CN")}{" "}{tr("/ 不设字数上限")}</span>
                          <span>{tr("修改于")}{" "}
                            {new Date(selected.updatedAt).toLocaleString(
                              "zh-CN",
                              {
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </span>
                        </footer>
                      </article>
                    ) : (
                      <Empty
                        icon={<NotePencil size={34} />}
                        title={tr("搜索不到这条备忘录")}
                      >{tr("清除搜索词，或新建一条备忘录。")}</Empty>
                    )}
                  </div>
                ) : (
                  <Empty
                    icon={<NotePencil size={36} />}
                    title={tr("先建一条备忘录")}
                    action={
                      <Button
                        variant="primary"
                        onClick={() => {
                          const now = new Date().toISOString();
                          const memo: MemoNote = {
                            id: crypto.randomUUID(),
                            title: "新备忘录",
                            content: "",
                            createdAt: now,
                            updatedAt: now,
                          };
                          editBook({ memos: [memo] });
                          setSelectedMemoId(memo.id);
                        }}
                      >
                        <Plus size={16} />{tr("新建备忘录")}</Button>
                    }
                  >{tr("把工具箱中的生成结果复制到这里，或记录写作时想保留的灵感。备忘录按作品分别保存。")}</Empty>
                );
              })()}
            </div>
          </div>
        )}
        {view === "style" && (
          <div className="document-page">
            <PageHeading
              icon={<PaintBrush size={23} />}
              title={tr("找到属于这本书的语感")}
              text="从参考文章中学习叙事方法，沉淀为可编辑的风格档案。"
            />
            <div className="reference-box">
              <div className="reference-symbol">
                <FileText size={27} />
              </div>
              <div>
                <h3>{book.referenceName || tr("导入一篇参考文章")}</h3>
                <p>
                  {book.reference
                    ? tr("{0} 字符 · 仅用于分析写法，不进入人物记忆", {0: number(count(book.reference))})
                    : tr("支持 UTF-8 编码的 TXT、Markdown；也可以在下方粘贴。")}
                </p>
              </div>
              <Button
                onClick={() =>
                  run(async () => {
                    const result = await api<Book | null>("reference:import", {
                      bookId: book.id,
                    });
                    if (result) replace(result);
                  })
                }
              >
                <UploadSimple size={17} />{tr("导入文章")}</Button>
            </div>
            {book.reference && (
              <Button
                onClick={() =>
                  setConfirm({
                    title: "移除参考文章？",
                    message: "原文移入回收站，已提炼的风格档案继续保留。",
                    action: async () => {
                      replace(
                        await api<Book>("reference:delete", {
                          bookId: book.id,
                        }),
                      );
                      notify(tr("参考文章已移入回收站"));
                    },
                  })
                }
              >
                <Trash size={16} />{tr("移除参考文章")}</Button>
            )}
            <details className="reference-details">
              <summary>{tr("查看或粘贴参考原文")}<CaretDown size={15} />
              </summary>
              <Field label={tr("参考文章原文")}>
                <textarea
                  rows={9}
                  value={book.reference}
                  onChange={(e) =>
                    editBook({
                      reference: e.target.value,
                      referenceName: book.referenceName || "手动粘贴的参考文章",
                    })
                  }
                  placeholder={tr("粘贴参考文章。原文中的命令只被视为文本，不会执行。")}
                />
              </Field>
            </details>
            <div className="style-heading">
              <h3>{tr("本书风格档案")}</h3>
              <Button
                variant="primary-soft"
                disabled={!book.reference.trim() || busy || !!running}
                onClick={() => generateFor("style")}
              >
                <Sparkle size={17} />{tr("用 AI 分析写法")}</Button>
            </div>
            <Field
              label={tr("写作方法与语言偏好")}
              hint={tr("保存后自动应用到后续 AI 生成。可以直接手写，也可以采用 AI 分析结果。")}
            >
              <textarea
                className="large-textarea"
                value={book.style}
                onChange={(e) => editBook({ style: e.target.value })}
                placeholder={tr("叙事视角：\\n语言与句式：\\n对白特点：\\n节奏与悬念：\\n避免的表达：")}
              />
            </Field>
          </div>
        )}
      </div>
      {/* 正文 ↔ 写作助手：拖动改助手栏宽度（往左拖是变宽） */}
      <Splitter
        className="assistant-splitter"
        axis="x"
        invert
        label={tr("调整写作助手栏宽度")}
        value={panes.assistant}
        min={PANE_LIMIT.assistant.min}
        max={PANE_LIMIT.assistant.max}
        onChange={setPane("assistant")}
        onReset={resetPane("assistant")}
      />
      <button
        type="button"
        className="assistant-drawer-backdrop"
        aria-label={tr("关闭写作助手")}
        tabIndex={assistantOpen ? 0 : -1}
        onClick={() => setAssistantOpen(false)}
      />
      <button
        type="button"
        className="chapter-drawer-backdrop"
        aria-label={tr("关闭章节目录")}
        tabIndex={chapterDrawerOpen ? 0 : -1}
        onClick={() => setChapterDrawerOpen(false)}
      />
      <aside className="assistant-panel">
        <div className="assistant-header">
          <div>
            <Sparkle size={21} weight="duotone" />
            <strong>{tr("写作助手")}</strong>
          </div>
          {/* 模型选择弱化为安静 chip：作者先关心「帮我做什么」，具体模型点开才看 */}
          <Menu
            label={tr("切换写作模型")}
            align="end"
            trigger={
              <>
                <Cpu size={15} />
                <span className="model-chip-name">
                  {config.name || config.model || "默认模型"}
                </span>
                <CaretDown size={13} />
              </>
            }
          >
            <div className="menu-field">
              <small>{tr("当前模型")}</small>
              <select
                aria-label={tr("选择模型")}
                value={config.profileId || "default"}
                disabled={!!running || busy}
                onChange={(e) => {
                  const id = e.target.value;
                  void run(async () =>
                    onConfigSaved(await api<Config>("profiles:select", { id })),
                  );
                }}
              >
                {(config.profiles || [config]).map((p, i) => (
                  <option
                    key={p.profileId || i}
                    value={p.profileId || "default"}
                  >
                    {p.name || p.model || tr("默认模型")}
                    {p.provider === "codex" ? " · Codex" : ""}
                  </option>
                ))}
              </select>
            </div>
            <span className="menu-divider" />
            <button onClick={onSettings}>
              <GearSix size={15} />{tr("配置模型连接")}</button>
          </Menu>
          <IconButton
            className="assistant-drawer-close"
            label={tr("关闭写作助手")}
            onClick={() => setAssistantOpen(false)}
          >
            <X size={18} />
          </IconButton>
        </div>
        <div className="assistant-body">
          <div className="assistant-intro">
            <div className="assistant-symbol">
              <Sparkle size={26} weight="duotone" />
            </div>
            <div className="assistant-intro-copy">
              <h3>{tr("一起把故事写下去")}</h3>
              <p>{tr("选好任务开始创作，结果由你确认采用。")}</p>
            </div>
          </div>
          <div className="intent-tabs" role="tablist" aria-label={tr("任务分类")}>
            {INTENTS.map((g) => (
              <button
                key={g.id}
                role="tab"
                aria-selected={intent === g.id}
                className={intent === g.id ? "active" : ""}
                onClick={() => {
                  setIntent(g.id);
                  setAction((prev) =>
                    g.kinds.includes(prev) ? prev : g.kinds[0],
                  );
                }}
              >
                <span className="intent-tick" aria-hidden="true" />
                {tr(g.label)}
              </button>
            ))}
          </div>
          {(() => {
            const group = INTENTS.find((g) => g.id === intent) || INTENTS[0];
            const related = VIEW_KINDS[view] || [];
            const needsChapter = !chapter;
            return (
              <>
                <div
                  className="intent-preview"
                  key={group.id}
                  aria-live="polite"
                >
                  <span className="intent-preview-mark" aria-hidden="true">
                    <Sparkle size={14} weight="fill" />
                  </span>
                  <div>
                    <strong>{tr(group.label)}</strong>
                    <p>{tr(group.hint)}</p>
                  </div>
                  <small>{group.kinds.length}{" "}{tr("项")}</small>
                </div>
                <div className="action-grid">
                  {group.kinds.map((k) => (
                    <button
                      key={k}
                      className={action === k ? "active" : ""}
                      aria-pressed={action === k}
                      disabled={needsChapter}
                      title={
                        needsChapter
                          ? tr("请先在左侧选择一个章节")
                          : related.includes(k)
                            ? tr("{0} · 与本页相关", {0: tr(kinds[k])})
                            : tr(kinds[k])
                      }
                      onClick={() => setAction(k)}
                    >
                      {k === "check" ? (
                        <Brain size={16} />
                      ) : k === "polish" ? (
                        <PencilSimple size={16} />
                      ) : k === "continue" ? (
                        <ArrowRight size={16} />
                      ) : (
                        <Sparkle size={16} />
                      )}
                      <span>{tr(kinds[k])}</span>
                      {related.includes(k) && <i className="related-dot" />}
                    </button>
                  ))}
                </div>
                {needsChapter && (
                  <p className="assistant-notice">
                    <WarningCircle size={15} />{tr("这些任务都要绑定章节。先在左侧选一个章节，或新建一章。")}</p>
                )}
              </>
            );
          })()}
          {["volumeOutline", "volumeDetail"].includes(action) && (
            <Field label={tr("生成目标分卷")}>
              <select
                value={targetVolumeId}
                onChange={(e) => setTargetVolumeId(e.target.value)}
              >
                <option value="">{tr("请选择分卷")}</option>
                {book.volumes?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p className="generation-destination">{tr("生成去向：")}{["volumeOutline", "volumeDetail"].includes(action)
              ? `${book.volumes?.find((v) => v.id === targetVolumeId)?.title || tr("请先选择卷")} · ${tr(kinds[action])}`
              : tr(kinds[action])}{" "}{tr("· 确认后写入")}</p>
          <button
            className="context-toggle"
            onClick={() => setShowContext(!showContext)}
            aria-expanded={showContext}
          >
            <FolderOpen size={16} />
            <span>{tr("本次参考资料")}</span>
            <small>
              {context ? tr("{0}/{1} 项", {0: refReady, 1: refItems.length}) : tr("待准备")}
            </small>
            <CaretDown size={14} />
          </button>
          {showContext && (
            <div className="context-detail">
              <ul className="ref-list">
                {refItems.map((item) => (
                  <li key={item.label} className={item.on ? "on" : ""}>
                    <span className="ref-mark" aria-hidden="true" />
                    <b>{tr(item.label)}</b>
                    <em>{tr(item.note)}</em>
                  </li>
                ))}
              </ul>
              {context && (
                <p className="ref-foot">{tr("本次发送约")}{" "}{number(context.characters)}{" "}{tr("字符（完整资料）")}{context.chapterTitles?.length
                    ? tr(" · 关联章节：{0}", {0: context.chapterTitles.join("、")})
                    : ""}
                </p>
              )}
              {context?.sourceChapters?.length ? (
                <div className="context-chapter-picker">
                  <strong>{tr("纳入前文")}</strong>
                  {context.sourceChapters.map((source) => {
                    const selectedIds =
                      contextChapterIds ??
                      context
                        .sourceChapters!.filter((item) => item.selected)
                        .map((item) => item.id);
                    return (
                      <label key={source.id}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(source.id)}
                          disabled={busy || !!running}
                          onChange={(event) =>
                            setContextChapterIds(
                              event.target.checked
                                ? [...selectedIds, source.id]
                                : selectedIds.filter((id) => id !== source.id),
                            )
                          }
                        />
                        <span>
                          {source.title}
                          {source.relevance > 0 && <small>{" "}{tr("· 与本章相关")}</small>}
                        </span>
                      </label>
                    );
                  })}
                  <small>{tr("仅显示已定稿前章；取消勾选后，本次生成不会读取该章正文。")}</small>
                </div>
              ) : null}
              {contextError && <p>{contextError}</p>}
              {context?.warnings.map((w, i) => (
                <p className="warning" key={i}>
                  {w}
                </p>
              ))}
            </div>
          )}
          {selected && (
            <section className="candidate">
              <div className="candidate-head">
                <span>
                  <Sparkle size={15} />
                  {selected.kind === "check"
                    ? tr("检查结果")
                    : selected.kind === "memory"
                      ? tr("记忆提取结果")
                      : tr("本次生成内容")}
                </span>
                <small
                  className={`candidate-status-pill ${candidateStatus(selected).tone}`}
                >
                  {tr(candidateStatus(selected).label)}
                </small>
              </div>
              {(() => {
                const state = candidateStatus(selected);
                return (
                  <div
                    className={`candidate-state-panel ${state.tone}`}
                    role={state.tone === "error" ? "alert" : "status"}
                  >
                    <span className="candidate-state-icon">
                      {state.tone === "success" ? (
                        <CheckCircle size={17} weight="fill" />
                      ) : state.tone === "error" ? (
                        <WarningCircle size={17} weight="fill" />
                      ) : (
                        <Sparkle size={16} />
                      )}
                    </span>
                    <div className="candidate-state-copy">
                      <strong>{tr(state.label)}</strong>
                      <p>{tr(state.message)}</p>
                      {selected.status === "error" && selected.error && (
                        <details className="candidate-error-detail">
                          <summary>{tr("查看错误详情")}</summary>
                          <code>{selected.error}</code>
                        </details>
                      )}
                    </div>
                    {selected.status === "error" && (
                      <Button
                        variant="primary-soft"
                        disabled={busy || !!running}
                        onClick={() =>
                          generateFor(
                            selected.kind,
                            selected.chapterId,
                            selected.targetVolumeId,
                          )
                        }
                      >{tr("重新生成")}</Button>
                    )}
                  </div>
                );
              })()}
              {jobs.length > 1 && (
                <select
                  className="history-select"
                  aria-label={tr("生成记录")}
                  value={selected.id}
                  onChange={(e) => setSelectedJob(e.target.value)}
                >
                  {jobs.map((j) => (
                    <option value={j.id} key={j.id}>
                      {tr(kinds[j.kind])} · {date(j.createdAt)}
                    </option>
                  ))}
                </select>
              )}
              {selected.context?.warnings?.length > 0 && (
                <div className="candidate-warning">
                  {selected.context.warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              )}
              {selected.profileName && (
                <p className="candidate-source">
                  {selected.profileName} · {selected.model} ·{" "}
                  {selected.context?.skills?.length || 0}{" "}{tr("个 Skill")}</p>
              )}
              {["write", "continue", "polish"].includes(selected.kind) &&
                selected.output && (
                  <p className="candidate-source">{tr("候选")}{" "}{count(selected.output)}{" "}{tr("字 · 本章目标")}{" "}
                    {selected.context?.targetWords ||
                      chapter?.targetWords ||
                      book.chapterTargetWords ||
                      2000}{" "}{tr("字")}{selected.kind === "continue" ? tr("（本次为新增内容）") : ""}
                  </p>
                )}
              {["write", "continue", "polish"].includes(selected.kind) &&
                selected.output &&
                selected.kind !== "continue" &&
                chapter && (
                  <div className="candidate-view-toggle">
                    <button
                      className={!candidateDiff ? "active" : ""}
                      onClick={() => setCandidateDiff(false)}
                    >{tr("候选内容")}</button>
                    <button
                      className={candidateDiff ? "active" : ""}
                      onClick={() => setCandidateDiff(true)}
                    >{tr("与当前正文对照")}</button>
                  </div>
                )}
              {candidateDiff &&
              chapter &&
              ["write", "polish"].includes(selected.kind) ? (
                <CandidateDiff before={chapter.body} after={selected.output} />
              ) : (
                <CandidateBody job={selected} />
              )}
              <SyncReview
                key={selected.id}
                job={selected}
                onChange={replace}
                flush={flush}
              />
              {selected.output && (
                <>
                  <p className="generation-destination">
                    {tr(kinds[selected.kind])}
                    {selected.targetLabel
                      ? ` · ${selected.targetLabel}`
                      : ""} ·{" "}
                    {["characters", "timelinePlan"].includes(selected.kind)
                      ? tr("确认后新增记录")
                      : tr("确认后写入对应位置，原内容保留在历史版本")}
                  </p>
                  <div className="candidate-actions">
                    <Button
                      onClick={() =>
                        copyText(selected.output)
                          .then(() => notify(tr("已复制候选内容")))
                          .catch(() => notify(tr("复制失败，请选中文字复制")))
                      }
                    >
                      <Copy size={15} />{tr("复制")}</Button>
                    {selected.kind !== "check" && (
                      <Button
                        variant="primary-soft"
                        disabled={
                          !!running ||
                          busy ||
                          selected.adopted ||
                          !["done", "cancelled", "interrupted"].includes(
                            selected.status,
                          ) ||
                          ([
                            "memory",
                            "characters",
                            "timelinePlan",
                            "bookOutline",
                            "worldBuild",
                            "volumeOutline",
                            "volumeDetail",
                            "summary",
                          ].includes(selected.kind) &&
                            selected.status !== "done")
                        }
                        onClick={adopt}
                      >
                        <Check size={16} />
                        {selected.adopted
                          ? tr("已采用")
                          : selected.kind === "memory"
                            ? tr("确认记忆")
                            : selected.kind === "continue"
                              ? tr("追加到正文")
                              : tr("采用结果")}
                      </Button>
                    )}
                  </div>
                </>
              )}
              {selected.usage?.total_tokens && (
                <small className="usage">{tr("本次用量：")}{number(selected.usage.total_tokens)} Tokens
                </small>
              )}
            </section>
          )}
          {!modelReady && (
            <div className="assistant-setup">
              <PlugIcon />
              <p>{tr("连接你自己的模型服务")}<br />{tr("即可开始 AI 辅助写作")}</p>
              <Button onClick={onSettings}>{tr("配置模型")}<ArrowRight size={15} />
              </Button>
            </div>
          )}
        </div>
        {/* 助手内容 ↔ 底部设置区：拖动改设置区高度（往上拖是变高） */}
        <Splitter
          axis="y"
          invert
          label={tr("调整助手设置区高度")}
          value={panes.compose || natural.compose}
          min={PANE_LIMIT.compose.min}
          max={PANE_LIMIT.compose.max}
          measure={measureCompose}
          onChange={setPane("compose")}
          onReset={() => setPanes((p) => ({ ...p, compose: 0 }))}
        />
        <div
          className="assistant-compose"
          ref={composeBox}
          style={panes.compose ? { height: panes.compose } : undefined}
        >
          <details className="compose-advanced">
            <summary>{tr("参考范围与目标字数")}</summary>
            <div className="compose-advanced-popover">
              <Field
                label={
                  <span className="field-label-with-help">
                    关联前多少章
                    <HelpTip text="完整读取所选已定稿前章；人物、世界、有效记忆和时间线也完整关联。选择全部可包含所有已定稿前章。" />{" "}
                  </span>
                }
              >
                <select
                  value={book.contextChapters ?? 100}
                  disabled={busy || !!running}
                  onChange={(e) =>
                    editBook({ contextChapters: Number(e.target.value) })
                  }
                >
                  <option value={0}>{tr("不引用前章正文")}</option>
                  {Array.from({ length: 20 }, (_, i) => i + 1).map((i) => (
                    <option key={i} value={i}>{tr("前")}{" "}{i}{" "}{tr("章")}</option>
                  ))}
                  <option value={100}>{tr("全部已定稿前章（完整正文）")}</option>
                </select>
              </Field>
              {chapter && (
                <div className="word-target">
                  <label
                    htmlFor="chapter-target"
                    className="field-label-with-help"
                  >{tr("本章目标字数")}<HelpTip
                      text={tr("当前 {0} 字，目标 {1} 字。AI 生成字数为近似目标。", {0: count(chapter.body), 1: chapter.targetWords || book.chapterTargetWords || 2000})}
                    />
                  </label>
                  <select
                    id="chapter-target"
                    value={chapter.targetWords || 0}
                    disabled={busy || !!running}
                    onChange={(e) => {
                      const targetWords = Number(e.target.value);
                      void run(async () =>
                        replace(
                          await api<Book>("chapter:organize", {
                            id: chapter.id,
                            targetWords,
                          }),
                        ),
                      );
                    }}
                  >
                    <option value={0}>{tr("全书默认 ·")}{" "}{book.chapterTargetWords || 2000}{" "}{tr("字")}</option>
                    {!!chapter.targetWords &&
                      ![
                        1000, 1500, 2000, 2500, 3000, 4000, 5000, 8000, 10000,
                        20000,
                      ].includes(chapter.targetWords) && (
                        <option value={chapter.targetWords}>
                          {chapter.targetWords}{" "}{tr("字 · 自定义")}</option>
                      )}
                    {[
                      1000, 1500, 2000, 2500, 3000, 4000, 5000, 8000, 10000,
                      20000,
                    ].map((n) => (
                      <option key={n} value={n}>
                        {n}{" "}{tr("字")}</option>
                    ))}
                  </select>
                  <details className="custom-target">
                    <summary>{tr("自定义字数")}</summary>
                    <div>
                      <input
                        ref={customTarget}
                        key={chapter.id}
                        aria-label={tr("自定义本章字数")}
                        type="number"
                        min={100}
                        max={20000}
                        defaultValue={
                          chapter.targetWords || book.chapterTargetWords || 2000
                        }
                      />
                      <Button
                        disabled={busy || !!running}
                        onClick={() => {
                          const n = Number(customTarget.current?.value);
                          if (!Number.isInteger(n) || n < 100 || n > 20000) {
                            notify(tr("目标字数请填写 100–20000 的整数"));
                            return;
                          }
                          void run(async () =>
                            replace(
                              await api<Book>("chapter:organize", {
                                id: chapter.id,
                                targetWords: n,
                              }),
                            ),
                          );
                        }}
                      >{tr("应用字数")}</Button>
                    </div>
                  </details>
                </div>
              )}
            </div>
          </details>
          <label htmlFor="instruction">{tr("补充创作要求")}</label>
          <textarea
            id="instruction"
            value={instruction}

            onChange={(e) => setInstruction(e.target.value)}
            placeholder={tr("例如：用动作呈现紧张感，结尾留下一个悬念……")}
            rows={3}
          />
          <div className="compose-bottom">
            <span>{tr("针对：")}{chapter?.title || tr("未选择章节")}</span>
            {running ? (
              <Button
                variant="stop"
                onClick={() =>
                  api("ai:cancel", { id: running.id }).catch((e) =>
                    notify(e.message),
                  )
                }
              >
                <Stop size={15} weight="fill" />{tr("停止")}</Button>
            ) : (
              <Button
                variant="primary"
                disabled={busy || !modelReady || !chapter}
                onClick={generate}
                busy={busy}
              >
                <PaperPlaneTilt size={17} />{tr("开始生成")}</Button>
            )}
          </div>
          <small>{tr("生成内容请核对后采用 · 不会自动覆盖正文")}</small>
        </div>
      </aside>
      <button
        type="button"
        className={`memo-drawer-backdrop ${memoDrawerOpen ? "open" : ""}`}
        aria-label={tr("关闭备忘录")}
        tabIndex={memoDrawerOpen ? 0 : -1}
        onClick={closeMemoDrawer}
      />
      <aside
        className={`memo-drawer ${memoDrawerOpen ? "open" : ""}`}
        aria-label={tr("备忘录侧边栏")}
        aria-hidden={!memoDrawerOpen}
      >
        <header className="memo-drawer-header">
          <div>
            <span className="memo-drawer-icon">
              <NotePencil size={18} />
            </span>
            <span>
              <strong>{tr("备忘录")}</strong>
              <small>{tr("收好灵感，写作时随时取用")}</small>
            </span>
          </div>
          <IconButton label={tr("关闭备忘录")} onClick={closeMemoDrawer}>
            <X size={18} />
          </IconButton>
        </header>
        <div className="memo-drawer-book">
          <label htmlFor="memo-book-select">{tr("选择作品")}</label>
          <select
            id="memo-book-select"
            value={memoBook?.id || book.id}
            disabled={memoDrawerLoading}
            onChange={(event) => void selectMemoBook(event.target.value)}
          >
            {memoBooks.some((item) => item.id === book.id) ? null : (
              <option value={book.id}>{book.title}{tr("（当前作品）")}</option>
            )}
            {memoBooks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
                {item.id === book.id ? tr("（当前作品）") : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="memo-drawer-body">
          {memoDrawerError && (
            <p className="error-box" role="alert">
              {memoDrawerError}
            </p>
          )}
          {memoDrawerLoading ? (
            <div className="memo-drawer-empty">
              <span className="spin">
                <ClockCounterClockwise size={20} />
              </span>
              <p>{tr("正在打开备忘录…")}</p>
            </div>
          ) : memoBook ? (
            (() => {
              const memos = memoBook.memos || [];
              const selected =
                memos.find((memo) => memo.id === memoDrawerSelectedId) ||
                memos[0];
              const createMemo = () => {
                const now = new Date().toISOString();
                const memo: MemoNote = {
                  id: crypto.randomUUID(),
                  title: "新备忘录",
                  content: "",
                  createdAt: now,
                  updatedAt: now,
                };
                updateMemoDrawerNotes([memo, ...memos]);
                setMemoDrawerSelectedId(memo.id);
              };
              return (
                <>
                  <div className="memo-drawer-list-head">
                    <span>{memos.length}{" "}{tr("条备忘录")}</span>
                    <Button onClick={createMemo}>
                      <Plus size={15} />{tr("新建")}</Button>
                  </div>
                  {memos.length > 0 && (
                    <div className="memo-drawer-list">
                      {memos.map((memo) => (
                        <button
                          type="button"
                          key={memo.id}
                          className={selected?.id === memo.id ? "active" : ""}
                          onClick={() => setMemoDrawerSelectedId(memo.id)}
                        >
                          <NotePencil size={15} />
                          <span>
                            <strong>{memo.title || tr("未命名备忘录")}</strong>
                            <small>
                              {memo.content.trim().slice(0, 48) || tr("空白备忘录")}
                            </small>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {selected ? (
                    <section className="memo-drawer-editor">
                      <label htmlFor="memo-drawer-title">{tr("标题")}</label>
                      <input
                        id="memo-drawer-title"
                        aria-label={tr("备忘录标题")}
                        value={selected.title}
                        maxLength={160}
                        onChange={(event) =>
                          updateMemoDrawerNotes(
                            memos.map((memo) =>
                              memo.id === selected.id
                                ? {
                                    ...memo,
                                    title: event.target.value,
                                    updatedAt: new Date().toISOString(),
                                  }
                                : memo,
                            ),
                          )
                        }
                        placeholder={tr("给灵感起个标题")}
                      />
                      <label htmlFor="memo-drawer-content">{tr("内容")}</label>
                      <textarea
                        id="memo-drawer-content"
                        aria-label={tr("备忘录内容，可粘贴生成结果")}
                        value={selected.content}

                        onChange={(event) =>
                          updateMemoDrawerNotes(
                            memos.map((memo) =>
                              memo.id === selected.id
                                ? {
                                    ...memo,
                                    content: event.target.value,
                                    updatedAt: new Date().toISOString(),
                                  }
                                : memo,
                            ),
                          )
                        }
                        placeholder={tr("在这里粘贴创意工具箱的生成结果，或记下写作灵感…")}
                      />
                      <div className="memo-drawer-editor-actions">
                        <small>{tr("自动保存到「")}{memoBook.title}」</small>
                        <Button
                          variant="primary-soft"
                          disabled={!selected.content.trim()}
                          onClick={() =>
                            void copyText(selected.content)
                              .then(() =>
                                notify(tr("已复制备忘录内容，可以粘贴到正文")),
                              )
                              .catch(() =>
                                notify(tr("复制失败，请手动选择内容复制")),
                              )
                          }
                        >
                          <Copy size={15} />{tr("复制内容")}</Button>
                      </div>
                    </section>
                  ) : (
                    <div className="memo-drawer-empty">
                      <NotePencil size={24} />
                      <strong>{tr("先收下一条灵感")}</strong>
                      <p>{tr("可以把生成结果粘贴到这里，之后在写作时随时打开。")}</p>
                      <Button variant="primary-soft" onClick={createMemo}>
                        <Plus size={15} />{tr("新建备忘录")}</Button>
                    </div>
                  )}
                </>
              );
            })()
          ) : null}
        </div>
      </aside>
      {history && (
        <Modal title={tr("章节历史版本")} wide onClose={() => setHistory(null)}>
          <div className="modal-body history-list">
            {history.length ? (
              history.map((v) => (
                <article className="version-item" key={v.id}>
                  <div>
                    <b>{tr(v.label)}</b>
                    <span>
                      {date(v.createdAt)} · {number(count(v.body))}{" "}{tr("字")}</span>
                    <Button
                      onClick={() => {
                        setHistory(null);
                        setConfirm({
                          title: "恢复这个版本？",
                          message:
                            "当前正文会先保存为历史快照，相关章节记忆将标记为过期。",
                          action: async () => {
                            await api("version:restore", {
                              id: chapter.id,
                              versionId: v.id,
                              revision: current.current.chapters.find(
                                (c) => c.id === chapter.id,
                              )!.revision,
                            });
                            await reload();
                            setHistory(null);
                            notify(tr("已恢复历史版本"));
                          },
                        });
                      }}
                    >{tr("恢复")}</Button>
                  </div>
                  <details>
                    <summary>{v.title}{" "}{tr("· 展开查看")}</summary>
                    <pre>{v.body || tr("（空白正文）")}</pre>
                  </details>
                </article>
              ))
            ) : (
              <Empty
                icon={<ClockCounterClockwise size={30} />}
                title={tr("还没有历史版本")}
              >{tr("修改并保存章节后，先前的内容会保留在这里，最多保存最近 100 个版本。")}</Empty>
            )}
          </div>
        </Modal>
      )}
      {character && (
        <Modal
          title={
            book.characters.some((c) => c.id === character.id)
              ? tr("编辑人物")
              : tr("新建人物")
          }
          onClose={() => setCharacter(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!character.name.trim()) return;
              const alreadyInBook = book.characters.some(
                (c) => c.id === character.id,
              );
              const savedCharacter = alreadyInBook
                ? character
                : { ...character, introducedOrder: chapter?.order || 1 };
              editBook({
                characters: [
                  ...book.characters.filter((c) => c.id !== character.id),
                  savedCharacter,
                ],
              });
              setCharacter(null);
            }}
          >
            <div className="modal-body">
              <Field label={tr("人物姓名 *")}>
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={character.name}
                  onChange={(e) =>
                    setCharacter({ ...character, name: e.target.value })
                  }
                />
              </Field>
              <Field label={tr("身份与定位")}>
                <input
                  value={character.role}
                  maxLength={100}
                  placeholder={tr("例如：主角 · 旧书店老板")}
                  onChange={(e) =>
                    setCharacter({ ...character, role: e.target.value })
                  }
                />
              </Field>
              <Field label={tr("性格、动机与背景")}>
                <textarea
                  rows={6}
                  value={character.description}

                  onChange={(e) =>
                    setCharacter({ ...character, description: e.target.value })
                  }
                />
              </Field>
              <details className="knowledge-boundary-editor">
                <summary>{tr("认知边界（避免人物提前知道秘密）")}</summary>
                <Field label={tr("角色知道什么")}>
                  <textarea
                    rows={3}

                    value={character.characterKnown || ""}
                    placeholder={tr("填写该角色当前已经知道的事实；会结合章节时间线核对。")}
                    onChange={(e) =>
                      setCharacter({
                        ...character,
                        characterKnown: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label={tr("读者已经知道什么")}>
                  <textarea
                    rows={3}

                    value={character.readerKnown || ""}
                    placeholder={tr("填写已向读者揭示的信息，可与角色认知不同。")}
                    onChange={(e) =>
                      setCharacter({
                        ...character,
                        readerKnown: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label={tr("认知从哪一章开始生效")}>
                  <select
                    value={character.knowledgeFromChapterId || ""}
                    onChange={(e) =>
                      setCharacter({
                        ...character,
                        knowledgeFromChapterId: e.target.value,
                      })
                    }
                  >
                    <option value="">{tr("故事开始时（兼容旧档案）")}</option>
                    {book.chapters.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={tr("作者掌握的秘密")}>
                  <textarea
                    rows={3}

                    value={character.authorNotes || ""}
                    placeholder={tr("只供作者规划。默认不传给 AI，避免提前剧透。")}
                    onChange={(e) =>
                      setCharacter({
                        ...character,
                        authorNotes: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label={tr("从哪一章起允许 AI 参考秘密")}>
                  <select
                    value={character.secretFromChapterId || ""}
                    onChange={(e) =>
                      setCharacter({
                        ...character,
                        secretFromChapterId: e.target.value,
                      })
                    }
                  >
                    <option value="">{tr("不传给 AI · 仅作者查看")}</option>
                    {book.chapters.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}{" "}{tr("起")}</option>
                    ))}
                  </select>
                </Field>
              </details>
            </div>
            <div className="modal-footer">
              {book.characters.some((c) => c.id === character.id) && (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    const target = character;
                    setCharacter(null);
                    setConfirm({
                      title: "删除人物资料？",
                      message:
                        "这会移除人物档案，已记录的关系记忆和正文仍保留。",
                      action: async () => {
                        replace(
                          await api<Book>("character:delete", {
                            bookId: book.id,
                            id: target.id,
                          }),
                        );
                        notify(tr("人物已移入回收站"));
                      },
                    });
                  }}
                >{tr("删除人物")}</Button>
              )}
              <Button type="submit" variant="primary">{tr("保存人物")}</Button>
            </div>
          </form>
        </Modal>
      )}
      {worldRecord && (
        <Modal
          title={
            book.worldRecords?.some((r) => r.id === worldRecord.id)
              ? tr("编辑世界资料卡")
              : tr("新增世界资料卡")
          }
          onClose={() => setWorldRecord(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!worldRecord.title.trim()) return;
              editBook({
                worldRecords: [
                  worldRecord,
                  ...(book.worldRecords || []).filter(
                    (r) => r.id !== worldRecord.id,
                  ),
                ],
              });
              setWorldRecord(null);
            }}
          >
            <div className="modal-body">
              <Field label={tr("类别")}>
                <select
                  value={worldRecord.category}
                  onChange={(event) =>
                    setWorldRecord({
                      ...worldRecord,
                      category: event.target.value,
                    })
                  }
                >
                  <option value={"地点"}>{tr("地点")}</option>
                  <option value={"组织"}>{tr("组织")}</option>
                  <option value={"规则"}>{tr("规则")}</option>
                  <option value={"物件"}>{tr("物件")}</option>
                  <option value={"其他"}>{tr("其他")}</option>
                </select>
              </Field>
              <Field label={tr("名称 *")}>
                <input
                  autoFocus
                  required
                  maxLength={120}
                  value={worldRecord.title}
                  onChange={(event) =>
                    setWorldRecord({
                      ...worldRecord,
                      title: event.target.value,
                    })
                  }
                />
              </Field>
              <Field label={tr("设定内容")}>
                <textarea
                  rows={6}

                  value={worldRecord.description}
                  onChange={(event) =>
                    setWorldRecord({
                      ...worldRecord,
                      description: event.target.value,
                    })
                  }
                  placeholder={tr("写清作用、边界或关键细节")}
                />
              </Field>
              <Field label={tr("确定程度")}>
                <select
                  value={worldRecord.certainty}
                  onChange={(event) =>
                    setWorldRecord({
                      ...worldRecord,
                      certainty: event.target.value as WorldRecord["certainty"],
                    })
                  }
                >
                  <option value="fixed">{tr("已确认设定")}</option>
                  <option value="provisional">{tr("暂定，后续可能调整")}</option>
                </select>
              </Field>
            </div>
            <div className="modal-footer">
              <Button type="button" onClick={() => setWorldRecord(null)}>{tr("取消")}</Button>
              <Button type="submit" variant="primary">{tr("保存资料卡")}</Button>
            </div>
          </form>
        </Modal>
      )}
      {memoryForm && (
        <MemoryForm
          book={book}
          initial={editingMemory || undefined}
          onClose={() => {
            setMemoryForm(false);
            setEditingMemory(null);
          }}
          onSave={async (memory) => {
            await flush();
            replace(
              await api<Book>(editingMemory ? "memory:update" : "memory:add", {
                bookId: book.id,
                memory: editingMemory
                  ? { ...memory, id: editingMemory.id }
                  : memory,
              }),
            );
            setMemoryForm(false);
            setEditingMemory(null);
          }}
        />
      )}
      {canvasSource && (
        <CanvasSourceEditor
          key={`${canvasSource.kind}:${canvasSource.id || "new"}`}
          book={book}
          request={canvasSource}
          chapterId={chapterId}
          editBook={editBook}
          editChapter={editChapter}
          flush={flush}
          onChange={replace}
          onClose={() => setCanvasSource(null)}
          notify={notify}
        />
      )}
      {canvasEvent && (
        <TimelinePanel
          key={canvasEvent.key}
          book={book}
          kind={canvasEvent.kind}
          chapterId={chapterId}
          onChange={replace}
          flush={flush}
          notify={notify}
          editorOnly
          initialEvent={canvasEvent.event}
          createOnMount={!canvasEvent.event}
          onEditorClose={() => setCanvasEvent(null)}
        />
      )}
      {confirm && (
        <Modal title={tr(confirm.title)} onClose={() => setConfirm(null)}>
          <div className="modal-body">
            <p>{tr(confirm.message)}</p>
          </div>
          <div className="modal-footer">
            <Button onClick={() => setConfirm(null)}>{tr("取消")}</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                const fn = confirm.action;
                setConfirm(null);
                void run(fn);
              }}
            >{tr("确认")}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ArrowUpRightMini() {
  return <CaretRight size={13} />;
}
function candidateStatus(job: Job): {
  label: string;
  message: string;
  tone: "active" | "success" | "error" | "neutral";
} {
  if (job.status === "running") {
    return {
      label: "正在生成",
      message: job.output
        ? `已收到 ${number(count(job.output))} 字，模型仍在继续输出。`
        : "正在连接模型服务，收到内容后会显示在这里。",
      tone: "active",
    };
  }
  if (job.review?.status === "analyzing") {
    return {
      label: "正在检查正文",
      message: "生成内容已收到，正在核对人物、设定和情节连续性。",
      tone: "active",
    };
  }
  if (job.status === "error") {
    const error = job.error.toLowerCase();
    const connectionIssue =
      /fetch failed|failed to fetch|network|econnrefused|enotfound|timeout|timed out/.test(
        error,
      );
    return {
      label: "生成失败",
      message: `${connectionIssue ? "连接模型服务失败，请检查网络、服务地址和模型设置。" : "这次生成没有完成，请查看错误详情并重试。"}${job.output ? ` 已保留 ${number(count(job.output))} 字的部分结果。` : ""}`,
      tone: "error",
    };
  }
  if (job.review?.status === "error") {
    return {
      label: "正文已生成，检查未完成",
      message: "候选内容已保留。你可以先手动核对，或稍后重新生成检查结果。",
      tone: "neutral",
    };
  }
  if (job.status === "interrupted") {
    return {
      label: "生成中断，内容已保留",
      message: job.output
        ? `已保留 ${number(count(job.output))} 字，可复制整理后继续。`
        : "本次生成未完成，可以调整模型设置后重新生成。",
      tone: "neutral",
    };
  }
  if (job.status === "cancelled") {
    return {
      label: "已停止生成",
      message: job.output
        ? `已保留 ${number(count(job.output))} 字的部分结果。`
        : "本次没有生成内容，可以随时重新开始。",
      tone: "neutral",
    };
  }
  if (job.adopted) {
    return {
      label: "已采用",
      message: "这份内容已写入对应位置；原有内容保留在历史版本中。",
      tone: "success",
    };
  }
  if (job.status === "done" && job.kind === "check") {
    return {
      label: "检查完成",
      message: "检查结果已列在下方，可逐项查看。",
      tone: "success",
    };
  }
  if (job.status === "done" && job.kind === "memory") {
    return {
      label: "等待你确认",
      message: "这些事实尚未写入记忆；核对原文后点击“确认记忆”。",
      tone: "active",
    };
  }
  if (job.status === "done") {
    return {
      label: "等待你采用",
      message: "先检查候选内容，点击“采用结果”后才会写入作品。",
      tone: "active",
    };
  }
  return {
    label: "内容已保留",
    message: "这条记录仍在候选区，可以查看或重新生成。",
    tone: "neutral",
  };
}

function CandidateDiff({ before, after }: { before: string; after: string }) {
  return (
    <div className="candidate-diff">
      <section>
        <header>{tr("当前正文")}{" "}<small>{count(before)}{" "}{tr("字")}</small>
        </header>
        <pre>{before || tr("（当前正文为空）")}</pre>
      </section>
      <section>
        <header>{tr("候选内容")}{" "}<small>{count(after)}{" "}{tr("字")}</small>
        </header>
        <pre>{after}</pre>
      </section>
    </div>
  );
}
function CandidateBody({ job }: { job: Job }) {
  if (
    ["characters", "timelinePlan"].includes(job.kind) &&
    job.status === "done"
  ) {
    try {
      const data = JSON.parse(
        job.output.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""),
      );
      const records = job.kind === "characters" ? data.characters : data.events;
      if (Array.isArray(records) && records.length)
        return (
          <div className="structured-candidate">
            {records.map((r: Record<string, unknown>, i: number) => (
              <article key={i}>
                <b>{String(r.name || r.title || `记录 ${i + 1}`)}</b>
                <small>{String(r.role || r.attribute || "")}</small>
                <p>{String(r.description || r.value || "")}</p>
                {job.kind === "timelinePlan" && (
                  <small>{tr("采用后保存为计划，尚未确认发生")}</small>
                )}
              </article>
            ))}
          </div>
        );
    } catch {
      /* Incomplete or invalid JSON remains visible for review. */
    }
  }

  if (job.kind === "memory" && job.status === "done") {
    try {
      const data = JSON.parse(
        job.output.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""),
      );
      if (
        Array.isArray(data.memories) &&
        data.memories.every(
          (m: Record<string, unknown>) =>
            m &&
            ["subject", "relation", "object", "evidence"].every(
              (k) => typeof m[k] === "string",
            ),
        )
      ) {
        return (
          <div className="candidate-facts">
            {data.memories.length ? (
              data.memories.map(
                (
                  m: {
                    subject: string;
                    relation: string;
                    object: string;
                    evidence: string;
                  },
                  i: number,
                ) => (
                  <article key={i}>
                    <p>
                      <strong>{m.subject}</strong>
                      <span>{m.relation}</span>
                      {m.object}
                    </p>
                    <blockquote>{m.evidence}</blockquote>
                  </article>
                ),
              )
            ) : (
              <p>{tr("没有提取到可核对的新事实。")}</p>
            )}
            <small>{tr("请核对事实与原文，再确认保存。")}</small>
          </div>
        );
      }
    } catch {
      /* Keep the original response available when provider output is malformed. */
    }
  }
  if (!job.output) return null;
  return (
    <pre
      className={`candidate-text ${job.status === "running" ? "streaming" : ""}`}
    >
      {job.output || tr("正在连接模型，等待输出…")}
    </pre>
  );
}
function PlugIcon() {
  return <GearSix size={22} />;
}
function HelpTip({ text }: { text: string }) {
  return (
    <span className="help-tip" tabIndex={0} role="note" aria-label={tr(text)}>
      <Info size={13} aria-hidden="true" />
      <span className="help-tip-content" role="tooltip">
        {tr(text)}
      </span>
    </span>
  );
}
function PageHeading({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div className="page-heading-icon">{icon}</div>
      <div>
        <h1>{title}</h1>
        <p>{tr(text)}</p>
      </div>
      {action}
    </div>
  );
}
function CanvasModeSwitch({
  mode,
  onChange,
}: {
  mode: "regular" | "canvas";
  onChange: (mode: "regular" | "canvas") => void;
}) {
  return (
    <div className="canvas-display-row">
      <div className="canvas-display-switch" role="group" aria-label={tr("资料展示方式")}>
        <button
          type="button"
          aria-pressed={mode === "regular"}
          className={mode === "regular" ? "active" : ""}
          onClick={() => onChange("regular")}
        >
          <ListBullets size={15} />{tr("常规")}</button>
        <button
          type="button"
          aria-pressed={mode === "canvas"}
          className={mode === "canvas" ? "active" : ""}
          onClick={() => onChange("canvas")}
        >
          <SquaresFour size={15} />{tr("画布")}</button>
      </div>
    </div>
  );
}
function MemoryForm({
  book,
  initial,
  onClose,
  onSave,
}: {
  book: Book;
  initial?: Memory;
  onClose: () => void;
  onSave: (
    v: Pick<
      Memory,
      "subject" | "relation" | "object" | "sourceChapterId" | "evidence"
    >,
  ) => Promise<void>;
}) {
  const [value, setValue] = useState({
    subject: initial?.subject || "",
    relation: initial?.relation || "",
    object: initial?.object || "",
    sourceChapterId: initial?.sourceChapterId || "",
    evidence: initial?.evidence || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title={initial ? tr("编辑事实记忆") : tr("记录一条事实")}
      onClose={() => !busy && onClose()}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(value);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <div className="form-row">
            <Field label={tr("主体 *")}>
              <input
                required
                maxLength={120}
                value={value.subject}
                onChange={(e) =>
                  setValue({ ...value, subject: e.target.value })
                }
                placeholder={tr("例如：陈默")}
              />
            </Field>
            <Field label={tr("关系或状态 *")}>
              <input
                required
                maxLength={200}
                value={value.relation}
                onChange={(e) =>
                  setValue({ ...value, relation: e.target.value })
                }
                placeholder={tr("例如：将铜钥匙交给")}
              />
            </Field>
          </div>
          <Field label={tr("对象或事实内容 *")}>
            <textarea
              required
              rows={3}
              value={value.object}

              onChange={(e) => setValue({ ...value, object: e.target.value })}
              placeholder={tr("例如：林晚保管")}
            />
          </Field>
          <Field
            label={tr("事实来源")}
            hint={tr("固定设定始终可用；章节事实只对来源章节之后生效。")}
          >
            <select
              value={value.sourceChapterId}
              onChange={(e) =>
                setValue({
                  ...value,
                  sourceChapterId: e.target.value,
                  evidence: "",
                })
              }
            >
              <option value="">{tr("作者确认的固定设定")}</option>
              {initial?.sourceChapterId &&
                !book.chapters.some(
                  (c) =>
                    c.id === initial.sourceChapterId && c.status === "final",
                ) && (
                  <option value={initial.sourceChapterId} disabled>
                    {book.chapters.find((c) => c.id === initial.sourceChapterId)
                      ?.title || tr("来源章节已删除")}{" "}{tr("· 需核对并重新定稿")}</option>
                )}
              {book.chapters
                .filter((c) => c.status === "final")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
            </select>
          </Field>
          {value.sourceChapterId && (
            <Field
              label={tr("原文证据 *")}
              hint={tr("从来源章节复制一段连续原文，系统会核对它是否存在。")}
            >
              <textarea
                required
                rows={3}

                value={value.evidence}
                onChange={(e) =>
                  setValue({ ...value, evidence: e.target.value })
                }
              />
            </Field>
          )}
          {error && (
            <p className="error-box" role="alert">
              {tr(error)}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>{tr("取消")}</Button>
          <Button variant="primary" type="submit" busy={busy}>{tr("保存记忆")}</Button>
        </div>
      </form>
    </Modal>
  );
}
