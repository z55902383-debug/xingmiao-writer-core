import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { BookSummary, MemoNote } from "./types";

const RECOVERY_KEY = "xm-manual-memo-edit-v1";
type Session = {
  bookId: string;
  notes: MemoNote[];
  selectedId: string;
  selected: MemoNote | null;
  base: MemoNote | null;
};
export type ManualMemoModel = {
  bookId: string;
  bookTitle: string;
  notes: MemoNote[];
  selected: MemoNote | null;
  loading: boolean;
  busy: boolean;
  status: string;
  error: string;
  query: string;
  setQuery: (value: string) => void;
  selectBook: (id: string) => Promise<void>;
  selectNote: (id: string) => Promise<void>;
  edit: (patch: { title?: string; content?: string }) => void;
  create: () => Promise<void>;
  add: (title: string, content: string) => Promise<void>;
  save: () => Promise<void>;
  saveAsNew: () => Promise<void>;
  remove: () => Promise<void>;
  reload: () => Promise<void>;
};
const empty = (bookId = ""): Session => ({
  bookId,
  notes: [],
  selectedId: "",
  selected: null,
  base: null,
});
const changed = (s: Session) =>
  !!s.selected &&
  (!s.base ||
    s.selected.title !== s.base.title ||
    s.selected.content !== s.base.content);

