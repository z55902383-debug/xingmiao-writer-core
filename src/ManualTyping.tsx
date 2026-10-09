import { tr } from "./i18n";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  ArrowLeft,
  FloppyDisk,
  Timer,
  ArrowsOut,
  ArrowsIn,
  Play,
  Pause,
  ArrowCounterClockwise,
  ArrowClockwise,
  CheckCircle,
  BookOpen,
  NotePencil,
  SpeakerHigh,
  SpeakerSlash,
  Target,
  WarningCircle,
  DownloadSimple,
  Sun,
  Moon,
  FolderOpen,
  MagnifyingGlass,
  TextAlignLeft,
  ClockCounterClockwise,
  CaretUp,
  CaretDown,
  X,
  TextAa,
  Sparkle,
} from "@phosphor-icons/react";
import type { Book, BookSummary, Chapter, Job } from "./types";
import { api, count, number } from "./api";
import { Button, Field, IconButton, Modal } from "./ui";
import { currentTheme, toggleTheme } from "./theme";
import { DraftManager, ManualSources } from "./ManualWritingTools";
import ManuscriptSettings, { useManuscriptFormat } from "./ManuscriptSettings";
import { handleManuscriptEnter, useManuscriptTyping } from "./manuscriptInput";
import type { ManuscriptFormat } from "../electron/manuscript-format.mjs";
import ManualMemoPanel from "./ManualMemoPanel";
import ManualIdeaAssistant from "./ManualIdeaAssistant";
import { useManualMemos } from "./useManualMemos";
import "./manual-ideas.css";
import {
  findTextMatches,
  replaceTextMatches,
  formatManuscript,
} from "./manualEditing";

const LIBRARY_KEY = "xm-manual-library-v2";
const LEGACY_KEY = "xm-manual-draft";
const PREF_KEY = "xm-manual-prefs";
const PANEL_KEY = "xm-manual-panel-state-v1";
type PanelState = { ideas: boolean; memos: boolean; last: "ideas" | "memos" };
function loadPanels(): PanelState {
  try {
    const value = JSON.parse(localStorage.getItem(PANEL_KEY) || "null");
    if (value?.version === 1) return { ideas: value.ideas === true, memos: value.memos === true,
      last: value.last === "ideas" ? "ideas" : "memos" };
  } catch { /* A missing or unreadable preference starts with the writing area. */ }
  return { ideas: false, memos: false, last: "memos" };
}
const FONT_SIZES = [14, 16, 18, 20, 22, 24];
type TargetMode = "none" | "session" | "daily";
type Prefs = {
  fontSize: number;
  targetMode: TargetMode;
  targetWords: number;
  sound: boolean;
  timerMinutes: number;
  lineHeight: number;
  fontFamily: "system" | "serif";
};
type Draft = {
  key: string;
  bookId: string | null;
  chapterId: string | null;
  title: string;
  text: string;
  baseBody: string;
  baseTitle: string;
  baseRevision: number | null;
  updatedAt: string;
};
type Library = {
  version: 2;
  activeKey: string;
  drafts: Record<string, Draft>;
  daily: Record<string, number>;
  trash: Record<string, Draft>;
};
const DEFAULT_PREFS: Prefs = {
  fontSize: 18,
  targetMode: "session",
  targetWords: 1000,
  sound: false,
  timerMinutes: 25,
  lineHeight: 1.8,
  fontFamily: "system",
};
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const inRange = (n: unknown, min: number, max: number): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}") || {};
    return {
      fontSize: FONT_SIZES.includes(p.fontSize) ? p.fontSize : 18,
      targetMode: ["none", "session", "daily"].includes(p.targetMode)
        ? p.targetMode
        : "session",
      targetWords: inRange(p.targetWords, 100, 100000) ? p.targetWords : 1000,
      sound: p.sound === true,
      timerMinutes: inRange(p.timerMinutes, 5, 120) ? p.timerMinutes : 25,
      lineHeight: [1.6, 1.8, 2, 2.2, 2.4].includes(p.lineHeight)
        ? p.lineHeight
        : 1.8,
      fontFamily: p.fontFamily === "serif" ? "serif" : "system",
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}
function scratch(title = "", text = ""): Draft {
  return {
    key: `scratch:${crypto.randomUUID()}`,
    bookId: null,
    chapterId: null,
    title,
    text,
    baseBody: "",
    baseTitle: "",
    baseRevision: null,
    updatedAt: new Date().toISOString(),
  };
}
function chapterDraft(c: Chapter): Draft {
  return {
    key: `chapter:${c.id}`,
    bookId: c.bookId,
    chapterId: c.id,
    title: c.title,
    text: c.body,
    baseBody: c.body,
    baseTitle: c.title,
    baseRevision: c.revision,
    updatedAt: c.updatedAt,
  };
}
function changed(d: Draft) {
  return d.text !== d.baseBody || d.title !== d.baseTitle;
}
function loadLibrary(): Library {
  try {
    const raw = JSON.parse(localStorage.getItem(LIBRARY_KEY) || "null");
    if (raw?.version === 2 && raw.drafts && typeof raw.drafts === "object") {
      const drafts: Record<string, Draft> = {};
      const recoveredKeys: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw.drafts)) {
        const d = value as Draft;
        if (!d || typeof d.text !== "string") continue;
        const valid =
          d.key === key &&
          /^(scratch|chapter):/.test(key) &&
          typeof d.title === "string" &&
          typeof d.baseBody === "string" &&
          typeof d.baseTitle === "string" &&
          ((d.chapterId === null && d.bookId === null) ||
            (typeof d.chapterId === "string" &&
              typeof d.bookId === "string" &&
              inRange(d.baseRevision, 1, Number.MAX_SAFE_INTEGER)));
        if (!valid) {
          const recovered = scratch(
            typeof d.title === "string" ? d.title : "",
            d.text,
          );
          drafts[recovered.key] = recovered;
          recoveredKeys[key] = recovered.key;
          continue;
        }
        drafts[key] = {
          ...d,
          updatedAt:
            typeof d.updatedAt === "string" &&
            !Number.isNaN(Date.parse(d.updatedAt))
              ? d.updatedAt
              : new Date().toISOString(),
        };
      }
      const activeKey = Object.hasOwn(drafts, raw.activeKey)
        ? raw.activeKey
        : Object.hasOwn(recoveredKeys, raw.activeKey)
          ? recoveredKeys[raw.activeKey]
          : Object.keys(drafts)[0];
      if (activeKey) {
        const daily = Object.fromEntries(
          Object.entries(raw.daily || {}).filter(
            ([key, n]) =>
              /^\d{4}-\d{2}-\d{2}$/.test(key) &&
              typeof n === "number" &&
              Number.isFinite(n),
          ),
        ) as Record<string, number>;
        const trash: Record<string, Draft> = {};
        for (const [key, value] of Object.entries(raw.trash || {})) {
          const d = value as Draft;
          if (!d || typeof d.text !== "string") continue;
          const recovered =
            d.key === key &&
            key.startsWith("scratch:") &&
            typeof d.title === "string"
              ? d
              : scratch(typeof d.title === "string" ? d.title : "", d.text);
          trash[recovered.key] = {
            ...recovered,
            bookId: null,
            chapterId: null,
            baseBody: "",
            baseTitle: "",
            baseRevision: null,
            updatedAt:
              typeof recovered.updatedAt === "string" &&
              !Number.isNaN(Date.parse(recovered.updatedAt))
                ? recovered.updatedAt
                : new Date().toISOString(),
          };
        }
        return { version: 2, activeKey, drafts, daily, trash };
      }
    }
  } catch {
    /* Fall back to the legacy recovery copy below. */
  }
  let d = scratch();
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
    // Legacy drafts have no baseline: recover independent text instead of overwriting a chapter.
    if (old && typeof old.text === "string")
      d = scratch(
        typeof old.chapterTitle === "string" ? old.chapterTitle : "",
        old.text,
      );
  } catch {
    /* No recoverable legacy draft. */
  }
  return {
    version: 2,
    activeKey: d.key,
    drafts: { [d.key]: d },
    daily: {},
    trash: {},
  };
}
function usePomodoro(workMin: number, notify: (message: string) => void) {
  const [phase, setPhase] = useState<"work" | "break">("work");
  const [seconds, setSeconds] = useState(workMin * 60);
  const [running, setRunning] = useState(false);
  const deadline = useRef<number | null>(null);
  const total = phase === "work" ? workMin * 60 : 300;
  useEffect(() => {
    deadline.current = null;
    setPhase("work");
    setSeconds(workMin * 60);
    setRunning(false);
  }, [workMin]);
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      if (deadline.current === null) return;
      const left = Math.max(
        0,
        Math.ceil((deadline.current - Date.now()) / 1000),
      );
      setSeconds(left);
      if (left === 0) {
        deadline.current = null;
        setRunning(false);
        setPhase(phase === "work" ? "break" : "work");
        setSeconds(phase === "work" ? 300 : workMin * 60);
        notify(
          phase === "work"
            ? tr("本轮专注完成，休息五分钟吧。准备好后点击开始。")
            : tr("休息结束，准备好后开始下一轮码字。"),
        );
      }
    };
    const interval = window.setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [running, phase, workMin, notify]);
  const toggle = () => {
    if (running) {
      setSeconds(
        Math.max(
          0,
          Math.ceil(((deadline.current ?? Date.now()) - Date.now()) / 1000),
        ),
      );
      deadline.current = null;
      setRunning(false);
    } else {
      deadline.current = Date.now() + seconds * 1000;
      setRunning(true);
    }
  };
  const reset = () => {
    deadline.current = null;
    setRunning(false);
    setPhase("work");
    setSeconds(workMin * 60);
  };
  return {
    phase,
    running,
    toggle,
    reset,
    seconds,
    total,
    display: `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`,
  };
}

