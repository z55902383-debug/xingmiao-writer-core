import { useRef, useState } from "react";
import { api } from "./api";
import type { Book, Chapter } from "./types";
export function useWorkspace(initial: Book, onError: (s: string) => void) {
  const [book, setBook] = useState(initial);
  const current = useRef(initial);
  const [saveState, setSaveState] = useState("已保存");
  const pending = useRef(new Map<string, Partial<Chapter>>());
  const bookPatch = useRef<Partial<Book>>({});
  const promise = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function mutate(fn: (b: Book) => Book) {
    current.current = fn(current.current);
    setBook(current.current);
  }
  async function flush(): Promise<void> {
    if (timer.current) clearTimeout(timer.current);
    if (promise.current) {
      await promise.current;
      if (pending.current.size || Object.keys(bookPatch.current).length)
        await flush();
      return;
    }
    if (!pending.current.size && !Object.keys(bookPatch.current).length) return;
    setSaveState("正在保存");
    const task = (async () => {
      while (pending.current.size || Object.keys(bookPatch.current).length) {
        if (Object.keys(bookPatch.current).length) {
          const patch = bookPatch.current;
          bookPatch.current = {};
          try {
            await api("book:update", { id: current.current.id, patch });
          } catch (e) {
            bookPatch.current = { ...patch, ...bookPatch.current };
            throw e;
          }
        }
        const entry = pending.current.entries().next().value;
        if (entry) {
          const [chapterId, patch] = entry;
          pending.current.delete(chapterId);
          const chapter = current.current.chapters.find(
            (c) => c.id === chapterId,
          )!;
          try {
            const saved = await api<Chapter>("chapter:save", {
              id: chapterId,
              patch,
              revision: chapter.revision,
            });
            mutate((b) => ({
              ...b,
              chapters: b.chapters.map((c) =>
                c.id === chapterId
                  ? {
                      ...c,
                      revision: saved.revision,
                      updatedAt: saved.updatedAt,
                      status: pending.current.has(chapterId)
                        ? "draft"
                        : saved.status,
                    }
                  : c,
              ),
            }));
          } catch (e) {
            pending.current.set(chapterId, {
              ...patch,
              ...pending.current.get(chapterId),
            });
            throw e;
          }
        }
      }
      setSaveState("已保存");
    })();
    promise.current = task;
    try {
      await task;
    } catch (e) {
      setSaveState("保存失败");
      throw e;
    } finally {
      promise.current = null;
    }
  }
  function schedule() {
    setSaveState("待保存");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => flush().catch((e) => onError(e.message)),
      650,
    );
  }
  function editChapter(chapterId: string, patch: Partial<Chapter>) {
    pending.current.set(chapterId, {
      ...pending.current.get(chapterId),
      ...patch,
    });
    mutate((b) => {
      const source = b.chapters.find((c) => c.id === chapterId)!;
      return {
        ...b,
        chapters: b.chapters.map((c) =>
          c.id === chapterId ? { ...c, ...patch, status: "draft" } : c,
        ),
        memories: b.memories.map((m) =>
          m.sourceChapterId &&
          (b.chapters.find((c) => c.id === m.sourceChapterId)?.order || 0) >=
            source.order
            ? { ...m, stale: true }
            : m,
        ),
      };
    });
    schedule();
  }
  function editBook(patch: Partial<Book>) {
    bookPatch.current = { ...bookPatch.current, ...patch };
    mutate((b) => ({ ...b, ...patch }));
    schedule();
  }
  function replace(remote: Book) {
    mutate(() => ({
      ...remote,
      ...bookPatch.current,
      chapters: remote.chapters.map((c) => ({
        ...c,
        ...pending.current.get(c.id),
      })),
    }));
  }
  async function reload() {
    const remote = await api<Book>("book:get", { id: current.current.id });
    replace(remote);
  }
  return {
    book,
    current,
    saveState,
    mutate,
    editBook,
    editChapter,
    flush,
    reload,
    replace,
  };
}