export function useManualMemos(
  books: BookSummary[],
  boundBookId: string | null,
): ManualMemoModel {
  const [session, setSession] = useState<Session>(() =>
    empty(boundBookId || ""),
  );
  const current = useRef(session);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("选择作品后查看备忘录"),
    [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const operation = useRef(false);
  const request = useRef(0);
  const mounted = useRef(true);
  const commit = useCallback((value: Session) => {
    current.current = value;
    if (mounted.current) setSession(value);
  }, []);
  const retain = useCallback(() => {
    const s = current.current;
    if (!changed(s)) return;
    try {
      localStorage.setItem(
        RECOVERY_KEY,
        JSON.stringify({
          bookId: s.bookId,
          selected: s.selected,
          base: s.base,
        }),
      );
    } catch {
      setError("备忘录草稿暂未保留，请保存成功后再离开。");
    }
  }, []);
  const save = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    if (saving.current) {
      await saving.current;
      if (changed(current.current)) await save();
      return;
    }
    if (!changed(current.current)) return;
    const task = (async () => {
      setStatus("正在保存备忘录…");
      const s = current.current;
      const selected = s.selected!;
      const saved = await api<MemoNote>("memo:save", {
        bookId: s.bookId,
        id: selected.id,
        title: selected.title,
        content: selected.content,
        baseUpdatedAt: s.base?.updatedAt ?? null,
      });
      const live = current.current;
      if (live.bookId === s.bookId && live.selectedId === selected.id) {
        const newer = live.selected!;
        const next =
          newer.title === selected.title && newer.content === selected.content
            ? saved
            : { ...newer, updatedAt: saved.updatedAt };
        commit({
          ...live,
          notes: live.notes.map((memo) => (memo.id === saved.id ? next : memo)),
          selected: next,
          base: saved,
        });
        if (changed(current.current)) {
          setStatus("待保存备忘录");
          retain();
        } else {
          try {
            const recovery = JSON.parse(
              localStorage.getItem(RECOVERY_KEY) || "null",
            );
            if (
              recovery?.bookId === s.bookId &&
              recovery?.selected?.id === selected.id
            )
              localStorage.removeItem(RECOVERY_KEY);
          } catch {
            /* Database save is authoritative. */
          }
          setStatus("备忘录已同步到作品");
        }
      }
      setError("");
    })();
    saving.current = task;
    try {
      await task;
    } catch (e) {
      retain();
      setStatus("备忘录保存失败");
      setError((e as Error).message);
      throw e;
    } finally {
      saving.current = null;
    }
    if (changed(current.current)) await save();
  }, [commit, retain]);
  const fetchNotes = useCallback(
    async (bookId: string, selectedId = "", preserve = false) => {
      if (preserve && saving.current) await saving.current.catch(() => {});
      const token = ++request.current;
      if (!bookId) {
        commit(empty());
        setStatus("选择作品后查看备忘录");
        return;
      }
      setLoading(true);
      try {
        const notes = await api<MemoNote[]>("memo:list", { bookId });
        if (token !== request.current || !mounted.current) return;
        const live = current.current;
        const selected =
          notes.find((note) => note.id === selectedId) || notes[0] || null;
        if (preserve && live.bookId === bookId && changed(live)) {
          const remote = notes.find((note) => note.id === live.selectedId);
          // Another memo's legacy array save may update timestamps. Rebase only
          // when the current memo's authored title and content are still identical.
          const sameBase =
            remote &&
            live.base &&
            remote.title === live.base.title &&
            remote.content === live.base.content;
          commit({
            ...live,
            notes: notes.map((note) =>
              note.id === live.selectedId ? live.selected! : note,
            ),
            base: sameBase ? remote : live.base,
          });
          if (sameBase) {
            setError("");
            setStatus("待保存备忘录");
          }
          if (!sameBase) {
            setError(
              "这条备忘录已在其他地方修改，当前编辑仍保留。请刷新核对后再保存。",
            );
            setStatus("备忘录需要核对");
          }
        } else {
          let next: Session = {
            bookId,
            notes,
            selectedId: selected?.id || "",
            selected,
            base: selected,
          };
          try {
            const recovery = JSON.parse(
              localStorage.getItem(RECOVERY_KEY) || "null",
            );
            if (
              recovery?.bookId === bookId &&
              typeof recovery.selected?.id === "string" &&
              typeof recovery.selected?.title === "string" &&
              typeof recovery.selected?.content === "string"
            ) {
              const remote = notes.find(
                (note) => note.id === recovery.selected.id,
              );
              next = {
                bookId,
                notes: notes.map((note) =>
                  note.id === recovery.selected.id ? recovery.selected : note,
                ),
                selectedId: recovery.selected.id,
                selected: recovery.selected,
                base: recovery.base || null,
              };
              if (!remote) next.notes = [recovery.selected, ...notes];
              setStatus("已恢复未保存的备忘录草稿");
            } else {
              setStatus("备忘录已同步到作品");
              setError("");
            }
          } catch {
            setStatus("备忘录已同步到作品");
          }
          commit(next);
        }
      } catch (e) {
        if (token === request.current) setError((e as Error).message);
        throw e;
      } finally {
        if (token === request.current) setLoading(false);
      }
    },
    [commit],
  );
  const selectBook = useCallback(
    async (bookId: string) => {
      if (
        operation.current ||
        (bookId === current.current.bookId && current.current.notes.length)
      )
        return;
      operation.current = true;
      setBusy(true);
      try {
        await save();
        await fetchNotes(bookId);
        setQuery("");
      } finally {
        operation.current = false;
        setBusy(false);
      }
    },
    [save, fetchNotes],
  );
  const selectNote = async (noteId: string) => {
    if (operation.current) throw new Error("正在保存备忘录，请稍候。");
    operation.current = true;
    setBusy(true);
    try {
      await save();
      const s = current.current,
        next = s.notes.find((memo) => memo.id === noteId);
      if (!next) throw new Error("所选备忘录已不存在，请重新选择");
      commit({ ...s, selectedId: next.id, selected: next, base: next });
      setError("");
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const edit = (patch: { title?: string; content?: string }) => {
    const s = current.current;
    if (!s.selected) return;
    const selected = { ...s.selected, ...patch };
    commit({
      ...s,
      selected,
      notes: s.notes.map((memo) => (memo.id === selected.id ? selected : memo)),
    });
    setStatus("待保存备忘录");
    retain();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save().catch(() => {}), 650);
  };
  const add = async (title: string, content: string) => {
    if (operation.current) throw new Error("正在保存备忘录，请稍候。");
    operation.current = true;
    setBusy(true);
    try {
      await save();
      const s = current.current;
      if (!s.bookId) throw new Error("请先选择作品，再保存备忘录。");
      const note = await api<MemoNote>("memo:save", {
        bookId: s.bookId,
        id: crypto.randomUUID(),
        title,
        content,
        baseUpdatedAt: null,
      });
      commit({
        ...s,
        selected: note,
        selectedId: note.id,
        base: note,
        notes: [note, ...s.notes],
      });
      setStatus("备忘录已同步到作品");
      setError("");
      setQuery("");
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const remove = async () => {
    if (operation.current || !current.current.selected) return;
    operation.current = true;
    setBusy(true);
    try {
      // Save current edits before deletion so a failure leaves their recovery copy.
      await save();
      const s = current.current;
      await api("memo:delete", {
        bookId: s.bookId,
        id: s.selected!.id,
        baseUpdatedAt: s.base?.updatedAt,
      });
      const notes = s.notes.filter((note) => note.id !== s.selectedId),
        selected = notes[0] || null;
      commit({
        ...s,
        notes,
        selected,
        selectedId: selected?.id || "",
        base: selected,
      });
      setError("");
      setStatus("备忘录已删除");
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const saveAsNew = async () => {
    if (operation.current || !current.current.selected) return;
    operation.current = true;
    setBusy(true);
    try {
      if (saving.current) await saving.current.catch(() => {});
      if (timer.current) clearTimeout(timer.current);
      const s = current.current;
      const note = await api<MemoNote>("memo:save", {
        bookId: s.bookId,
        id: crypto.randomUUID(),
        title: s.selected!.title,
        content: s.selected!.content,
        baseUpdatedAt: null,
      });
      const notes = await api<MemoNote[]>("memo:list", { bookId: s.bookId });
      commit({ ...s, notes, selected: note, selectedId: note.id, base: note });
      try {
        localStorage.removeItem(RECOVERY_KEY);
      } catch {
        /* The new memo is saved. */
      }
      setStatus("已另存为新备忘录");
      setError("");
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const reload = async () => {
    await fetchNotes(current.current.bookId, current.current.selectedId, true);
  };
  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const followChapter = () => {
      if (cancelled || !boundBookId) return;
      if (operation.current) { retry = setTimeout(followChapter, 100); return; }
      void selectBook(boundBookId).catch(() => {});
    };
    followChapter();
    return () => { cancelled = true; if (retry) clearTimeout(retry); };
  }, [boundBookId, selectBook]);
  useEffect(() => {
    const refresh = () => {
      const s = current.current;
      if (s.bookId)
        void fetchNotes(s.bookId, s.selectedId, true).catch(() => {});
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [fetchNotes]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      retain();
    };
  }, [retain]);
  return {
    bookId: session.bookId,
    bookTitle: books.find((book) => book.id === session.bookId)?.title || "",
    notes: session.notes,
    selected: session.selected,
    loading,
    busy,
    status,
    error,
    query,
    setQuery,
    selectBook,
    selectNote,
    edit,
    create: () => add("新备忘录", ""),
    add,
    save,
    saveAsNew,
    remove,
    reload,
  };
}
