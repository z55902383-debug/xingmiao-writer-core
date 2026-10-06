import { tr, useLanguage } from "./i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { Cat, CircleNotch, WarningCircle, X } from "@phosphor-icons/react";
import { api } from "./api";
import type { Book, BookSummary, Chapter, Config } from "./types";
import Shelf, { NewBook } from "./Shelf";
import Settings from "./Settings";
import Workspace from "./Workspace";

import { Button, IconButton, Modal } from "./ui";
import { demo } from "./demo";
export default function App() {
  useLanguage();
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [newBook, setNewBook] = useState(false);
  const [settings, setSettings] = useState(false);
  const settingsReturnAction = useRef<(() => void) | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [deleting, setDeleting] = useState<BookSummary | null>(null);
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const [preferredChapterId, setPreferredChapterId] = useState("");
  const [archive, setArchive] = useState<BookSummary | null>(null);
  const closeGuard = useRef<() => Promise<void>>(async () => {});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openSettings = useCallback((afterClose?: () => void) => {
    settingsReturnAction.current = afterClose || null;
    setSettings(true);
  }, []);
  const closeSettings = useCallback(() => {
    setSettings(false);
    setConfig((c) => (c ? { ...c } : c));
    const resume = settingsReturnAction.current;
    settingsReturnAction.current = null;
    if (resume) window.setTimeout(resume, 0);
  }, []);
  const notify = useCallback((message: string) => {
    setToast(tr(message));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6500);
  }, []);
  async function init() {
    setLoading(true);
    setError("");
    try {
      const [b, c] = await Promise.all([
        api<BookSummary[]>("books:list"),
        api<Config>("config:get"),
      ]);
      setBooks(b);
      setConfig(c);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void init();
  }, []);
  useEffect(
    () =>
      window.xingmiao?.onClose(() => {
        closeGuard
          .current()
          .then(() => api("app:close"))
          .catch((e) =>
            notify(tr("关闭前保存失败：{0}。软件保持打开，请重试保存。", {0: e.message})));
      }),
    [notify]);
  async function back() {
    await closeGuard.current();
    setBooks(await api<BookSummary[]>("books:list"));
    setBook(null);
  }
  async function safe(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create(value: {
    title: string;
    genre: string;
    premise: string;
    target: number;
  }) {
    const b = await api<Book>("book:create", value);
    setNewBook(false);
    setBook(b);
  }
  async function loadDemo() {
    await safe(async () => {
      let b = await api<Book>("book:create", {
        title: demo.title,
        genre: demo.genre,
        premise: demo.premise,
        target: demo.target,
      });
      b = await api<Book>("book:update", {
        id: b.id,
        patch: {
          outline: demo.outline,
          world: demo.world,
          style: demo.style,
          characters: demo.characters.map((c) => ({
            ...c,
            id: crypto.randomUUID(),
          })),
        },
      });
      let c = await api<Chapter>("chapter:save", {
        id: b.chapters[0].id,
        revision: b.chapters[0].revision,
        patch: {
          title: demo.chapterTitle,
          body: demo.body,
          outline: demo.chapterOutline,
        },
      });
      c = await api<Chapter>("chapter:finalize", {
        id: c.id,
        revision: c.revision,
      });
      b = await api<Book>("memory:add", {
        bookId: b.id,
        memory: {
          subject: "陈默",
          relation: "将铜钥匙交给",
          object: "林晚保管",
          sourceChapterId: c.id,
          evidence: "陈默将铜钥匙交给林晚保管。",
        },
      });
      setBook(b);
      notify(tr("已创建独立示例作品，可以自由编辑体验"));
    });
  }
  if (loading)
    return (
      <div className="boot-screen">
        <img className="cat-avatar" src="./cat-avatar.png" alt={tr("星喵头像")} />
        <h1>{tr("星喵写作")}</h1>
        <p>
          <CircleNotch size={16} className="spin" />{tr("正在打开创作空间")}</p>
      </div>
    );
  if (error)
    return (
      <div className="boot-screen">
        <WarningCircle size={42} />
        <h1>{tr("暂时无法打开")}</h1>
        <p>{tr(error)}</p>
        <Button onClick={init}>{tr("重试")}</Button>
      </div>
    );
  return (
    <>
      {book && config ? (
        <Workspace
          key={`${book.id}-${workspaceKey}`}
          initial={book}
          preferredChapterId={preferredChapterId}
          config={config}
          onConfigSaved={setConfig}
          onBack={back}
          onSettings={() =>
            safe(async () => {
              await closeGuard.current();
            openSettings();
            })
          }
          notify={notify}
          closeGuard={closeGuard}
        />
      ) : (
        <Shelf
          books={books}
          onNew={() => setNewBook(true)}
          onOpen={(id, chapterId) =>
            safe(async () => {
              setPreferredChapterId(chapterId || "");
              setBook(await api<Book>("book:get", { id }));
            })
          }
          onDemo={loadDemo}
          onArchive={setArchive}
          onDelete={setDeleting}
          onSettings={() =>
            safe(async () => {
              await closeGuard.current();
            openSettings();
            })
          }
          
          onBackup={() =>
            safe(async () => {
              const path = await api<string | null>("backup:save");
              if (path) notify(tr("完整作品备份已保存：{0}", {0: path}));
            })
          }
          onRestore={() =>
            safe(async () => {
              const n = await api<number | null>("backup:restore");
              if (n !== null) {
                setBooks(await api<BookSummary[]>("books:list"));
                notify(tr("已恢复 {0} 部作品，作为新副本保存", {0: n}));
              }
            })
          }
          busy={busy}
        />
      )}
      {newBook && (
        <NewBook onClose={() => setNewBook(false)} onCreate={create} />
      )}
      {settings && config && (
        <Settings
          
          config={config}
          onClose={closeSettings}
          onSaved={setConfig}
          onDataChanged={async () => {
            setBooks(await api<BookSummary[]>("books:list"));
            if (book) {
              setBook(await api<Book>("book:get", { id: book.id }));
              setWorkspaceKey((k) => k + 1);
            }
          }}
        />
      )}
      {deleting && (
        <Modal title={tr("删除作品？")} onClose={() => setDeleting(null)}>
          <div className="modal-body">
            <p>
              「{deleting.title}{tr("」及其章节将移入回收站，可在设置的数据页恢复。")}</p>
          </div>
          <div className="modal-footer">
            <Button onClick={() => setDeleting(null)}>{tr("取消")}</Button>
            <Button
              disabled={busy}
              variant="danger"
              onClick={() =>
                safe(async () => {
                  await api("book:delete", { id: deleting.id });
                  setDeleting(null);
                  setBooks(await api<BookSummary[]>("books:list"));
                  notify(tr("作品已移入回收站"));
                })
              }
            >{tr("移入回收站")}</Button>
          </div>
        </Modal>
      )}
      {archive && (
        <Modal
          title={archive.archived ? tr("恢复这部作品？") : tr("将作品归档？")}
          onClose={() => setArchive(null)}
        >
          <div className="modal-body">
            <p>
              {archive.archived
                ? tr("作品将重新显示在我的书架中。")
                : tr("作品会移入“已归档”，所有章节和资料都保留，随时可以恢复。")}
            </p>
            <b>{archive.title}</b>
          </div>
          <div className="modal-footer">
            <Button onClick={() => setArchive(null)}>{tr("取消")}</Button>
            <Button
              variant="primary"
              onClick={() => {
                const b = archive;
                setArchive(null);
                safe(async () => {
                  await api("book:update", {
                    id: b.id,
                    patch: { archived: !b.archived },
                  });
                  setBooks(await api<BookSummary[]>("books:list"));
                });
              }}
            >{tr("确认")}</Button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <IconButton label={tr("关闭提示")} onClick={() => setToast("")}>
            <X size={15} />
          </IconButton>
        </div>
      )}
    </>
  );
}