export default function ManualTyping({
  books,
  onBack,
  notify,
  closeGuard,
  onSettings,
}: {
  books: BookSummary[];
  onBack: () => Promise<void>;
  notify: (msg: string) => void;
  closeGuard: MutableRefObject<() => Promise<void>>;
  onSettings: () => void;
}) {
  const [library, setLibrary] = useState<Library>(loadLibrary);
  const libraryRef = useRef(library);
  const draft = library.drafts[library.activeKey];
  const [prefs, setPrefs] = useState(loadPrefs);
  const [focus, setFocus] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDisplaySettings, setShowDisplaySettings] = useState(false);
  const [panels, setPanels] = useState(loadPanels);
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const [narrowPanels, setNarrowPanels] = useState(() => window.innerWidth < 1200);
  const showIdeas = panels.ideas && (!narrowPanels || !panels.memos || panels.last === "ideas");
  const showMemos = panels.memos && (!narrowPanels || !panels.ideas || panels.last === "memos");
  const memos = useManualMemos(books, draft.bookId);
  const ideaCloseGuard = useRef<() => Promise<void>>(async () => {});
  const [showAttach, setShowAttach] = useState(false);
  const [showReload, setShowReload] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showManuscriptSettings, setShowManuscriptSettings] = useState(false);
  const manuscript = useManuscriptFormat();
  const [confirmClear, setConfirmClear] = useState(false);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  const [lastReplacement, setLastReplacement] = useState<{
    key: string;
    before: string;
    after: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [localStatus, setLocalStatus] = useState<"pending" | "saved" | "error">(
    "pending",
  );
  const [localSavedAt, setLocalSavedAt] = useState("");
  const [saveError, setSaveError] = useState("");
  const [sessionNet, setSessionNet] = useState(0);
  const [day, setDay] = useState(localDay);
  const [theme, setTheme] = useState(currentTheme);
  const [targetInput, setTargetInput] = useState(String(prefs.targetWords));
  const [timerInput, setTimerInput] = useState(String(prefs.timerMinutes));
  const [settingsError, setSettingsError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const exportedDrafts = useRef(
    new Map<string, { title: string; text: string }>(),
  );
  const exportLock = useRef(false);
  const [exporting, setExporting] = useState(false);
  const pomo = usePomodoro(prefs.timerMinutes, notify);
  const words = useMemo(() => count(draft.text), [draft.text]);
  const dailyNet = library.daily[day] || 0;
  const targetNet = prefs.targetMode === "daily" ? dailyNet : sessionNet;
  const progress = Math.min(1, Math.max(0, targetNet) / prefs.targetWords);
  const bookTitle = books.find((b) => b.id === draft.bookId)?.title;
  const dirty = changed(draft);
  const chapterConflict = saveError === tr(
    "作品中的章节已被修改，未覆盖新内容。可导出草稿、另存为新章节，或重新载入作品。",
  );
  const matches = useMemo(
    () => findTextMatches(draft.text, findQuery, caseSensitive),
    [draft.text, findQuery, caseSensitive],
  );

  const commit = useCallback((fn: (old: Library) => Library) => {
    const next = fn(libraryRef.current);
    libraryRef.current = next;
    setLibrary(next);
    setLocalStatus("pending");
  }, []);
  const persist = useCallback(() => {
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(libraryRef.current));
      setLocalSavedAt(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      setLocalStatus("saved");
    } catch {
      setLocalStatus("error");
      throw new Error(tr("草稿保留失败，请保存到作品或导出 TXT 后再离开。"));
    }
  }, []);
  const canLeaveWithoutLocalCopy = useCallback(
    () =>
      [
        ...Object.values(libraryRef.current.drafts),
        ...Object.values(libraryRef.current.trash),
      ].every((d) => {
        const exported = exportedDrafts.current.get(d.key);
        return (
          (d.chapterId && !changed(d)) ||
          (!d.title && !d.text) ||
          (exported?.title === d.title && exported?.text === d.text)
        );
      }),
    [],
  );
  const protectDrafts = useCallback(async () => {
    try {
      persist();
    } catch (e) {
      if (!canLeaveWithoutLocalCopy()) throw e;
    }
  }, [persist, canLeaveWithoutLocalCopy]);
  const exportDraft = async () => {
    if (exportLock.current) return;
    exportLock.current = true;
    setExporting(true);
    const snapshot = libraryRef.current.drafts[libraryRef.current.activeKey];
    try {
      const path = await api<string | null>("manual:export-draft", {
        title: snapshot.title,
        body: snapshot.text,
      });
      if (path) {
        exportedDrafts.current.set(snapshot.key, {
          title: snapshot.title,
          text: snapshot.text,
        });
        notify(tr("TXT 已保存：{0}", { 0: path }));
      }
    } catch (e) {
      notify((e as Error).message);
    } finally {
      exportLock.current = false;
      setExporting(false);
    }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        persist();
      } catch {
        /* Visible persistent banner. */
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [library, persist]);
  useEffect(() => {
    const guard = async () => {
      await ideaCloseGuard.current();
      await memos.save();
      await protectDrafts();
    };
    closeGuard.current = guard;
    const flush = () => {
      try {
        persist();
      } catch {
        /* Keep the in-memory recovery copy. */
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      try {
        persist();
      } catch {
        if (!canLeaveWithoutLocalCopy()) {
          e.preventDefault();
          e.returnValue = "";
        }
      }
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      flush();
      if (closeGuard.current === guard) closeGuard.current = async () => {};
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    closeGuard,
    persist,
    protectDrafts,
    canLeaveWithoutLocalCopy,
    memos.save,
  ]);
  useEffect(() => {
    const refresh = () => setDay(localDay());
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  useEffect(() => {
    const active = libraryRef.current.drafts[library.activeKey];
    setGeneratedCount(0);
    if (!active.bookId || !active.chapterId) return;
    let cancelled = false;
    let request = 0;
    const refresh = () => {
      const snapshot = libraryRef.current.drafts[libraryRef.current.activeKey];
      if (snapshot.key !== active.key || !snapshot.bookId) return;
      const token = ++request;
      void api<Book>("book:get", { id: snapshot.bookId })
        .then((b) => {
          if (
            cancelled ||
            token !== request ||
            libraryRef.current.activeKey !== snapshot.key
          )
            return;
          const current = libraryRef.current.drafts[snapshot.key];
          void api<Job[]>("manual:chapter-sources", {
            chapterId: snapshot.chapterId,
          })
            .then((sources) => {
              if (
                !cancelled &&
                token === request &&
                libraryRef.current.activeKey === snapshot.key
              )
                setGeneratedCount(
                  sources.filter((j) => j.status === "done" && !j.adopted)
                    .length,
                );
            })
            .catch(() => {
              /* The chapter itself can still be synchronized when source lookup fails. */
            });
          setGeneratedCount(
            b.candidates.filter(
              (j) =>
                j.chapterId === snapshot.chapterId &&
                ["write", "continue", "polish"].includes(j.kind) &&
                j.status === "done" &&
                !j.adopted &&
                j.output.trim(),
            ).length,
          );
          const latest = b.chapters.find((c) => c.id === snapshot.chapterId);
          if (!latest) {
            setSaveError(tr("章节不存在，草稿仍保留。请另存到其他作品。"));
            return;
          }
          if (b.archived) {
            setSaveError(tr("作品已归档，请先恢复作品，或另存为新章节。"));
            return;
          }
          if (!current || current.baseRevision !== snapshot.baseRevision)
            return;
          if (!changed(current)) {
            if (
              latest.revision !== current.baseRevision ||
              latest.title !== current.title ||
              latest.body !== current.text
            ) {
              commit((lib) => ({
                ...lib,
                drafts: { ...lib.drafts, [current.key]: chapterDraft(latest) },
              }));
              setSaveError("");
            }
          } else if (
            latest.body !== current.baseBody ||
            latest.title !== current.baseTitle
          ) {
            setSaveError(
              tr(
                "作品中的章节已被修改，未覆盖新内容。可导出草稿、另存为新章节，或重新载入作品。",
              ),
            );
          }
        })
        .catch((e) => {
          if (!cancelled && token === request) setSaveError(e.message);
        });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const unsubscribe = window.xingmiao?.onJob((job) => {
      if (
        job.bookId === active.bookId &&
        ["write", "continue", "polish"].includes(job.kind)
      )
        refresh();
    });
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe?.();
    };
  }, [library.activeKey, commit]);
  useEffect(
    () => () => {
      void audioCtx.current?.close().catch(() => {});
    },
    [],
  );

  const edit = (patch: Partial<Pick<Draft, "text" | "title">>) => {
    const old = libraryRef.current.drafts[libraryRef.current.activeKey];
    const delta =
      patch.text === undefined ? 0 : count(patch.text) - count(old.text);
    const key = localDay();
    setDay(key);
    setSessionNet((n) => n + delta);
    commit((lib) => ({
      ...lib,
      daily: { ...lib.daily, [key]: (lib.daily[key] || 0) + delta },
      drafts: {
        ...lib.drafts,
        [old.key]: { ...old, ...patch, updatedAt: new Date().toISOString() },
      },
    }));
  };
  const inputFormat = {
    ...manuscript.format,
    autoIndent:
      !manuscript.loading && !manuscript.error && manuscript.format.autoIndent,
  };
  useManuscriptTyping(
    textareaRef,
    inputFormat,
    (text) => edit({ text }),
    draft.key,
  );
  const switchDraft = (next: Draft) => {
    try {
      persist();
    } catch (e) {
      notify((e as Error).message);
    }
    commit((lib) => {
      const old = lib.drafts[lib.activeKey];
      const drafts = { ...lib.drafts, [next.key]: next };
      if (old.key !== next.key && old.chapterId && !changed(old))
        delete drafts[old.key];
      return { ...lib, activeKey: next.key, drafts };
    });
    setSaveError("");
    setShowPicker(false);
    setShowDrafts(false);
    setMatchIndex(0);
    setLastReplacement(null);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.scrollTop = 0;
        textareaRef.current.focus();
      }
    });
  };
  const selectChapter = (c: Chapter) => {
    const existing = libraryRef.current.drafts[`chapter:${c.id}`];
    switchDraft(existing && changed(existing) ? existing : chapterDraft(c));
  };
  const saveChapter = useCallback(
    async (allowEmpty = false): Promise<boolean> => {
      const snapshot = libraryRef.current.drafts[libraryRef.current.activeKey];
      if (savingRef.current) return false;
      if (!snapshot.bookId || !snapshot.chapterId) {
        setShowAttach(true);
        return false;
      }
      if (!allowEmpty && !snapshot.text.trim() && snapshot.baseBody.trim()) {
        setConfirmClear(true);
        return false;
      }
      savingRef.current = true;
      setSaving(true);
      setSaveError("");
      try {
        try {
          persist();
        } catch {
          /* A database save can still rescue this draft. */
        }
        const b = await api<Book>("book:get", { id: snapshot.bookId });
        if (b.archived)
          throw new Error(tr("作品已归档，请先恢复作品，或另存为新章节。"));
        const latest = b.chapters.find((c) => c.id === snapshot.chapterId);
        if (!latest)
          throw new Error(tr("章节不存在，草稿仍保留。请另存到其他作品。"));
        const title = snapshot.title.trim() || latest.title;
        // Only refresh the revision after checking the body/title originally loaded.
        if (
          (latest.body !== snapshot.baseBody ||
            latest.title !== snapshot.baseTitle) &&
          (latest.body !== snapshot.text || latest.title !== title)
        ) {
          throw new Error(
            tr(
              "作品中的章节已被修改，未覆盖新内容。可导出草稿、另存为新章节，或重新载入作品。",
            ),
          );
        }
        const saved = await api<Chapter>("chapter:save", {
          id: latest.id,
          revision: latest.revision,
          patch: { body: snapshot.text, title },
        });
        commit((lib) => {
          const current = lib.drafts[snapshot.key];
          return {
            ...lib,
            drafts: {
              ...lib.drafts,
              [snapshot.key]: {
                ...current,
                title:
                  current.title === snapshot.title
                    ? saved.title
                    : current.title,
                baseBody: saved.body,
                baseTitle: saved.title,
                baseRevision: saved.revision,
              },
            },
          };
        });
        try {
          persist();
        } catch {
          /* The manuscript is stored in the work. */
        }
        notify(tr("已保存到「{0}」", { 0: saved.title }));
        setConfirmClear(false);
        return true;
      } catch (e) {
        const message = (e as Error).message;
        setSaveError(message);
        notify(message);
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [commit, notify, persist],
  );
  const back = async () => {
    if (savingRef.current || leaving) return;
    setLeaving(true);
    try {
      await ideaCloseGuard.current();
      await memos.save();
      await protectDrafts();
      await onBack();
    } catch (e) {
      notify((e as Error).message);
      setLeaving(false);
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if ((e.target as HTMLElement)?.closest?.(".mt-idea-panel")) return;
        if ((e.target as HTMLElement)?.closest?.(".mt-memo-panel")) {
          void memos.save().catch((error) => notify(error.message));
          return;
        }
        if (!document.querySelector("dialog[open]")) void saveChapter();
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "f" &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        if ((e.target as HTMLElement)?.closest?.(".mt-memo-panel")) {
          document
            .querySelector<HTMLInputElement>(
              ".mt-memo-filter input[type='search']",
            )
            ?.focus();
          return;
        }
        if ((e.target as HTMLElement)?.closest?.(".mt-idea-panel")) return;
        setFindOpen(true);
        const selected = textareaRef.current
          ? libraryRef.current.drafts[libraryRef.current.activeKey].text.slice(
              textareaRef.current.selectionStart,
              textareaRef.current.selectionEnd,
            )
          : "";
        if (selected) setFindQuery(selected);
        requestAnimationFrame(() =>
          document.getElementById("mt-find-query")?.focus(),
        );
      }
      if (e.key === "F11") {
        e.preventDefault();
        if (!document.querySelector("dialog[open]")) setFocus((f) => !f);
      }
      if (
        e.key === "Escape" &&
        (focus || findOpen) &&
        !document.querySelector("dialog[open]")
      ) {
        if (findOpen) setFindOpen(false);
        else setFocus(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveChapter, focus, findOpen, memos.save, notify]);
  const playClick = () => {
    if (!prefs.sound) return;
    try {
      if (!audioCtx.current || audioCtx.current.state === "closed")
        audioCtx.current = new AudioContext();
      const ctx = audioCtx.current;
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(750, ctx.currentTime);
      gain.gain.setValueAtTime(0.025, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.035);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start();
      osc.stop(ctx.currentTime + 0.035);
    } catch {
      /* Sound is optional. */
    }
  };
  const updatePrefs = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(next));
    } catch {
      notify(tr("设置暂未保留，下次打开将使用原设置。"));
    }
  };
  const finishSettings = () => {
    const targetWords = Number(targetInput),
      timerMinutes = Number(timerInput);
    if (prefs.targetMode !== "none" && !inRange(targetWords, 100, 100000)) {
      setSettingsError(tr("目标字数请输入 100–100000 的整数。"));
      return;
    }
    if (!inRange(timerMinutes, 5, 120)) {
      setSettingsError(tr("工作时长请输入 5–120 的整数。"));
      return;
    }
    updatePrefs({
      targetWords:
        prefs.targetMode === "none" ? prefs.targetWords : targetWords,
      timerMinutes,
    });
    setSettingsError("");
    setShowSettings(false);
  };
  const reloadChapter = async () => {
    if (!draft.bookId || !draft.chapterId || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const b = await api<Book>("book:get", { id: draft.bookId });
      const c = b.chapters.find((c) => c.id === draft.chapterId);
      if (!c) throw new Error(tr("章节不存在，草稿仍保留。请另存到其他作品。"));
      const copy = scratch(draft.title, draft.text);
      commit((lib) => ({
        ...lib,
        drafts: {
          ...lib.drafts,
          [copy.key]: copy,
          [draft.key]: chapterDraft(c),
        },
      }));
      persist();
      setSaveError("");
      setShowReload(false);
      notify(tr("已载入作品正文，原草稿保留为临时文稿。"));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const retainNow = () => {
    try {
      persist();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const renameDraft = (key: string, title: string) => {
    const current = libraryRef.current.drafts[key];
    if (!current || current.chapterId) return;
    commit((lib) => ({
      ...lib,
      drafts: {
        ...lib.drafts,
        [key]: { ...current, title, updatedAt: new Date().toISOString() },
      },
    }));
    retainNow();
  };
  const deleteDraft = (key: string) => {
    const current = libraryRef.current.drafts[key];
    if (!current || current.chapterId) return;
    commit((lib) => {
      const drafts = { ...lib.drafts };
      delete drafts[key];
      let activeKey = lib.activeKey;
      if (activeKey === key) {
        const next =
          Object.values(drafts)
            .filter((d) => !d.chapterId)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ||
          scratch();
        drafts[next.key] = next;
        activeKey = next.key;
      }
      return {
        ...lib,
        activeKey,
        drafts,
        trash: {
          ...lib.trash,
          [key]: { ...current, updatedAt: new Date().toISOString() },
        },
      };
    });
    setSaveError("");
    setLastReplacement(null);
    retainNow();
  };
  const restoreDraft = (key: string) => {
    const current = libraryRef.current.trash[key];
    if (!current) return;
    commit((lib) => {
      const trash = { ...lib.trash };
      delete trash[key];
      const restored = lib.drafts[key]
        ? scratch(current.title, current.text)
        : { ...current, updatedAt: new Date().toISOString() };
      return {
        ...lib,
        trash,
        drafts: { ...lib.drafts, [restored.key]: restored },
      };
    });
    retainNow();
  };
  const loadSource = ({
    text,
    title,
    asScratch,
    append,
  }: {
    text: string;
    title: string;
    asScratch: boolean;
    append: boolean;
  }) => {
    const current = libraryRef.current.drafts[libraryRef.current.activeKey];
    if (asScratch) {
      switchDraft(scratch(title, text));
      retainNow();
      return;
    }
    if (!current.chapterId) throw new Error(tr("请先选择要编辑的章节。"));
    const copy =
      current.text || current.title
        ? scratch(
            tr("{0} · 载入前", { 0: current.title || tr("未命名临时稿") }),
            current.text,
          )
        : null;
    commit((lib) => ({
      ...lib,
      drafts: {
        ...lib.drafts,
        ...(copy ? { [copy.key]: copy } : {}),
        [current.key]: {
          ...current,
          text: append
            ? `${current.text}${current.text ? "\n\n" : ""}${text}`
            : text,
          updatedAt: new Date().toISOString(),
        },
      },
    }));
    setLastReplacement(null);
    setMatchIndex(0);
    retainNow();
    notify(tr("已载入草稿，点击保存章节后写入作品；原稿已保留副本。"));
  };
  const revealMatch = (index: number) => {
    const match = matches[index];
    const el = textareaRef.current;
    if (!match || !el) return;
    setMatchIndex(index);
    el.focus();
    el.setSelectionRange(match.start, match.end);
    // Measure wrapped lines with the textarea's own typography to scroll to long-document matches.
    const style = getComputedStyle(el),
      mirror = document.createElement("div");
    Object.assign(mirror.style, {
      position: "fixed",
      visibility: "hidden",
      insetInlineStart: "-10000px",
      top: "0",
      width: `${el.clientWidth}px`,
      boxSizing: "border-box",
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      padding: style.padding,
      font: style.font,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
    });
    mirror.textContent = draft.text.slice(0, match.start);
    const marker = document.createElement("span");
    marker.textContent = draft.text.slice(match.start, match.end) || "\u200b";
    mirror.append(marker);
    document.body.append(mirror);
    el.scrollTop = Math.max(0, marker.offsetTop - el.clientHeight / 3);
    mirror.remove();
  };
  const nextMatch = (direction: number) => {
    if (!matches.length) return;
    const el = textareaRef.current;
    const selected =
      el &&
      matches.findIndex(
        (m) => m.start === el.selectionStart && m.end === el.selectionEnd,
      );
    const index =
      typeof selected === "number" && selected >= 0
        ? (selected + direction + matches.length) % matches.length
        : direction > 0
          ? 0
          : matches.length - 1;
    revealMatch(index);
  };
  const replaceMatch = (all: boolean) => {
    const current = libraryRef.current.drafts[libraryRef.current.activeKey];
    if (!findQuery || !matches.length) return;
    const el = textareaRef.current;
    const selected = el
      ? matches.find(
          (m) => m.start === el.selectionStart && m.end === el.selectionEnd,
        )
      : undefined;
    const match = selected || matches[Math.min(matchIndex, matches.length - 1)];
    const result = all
      ? replaceTextMatches(current.text, findQuery, replaceValue, caseSensitive)
      : {
          text:
            current.text.slice(0, match.start) +
            replaceValue +
            current.text.slice(match.end),
          count: 1,
        };
    if (result.text === current.text) return;
    setLastReplacement({
      key: current.key,
      before: current.text,
      after: result.text,
    });
    edit({ text: result.text });
    setMatchIndex(0);
    notify(tr("已替换 {0} 处，可撤销本次替换。", { 0: result.count }));
  };
  const formatDraft = (rules: ManuscriptFormat = manuscript.format) => {
    const current = libraryRef.current.drafts[libraryRef.current.activeKey];
    const formatted = formatManuscript(current.text, rules);
    if (formatted === current.text) {
      notify(tr("当前段落已符合排版设置。"));
      return;
    }
    const copy = scratch(
      tr("{0} · 排版前", { 0: current.title || tr("未命名临时稿") }),
      current.text,
    );
    commit((lib) => ({ ...lib, drafts: { ...lib.drafts, [copy.key]: copy } }));
    // Persist the recovery copy before adjusting the active manuscript.
    persist();
    edit({ text: formatted });
    setLastReplacement(null);
    retainNow();
    notify(tr("已按排版设置整理正文，原稿保留在临时稿管理中。"));
  };
  const netLabel = (n: number) => `${n >= 0 ? "+" : ""}${number(n)}`;
  const statusText =
    localStatus === "error"
      ? tr("草稿保留失败")
      : localStatus === "pending"
        ? tr("正在保留草稿…")
        : draft.chapterId && !dirty
          ? tr("已保存到作品")
          : tr("草稿已保留在本机");
  const changePanels = (update: PanelState | ((old: PanelState) => PanelState)) => {
    const next = typeof update === "function" ? update(panelsRef.current) : update;
    panelsRef.current = next;
    setPanels(next);
    try { localStorage.setItem(PANEL_KEY, JSON.stringify({ version: 1, ...next })); }
    catch { notify(tr("侧栏状态暂未保存，本次显示不受影响。")); }
  };
  const toggleIdeas = () => changePanels({ ideas: !showIdeas,
    memos: narrowPanels ? false : showMemos, last: "ideas" });
  const toggleMemos = () => changePanels({ memos: !showMemos,
    ideas: narrowPanels ? false : showIdeas, last: "memos" });
  useEffect(() => {
    const resize = () => setNarrowPanels(window.innerWidth < 1200);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  return (
    <div className={`mt-root${focus ? " mt-focus" : ""}`}>
      {!focus && (
        <header className="mt-header">
          <div className="mt-header-left">
            <IconButton
              label={tr("返回书架")}
              disabled={saving || leaving}
              onClick={() => void back()}
            >
              <ArrowLeft size={20} />
            </IconButton>
            <div className="mt-title-area">
              <h1>{tr("人工码字板")}</h1>
              <p>{bookTitle || tr("临时文稿 · 随时落笔")}</p>
            </div>
          </div>
          <div className="mt-header-right">
            <Button
              variant="primary"
              busy={saving}
              onClick={() =>
                draft.chapterId ? void saveChapter() : setShowAttach(true)
              }
            >
              <FloppyDisk size={16} />
              {draft.chapterId ? tr("保存章节") : tr("存入作品")}
            </Button>
          </div>
        </header>
      )}
      {!focus && (
        <div
          className="mt-workbar mt-ribbon"
          role="toolbar"
          aria-label={tr("码字工具栏")}
        >
          <div className="mt-tool-group" role="group" aria-label={tr("文稿")}>
            <div className="mt-tool-buttons">
              <button
                className="mt-chapter-btn"
                disabled={saving}
                onClick={() => setShowPicker(true)}
              >
                <BookOpen size={16} />
                {tr("选择章节")}
              </button>
              <Button disabled={saving} onClick={() => switchDraft(scratch())}>
                <NotePencil size={16} />
                {tr("新建临时稿")}
              </Button>
              <Button disabled={saving} onClick={() => setShowDrafts(true)}>
                <FolderOpen size={16} />
                {tr("临时稿管理")}
              </Button>
              {draft.chapterId && (
                <Button
                  disabled={saving}
                  onClick={() => setShowSources(true)}
                  aria-label={tr("稿件与历史")}
                >
                  <ClockCounterClockwise size={16} />
                  {tr("稿件与历史")}
                  {generatedCount > 0 && (
                    <small className="mt-source-count">{generatedCount}</small>
                  )}
                </Button>
              )}
              <IconButton
                label={tr("导出 TXT")}
                disabled={exporting}
                onClick={() => void exportDraft()}
              >
                <DownloadSimple size={18} />
                <span>{tr("导出 TXT")}</span>
              </IconButton>
            </div>
            <span className="mt-tool-label">{tr("文稿")}</span>
          </div>
          <div className="mt-tool-group" role="group" aria-label={tr("编辑")}>
            <div className="mt-tool-buttons">
              <IconButton
                label={tr("查找替换")}
                aria-pressed={findOpen}
                onClick={() => {
                  setFindOpen(!findOpen);
                  requestAnimationFrame(() =>
                    document.getElementById("mt-find-query")?.focus(),
                  );
                }}
              >
                <MagnifyingGlass size={18} />
                <span>{tr("查找替换")}</span>
              </IconButton>
              <IconButton
                label={tr("一键排版")}
                disabled={!draft.text.trim() || manuscript.loading}
                onClick={() => {
                  try {
                    formatDraft();
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                <TextAlignLeft size={18} />
                <span>{tr("一键排版")}</span>
              </IconButton>
              <Button
                disabled={manuscript.loading}
                onClick={() => setShowManuscriptSettings(true)}
              >
                <TextAa size={18} />
                {tr("正文排版")}
              </Button>
            </div>
            <span className="mt-tool-label">{tr("编辑")}</span>
          </div>
          <div className="mt-tool-group" role="group" aria-label={tr("视图")}>
            <div className="mt-tool-buttons">
              <Button aria-pressed={showIdeas} onClick={toggleIdeas}>
                <Sparkle size={17} />
                {tr("灵感助手")}
              </Button>
              <Button aria-pressed={showMemos} onClick={toggleMemos}>
                <NotePencil size={17} />
                {tr("备忘录")}
              </Button>
              <IconButton
                label={tr("显示设置")}
                onClick={() => setShowDisplaySettings(true)}
              >
                <TextAa size={18} />
                <span>{tr("显示设置")}</span>
              </IconButton>
              <IconButton
                label={theme === "dark" ? tr("浅色模式") : tr("深色模式")}
                onClick={() => setTheme(toggleTheme())}
              >
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                <span>{theme === "dark" ? tr("浅色模式") : tr("深色模式")}</span>
              </IconButton>
            </div>
            <span className="mt-tool-label">{tr("视图")}</span>
          </div>
          <div className="mt-tool-group" role="group" aria-label={tr("专注")}>
            <div className="mt-tool-buttons">
              <div className="mt-pomo-wrap">
                <div className="mt-pomo-readout">
                  <Timer size={17} />
                  <span className="mt-pomo-label">{pomo.display}</span>
                  <span className="mt-pomo-phase">
                  {pomo.phase === "break"
                    ? tr("休息")
                    : pomo.running
                      ? tr("专注中")
                      : pomo.seconds < pomo.total
                        ? tr("已暂停")
                        : tr("待开始")}
                  </span>
                </div>
                <IconButton
                  label={pomo.running ? tr("暂停计时") : tr("开始计时")}
                  onClick={pomo.toggle}
                >
                  {pomo.running ? <Pause size={16} /> : <Play size={16} />}
                  <span>{pomo.running ? tr("暂停计时") : tr("开始计时")}</span>
                </IconButton>
                <IconButton label={tr("重置计时")} onClick={pomo.reset}>
                  <ArrowCounterClockwise size={16} />
                  <span>{tr("重置计时")}</span>
                </IconButton>
              </div>
              <IconButton
                label={tr("目标与设置")}
                onClick={() => {
                  setTargetInput(String(prefs.targetWords));
                  setTimerInput(String(prefs.timerMinutes));
                  setSettingsError("");
                  setShowSettings(true);
                }}
              >
                <Target size={18} />
                <span>{tr("目标与设置")}</span>
              </IconButton>
              <IconButton
                label={prefs.sound ? tr("关闭音效") : tr("开启音效")}
                aria-pressed={prefs.sound}
                onClick={() => updatePrefs({ sound: !prefs.sound })}
              >
                {prefs.sound ? (
                  <SpeakerHigh size={18} />
                ) : (
                  <SpeakerSlash size={18} />
                )}
                <span>{prefs.sound ? tr("关闭音效") : tr("开启音效")}</span>
              </IconButton>
              <IconButton
                label={tr("专注模式 (F11)")}
                onClick={() => setFocus(true)}
              >
                <ArrowsOut size={18} />
                <span>{tr("专注模式")}</span>
              </IconButton>
            </div>
            <span className="mt-tool-label">{tr("专注")}</span>
          </div>
        </div>
      )}
      {focus && (
        <div className="mt-focus-bar">
          <div className="mt-focus-stats">
            <span>
              {number(words)} {tr("字")}
            </span>
            <span>
              {tr("本次净增")} {netLabel(sessionNet)}
            </span>
            {pomo.running && <span>{pomo.display}</span>}
            <span className="mt-save-status" role="status">
              {statusText}
            </span>
          </div>
          <IconButton
            label={tr("退出专注模式 (Esc)")}
            onClick={() => setFocus(false)}
          >
            <ArrowsIn size={18} />
          </IconButton>
        </div>
      )}
      {findOpen && (
        <div
          className="mt-find-panel"
          role="search"
          aria-label={tr("本章查找替换")}
        >
          <div className="mt-find-fields">
            <label>
              {tr("查找")}
              <input
                id="mt-find-query"
                aria-label={tr("查找内容")}
                value={findQuery}
                onChange={(e) => {
                  setFindQuery(e.target.value);
                  setMatchIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    nextMatch(e.shiftKey ? -1 : 1);
                  }
                }}
              />
            </label>
            <label>
              {tr("替换为")}
              <input
                aria-label={tr("替换为")}
                value={replaceValue}
                onChange={(e) => setReplaceValue(e.target.value)}
              />
            </label>
          </div>
          <div className="mt-find-actions">
            <span className="mt-find-result" role="status">
              {tr("{0} 处匹配", { 0: matches.length })}
            </span>
            <IconButton
              label={tr("上一个匹配")}
              disabled={!matches.length}
              onClick={() => nextMatch(-1)}
            >
              <CaretUp size={17} />
            </IconButton>
            <IconButton
              label={tr("下一个匹配")}
              disabled={!matches.length}
              onClick={() => nextMatch(1)}
            >
              <CaretDown size={17} />
            </IconButton>
            <Button
              disabled={!matches.length}
              onClick={() => replaceMatch(false)}
            >
              {tr("替换当前")}
            </Button>
            <Button
              disabled={!matches.length}
              onClick={() => replaceMatch(true)}
            >
              {tr("全部替换")}
            </Button>
            <Button
              disabled={
                !lastReplacement ||
                lastReplacement.key !== draft.key ||
                lastReplacement.after !== draft.text
              }
              onClick={() => {
                if (lastReplacement) {
                  edit({ text: lastReplacement.before });
                  setLastReplacement(null);
                }
              }}
            >
              {tr("撤销替换")}
            </Button>
            <label className="mt-find-case">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => {
                  setCaseSensitive(e.target.checked);
                  setMatchIndex(0);
                }}
              />
              {tr("区分大小写")}
            </label>
            <IconButton
              label={tr("关闭查找替换")}
              onClick={() => setFindOpen(false)}
            >
              <X size={18} />
            </IconButton>
          </div>
        </div>
      )}
      {(localStatus === "error" || saveError) && (
        <div className={`mt-banner mt-save-notice${chapterConflict && localStatus !== "error" ? " is-conflict" : ""}`} role="alert">
          <WarningCircle size={18} />
          <div className="mt-banner-copy">
            <strong>{localStatus === "error"
              ? tr("草稿未能保留")
              : chapterConflict ? tr("章节已有新修改") : tr("暂时无法保存章节")}</strong>
            <p>
              {localStatus === "error"
                ? tr("草稿保留失败，请保存到作品或导出 TXT 后再离开。")
                : chapterConflict ? tr("当前码字稿仍保留，请选择一种方式继续。") : tr(saveError)}
            </p>
          </div>
          <div className="mt-notice-actions">
            <Button variant="primary-soft" disabled={saving} onClick={() => setShowAttach(true)}>
              <NotePencil size={16} />{tr("另存为新章节")}
            </Button>
            {draft.chapterId && (
              <Button disabled={saving} onClick={() => setShowReload(true)}>
                <ArrowClockwise size={16} />{tr("重新载入作品")}
              </Button>
            )}
            <Button busy={exporting} onClick={() => void exportDraft()}>
              <DownloadSimple size={16} />{tr("导出 TXT")}
            </Button>
          </div>
        </div>
      )}
      <div
        className={
          "mt-writing-layout" +
          (!focus && showIdeas ? " has-ideas" : "") +
          (!focus && showMemos ? " has-memos" : "")
        }
      >
        {!focus && showIdeas && (
          <ManualIdeaAssistant
            bookId={memos.bookId || null}
            bookTitle={memos.bookTitle}
            memo={memos.selected}
            notes={memos.notes}
            memoBusy={memos.loading || memos.busy}
            onSelectMemo={memos.selectNote}
            notify={notify}
            closeGuard={ideaCloseGuard}
            onClose={() => changePanels((old) => ({ ideas: false,
              memos: old.memos && (window.innerWidth >= 1200 || !old.ideas || old.last === "memos"), last: old.last }))}
            onSettings={() => {
              void memos
                .save()
                .then(protectDrafts)
                .then(onSettings)
                .catch((e) => notify(e.message));
            }}
            beforeSend={async () => {
              if (memos.loading || memos.busy)
                throw new Error(tr("备忘录正在同步，请稍候再开始构思。"));
              await memos.save();
            }}
            onSaveMemo={async (title, content) => {
              await memos.add(title.slice(0, 160), content);
              changePanels((old) => ({ memos: true, ideas: window.innerWidth < 1200 ? false : old.ideas, last: "memos" }));
            }}
          />
        )}
        <main className="mt-editor-wrap">
          <div className="mt-document-head">
            <input
              className="mt-document-title"
              aria-label={tr("文稿标题")}
              maxLength={120}
              value={draft.title}
              placeholder={tr("给这一章起个名字")}
              onChange={(e) => edit({ title: e.target.value })}
            />
            <p className="mt-document-caption">
              {draft.chapterId
                ? tr("正在编辑作品章节 · Ctrl+S 保存到作品")
                : tr("临时文稿自动保留，可随时存入作品或导出 TXT")}
            </p>
          </div>
          <textarea
            key={draft.key}
            ref={textareaRef}
            aria-label={tr("码字正文")}
            className="mt-textarea"
            style={{
              fontSize: `${prefs.fontSize}px`,
              lineHeight: prefs.lineHeight,
              fontFamily:
                prefs.fontFamily === "serif"
                  ? '"Noto Serif SC", "SimSun", "Songti SC", serif'
                  : "inherit",
            }}
            value={draft.text}
            placeholder={tr("从这里开始，写下你的故事…")}
            onChange={(e) => edit({ text: e.target.value })}
            onKeyDown={(e) => {
              handleManuscriptEnter(e, inputFormat, (text) => edit({ text }));
              if (
                !e.nativeEvent.isComposing &&
                !e.ctrlKey &&
                !e.metaKey &&
                !e.altKey &&
                (e.key.length === 1 || ["Enter", "Backspace"].includes(e.key))
              )
                playClick();
            }}
            onCompositionEnd={playClick}
            autoFocus
            spellCheck={false}
          />
        </main>
        {!focus && showMemos && (
          <ManualMemoPanel
            books={books}
            model={memos}
            onClose={() => changePanels((old) => ({ memos: false,
              ideas: old.ideas && (window.innerWidth >= 1200 || !old.memos || old.last === "ideas"), last: old.last }))}
          />
        )}
      </div>
      {!focus && (
        <footer className="mt-footer">
          <div className="mt-footer-left">
            {localStatus === "saved" ? (
              <CheckCircle size={16} />
            ) : localStatus === "error" ? (
              <WarningCircle size={16} />
            ) : (
              <FloppyDisk size={16} />
            )}
            <span className="mt-save-status" role="status">
              {statusText}
            </span>
            {localStatus === "saved" && (
              <span className="mt-save-time">{localSavedAt}</span>
            )}
          </div>
          <div className="mt-footer-center">
            <span>
              {tr("字数")} <strong>{number(words)}</strong>
            </span>
            <span>
              {tr("本次净增")} <strong>{netLabel(sessionNet)}</strong>
            </span>
          </div>
          <div className="mt-footer-right">
            {prefs.targetMode !== "none" && (
              <div className="mt-goal">
                <div className="mt-goal-copy">
                  <span>
                    {prefs.targetMode === "daily"
                      ? tr("今日净增")
                      : tr("本次目标")}
                  </span>
                  <span>
                    {number(Math.max(0, targetNet))} /{" "}
                    {number(prefs.targetWords)}
                  </span>
                </div>
                <div
                  className="mt-progress-bar-wrap"
                  role="progressbar"
                  aria-label={
                    prefs.targetMode === "daily"
                      ? tr("今日目标")
                      : tr("本次目标")
                  }
                  aria-valuemin={0}
                  aria-valuemax={prefs.targetWords}
                  aria-valuenow={Math.min(
                    prefs.targetWords,
                    Math.max(0, targetNet),
                  )}
                >
                  <div
                    className={`mt-progress-bar${progress >= 1 ? " complete" : ""}`}
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </footer>
      )}
      {showPicker && (
        <ChapterPicker
          books={books}
          draft={draft}
          drafts={Object.values(library.drafts)}
          onSelect={selectChapter}
          onDraftSelect={switchDraft}
          onClose={() => setShowPicker(false)}
        />
      )}
      {showDrafts && (
        <DraftManager
          drafts={Object.values(library.drafts).filter((d) => !d.chapterId)}
          deleted={Object.values(library.trash)}
          activeKey={draft.key}
          onClose={() => setShowDrafts(false)}
          onOpen={(key) => {
            const d = libraryRef.current.drafts[key];
            if (d) switchDraft(d);
          }}
          onCreate={() => switchDraft(scratch())}
          onRename={renameDraft}
          onDelete={deleteDraft}
          onRestore={restoreDraft}
        />
      )}
      {showSources && draft.bookId && draft.chapterId && (
        <ManualSources
          bookId={draft.bookId}
          chapterId={draft.chapterId}
          onClose={() => setShowSources(false)}
          onLoad={loadSource}
        />
      )}
      {confirmClear && (
        <Modal
          title={tr("确认清空章节？")}
          onClose={() => {
            if (!saving) setConfirmClear(false);
          }}
        >
          <div className="modal-body">
            <p>
              {tr(
                "当前草稿为空，但作品中已有正文。确认后才会清空作品正文，原文仍保留在历史版本中。",
              )}
            </p>
          </div>
          <div className="modal-footer">
            <Button disabled={saving} onClick={() => setConfirmClear(false)}>
              {tr("取消")}
            </Button>
            <Button
              variant="danger"
              busy={saving}
              onClick={() => void saveChapter(true)}
            >
              {tr("确认清空并保存")}
            </Button>
          </div>
        </Modal>
      )}
      {showAttach && (
        <AttachDraft
          books={books}
          draft={draft}
          onClose={() => setShowAttach(false)}
          onSaved={(saved) => {
            const next = chapterDraft(saved);
            commit((lib) => {
              const current = lib.drafts[draft.key];
              const drafts = {
                ...lib.drafts,
                [next.key]: {
                  ...next,
                  text: current.text,
                  title:
                    current.title === draft.title ? saved.title : current.title,
                },
              };
              if (!draft.chapterId) delete drafts[draft.key];
              return { ...lib, activeKey: next.key, drafts };
            });
            try {
              persist();
            } catch {
              /* The new chapter is stored in the database. */
            }
            setSaveError("");
            setShowAttach(false);
            notify(tr("已保存到「{0}」", { 0: saved.title }));
          }}
        />
      )}
      {showReload && (
        <Modal
          title={tr("重新载入作品？")}
          onClose={() => {
            if (!saving) setShowReload(false);
          }}
        >
          <div className="modal-body">
            <p>
              {tr(
                "将载入作品中的最新正文。当前内容会保留为一份临时文稿，可在选择章节中找回。",
              )}
            </p>
          </div>
          <div className="modal-footer">
            <Button disabled={saving} onClick={() => setShowReload(false)}>
              {tr("取消")}
            </Button>
            <Button
              variant="primary"
              busy={saving}
              onClick={() => void reloadChapter()}
            >
              {tr("保留副本并载入")}
            </Button>
          </div>
        </Modal>
      )}
      {showManuscriptSettings && (
        <ManuscriptSettings
          value={manuscript.format}
          onSave={async (value) => {
            await manuscript.save(value);
            notify(tr("正文排版设置已保存。"));
          }}
          onClose={() => setShowManuscriptSettings(false)}
          onApply={formatDraft}
          applyDisabled={!draft.text.trim() || saving}
        />
      )}
      {showDisplaySettings && (
        <Modal
          title={tr("显示设置")}
          onClose={() => setShowDisplaySettings(false)}
        >
          <div className="modal-body mt-settings-body">
            <section className="mt-setting-section">
              {" "}
              <div className="mt-setting-row">
                <label htmlFor="mt-font">{tr("正文字号")}</label>
                <select
                  id="mt-font"
                  value={prefs.fontSize}
                  onChange={(e) =>
                    updatePrefs({ fontSize: Number(e.target.value) })
                  }
                >
                  {FONT_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}px
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-setting-row">
                <label htmlFor="mt-font-family">{tr("正文字体")}</label>
                <select
                  id="mt-font-family"
                  value={prefs.fontFamily}
                  onChange={(e) =>
                    updatePrefs({
                      fontFamily: e.target.value as Prefs["fontFamily"],
                    })
                  }
                >
                  <option value="system">{tr("系统字体")}</option>
                  <option value="serif">{tr("宋体")}</option>
                </select>
              </div>
              <div className="mt-setting-row">
                <label htmlFor="mt-line-height">{tr("正文行高")}</label>
                <select
                  id="mt-line-height"
                  value={prefs.lineHeight}
                  onChange={(e) =>
                    updatePrefs({ lineHeight: Number(e.target.value) })
                  }
                >
                  {[1.6, 1.8, 2, 2.2, 2.4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </section>
          </div>
          <div className="modal-footer">
            <Button onClick={() => setShowDisplaySettings(false)}>
              {tr("完成")}
            </Button>
          </div>
        </Modal>
      )}
      {showSettings && (
        <Modal title={tr("码字设置")} onClose={() => setShowSettings(false)}>
          <div className="modal-body mt-settings-body">
            <section className="mt-setting-section">
              <h3>{tr("写作目标")}</h3>
              <div className="mt-radio-group">
                {(["none", "session", "daily"] as TargetMode[]).map((m) => (
                  <label key={m} className="mt-radio-item">
                    <input
                      type="radio"
                      name="targetMode"
                      checked={prefs.targetMode === m}
                      onChange={() => updatePrefs({ targetMode: m })}
                    />
                    {m === "none"
                      ? tr("不设目标")
                      : m === "session"
                        ? tr("本次目标")
                        : tr("今日目标")}
                  </label>
                ))}
              </div>
              {prefs.targetMode !== "none" && (
                <div className="mt-setting-row">
                  <label htmlFor="mt-target">{tr("目标字数")}</label>
                  <input
                    id="mt-target"
                    type="number"
                    min={100}
                    max={100000}
                    step={100}
                    className="mt-number-input"
                    value={targetInput}
                    onChange={(e) => {
                      setTargetInput(e.target.value);
                      setSettingsError("");
                    }}
                  />
                  <span>{tr("字")}</span>
                </div>
              )}
              <p className="mt-setting-hint">
                {tr(
                  "按净增字数计算，载入原文不计入进度。今日目标累计本机码字板的输入，跨章节保留，午夜重新计数。",
                )}
              </p>
            </section>
            <section className="mt-setting-section">
              <h3>{tr("番茄钟")}</h3>
              <div className="mt-setting-row">
                <label htmlFor="mt-timer">{tr("工作时长")}</label>
                <input
                  id="mt-timer"
                  type="number"
                  min={5}
                  max={120}
                  className="mt-number-input"
                  value={timerInput}
                  onChange={(e) => {
                    setTimerInput(e.target.value);
                    setSettingsError("");
                  }}
                />
                <span>{tr("分钟")}</span>
              </div>
              <p className="mt-setting-hint">
                {tr(
                  "每轮结束后提醒休息五分钟。调整时长会重置计时，下一轮由你手动开始。",
                )}
              </p>
            </section>
            <section className="mt-setting-section">
              <h3>{tr("打字音效")}</h3>
              <div className="mt-setting-row">
                <span>{tr("打字音效")}</span>
                <button
                  className={`mt-toggle${prefs.sound ? " mt-toggle-on" : ""}`}
                  onClick={() => updatePrefs({ sound: !prefs.sound })}
                  role="switch"
                  aria-label={tr("打字音效")}
                  aria-checked={prefs.sound}
                >
                  {prefs.sound ? tr("开") : tr("关")}
                </button>
              </div>
            </section>
            {settingsError && (
              <p role="alert" className="mt-form-error">
                {settingsError}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <Button variant="primary" onClick={finishSettings}>
              {tr("完成")}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ChapterPicker({
  books,
  draft,
  drafts,
  onSelect,
  onDraftSelect,
  onClose,
}: {
  books: BookSummary[];
  draft: Draft;
  drafts: Draft[];
  onSelect: (c: Chapter) => void;
  onDraftSelect: (d: Draft) => void;
  onClose: () => void;
}) {
  const activeBooks = books.filter((b) => !b.archived);
  const [bookId, setBookId] = useState(
    draft.bookId || activeBooks[0]?.id || "",
  );
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let cancelled = false;
    setChapters([]);
    setError("");
    if (!bookId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void api<Book>("book:get", { id: bookId })
      .then((b) => {
        if (!cancelled) setChapters(b.archived ? [] : b.chapters);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, attempt]);
  const filtered = chapters.filter((c) =>
    c.title.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()),
  );
  const scratchDrafts = drafts.filter((d) => !d.chapterId);
  const orphanDrafts = drafts.filter(
    (d) =>
      d.chapterId &&
      (!activeBooks.some((b) => b.id === d.bookId) ||
        (!loading &&
          (!!error ||
            (d.bookId === bookId &&
              !chapters.some((c) => c.id === d.chapterId))))),
  );
  return (
    <Modal title={tr("选择章节")} onClose={onClose} wide>
      <div className="modal-body mt-picker-body">
        <div className="mt-picker-books">
          <p className="mt-picker-label">{tr("选择作品")}</p>
          {activeBooks.length === 0 && (
            <p className="mt-picker-empty">
              {tr("暂无作品，可以先写临时稿，再到书架新建作品。")}
            </p>
          )}
          {activeBooks.map((b) => (
            <button
              key={b.id}
              className={`mt-picker-book${bookId === b.id ? " active" : ""}`}
              aria-pressed={bookId === b.id}
              onClick={() => {
                setBookId(b.id);
                setQuery("");
              }}
            >
              <BookOpen size={16} />
              <span>{b.title}</span>
            </button>
          ))}
          {scratchDrafts.length > 0 && (
            <>
              <p className="mt-picker-label">{tr("本机临时稿")}</p>
              {scratchDrafts.map((d) => (
                <button
                  key={d.key}
                  className={`mt-picker-book mt-picker-draft${draft.key === d.key ? " active" : ""}`}
                  onClick={() => onDraftSelect(d)}
                >
                  <NotePencil size={16} />
                  <span>{d.title || tr("未命名临时稿")}</span>
                </button>
              ))}
            </>
          )}
          {orphanDrafts.length > 0 && (
            <>
              <p className="mt-picker-label">{tr("待恢复的章节草稿")}</p>
              {orphanDrafts.map((d) => (
                <button
                  key={d.key}
                  className="mt-picker-book mt-picker-draft"
                  onClick={() => onDraftSelect(d)}
                >
                  <NotePencil size={16} />
                  <span>{d.title || tr("（无标题）")}</span>
                </button>
              ))}
            </>
          )}
        </div>
        <div className="mt-picker-chapters">
          <div className="mt-picker-tools">
            <input
              aria-label={tr("查找章节")}
              placeholder={tr("输入章名查找")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {loading ? (
            <div className="mt-picker-loading" role="status">
              {tr("正在加载章节…")}
            </div>
          ) : error ? (
            <div className="mt-picker-empty" role="alert">
              <p>{tr("章节加载失败：{0}", { 0: error })}</p>
              <Button onClick={() => setAttempt((n) => n + 1)}>
                {tr("重试")}
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="mt-picker-empty">
              {query
                ? tr("没有匹配的章节，试试其他章名。")
                : tr("选一部作品，继续写它的故事。")}
            </p>
          ) : (
            filtered.map((c) => {
              const local = drafts.find(
                (d) => d.chapterId === c.id && changed(d),
              );
              return (
                <button
                  key={c.id}
                  className={`mt-picker-chapter${draft.chapterId === c.id ? " active" : ""}`}
                  onClick={() => onSelect(c)}
                >
                  <span className="mt-picker-order">
                    {chapters.indexOf(c) + 1}
                  </span>
                  <span className="mt-picker-ctitle">
                    {c.title || tr("（无标题）")}
                    {local && (
                      <small className="mt-picker-meta">
                        {tr("有本机草稿")}
                      </small>
                    )}
                  </span>
                  <span className="mt-picker-words">
                    {number(count(local?.text ?? c.body))} {tr("字")}
                  </span>
                </button>
              );
            })
          )}
          <p className="mt-setting-hint">
            {tr("切换时保留当前草稿；有本机草稿的章节会接着上次的内容继续写。")}
          </p>
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>{tr("取消")}</Button>
      </div>
    </Modal>
  );
}

function AttachDraft({
  books,
  draft,
  onSaved,
  onClose,
}: {
  books: BookSummary[];
  draft: Draft;
  onSaved: (c: Chapter) => void;
  onClose: () => void;
}) {
  const activeBooks = books.filter((b) => !b.archived);
  const [bookId, setBookId] = useState(
    activeBooks.find((b) => b.id === draft.bookId)?.id ||
      activeBooks[0]?.id ||
      "",
  );
  const [title, setTitle] = useState(draft.title);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (lock.current) return;
    if (!bookId) {
      setError(tr("请先在书架新建作品，文稿会在本机保留。"));
      return;
    }
    if (!draft.text.trim()) {
      setError(tr("正文为空，请先写下内容再存入作品。"));
      return;
    }
    if (title.trim().length > 120) {
      setError(tr("章节标题最多 120 个字符。"));
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await api<Chapter>("chapter:create-with-body", {
        bookId,
        title: title.trim(),
        body: draft.text,
      });
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title={tr("存入作品")}
      onClose={() => {
        if (!lock.current) onClose();
      }}
    >
      <div className="modal-body mt-attach-body">
        <p className="mt-attach-note">
          {tr("将文稿保存为作品末尾的新章节，已有章节内容会保留。")}
        </p>
        <Field label={tr("保存到作品")}>
          <select
            value={bookId}
            disabled={busy}
            onChange={(e) => setBookId(e.target.value)}
          >
            <option value="">{tr("请选择作品")}</option>
            {activeBooks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr("章节标题")}>
          <input
            value={title}
            maxLength={120}
            disabled={busy}
            placeholder={tr("留空使用默认章名")}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        {!activeBooks.length && (
          <p>{tr("请先在书架新建作品，文稿会在本机保留。")}</p>
        )}
        {error && (
          <p className="mt-form-error" role="alert">
            {tr(error)}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <Button disabled={busy} onClick={onClose}>
          {tr("取消")}
        </Button>
        <Button
          variant="primary"
          busy={busy}
          disabled={!bookId || !draft.text.trim()}
          onClick={() => void save()}
        >
          {tr("新建章节并保存")}
        </Button>
      </div>
    </Modal>
  );
}
