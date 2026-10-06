import { tr } from "./i18n";
import { useState } from "react";
import { api } from "./api";
import { Button, Field, Modal } from "./ui";
import type { Book, Chapter, Foreshadow } from "./types";

export type CanvasSourceRequest = { kind: string; id?: string };

/** Drafts live only while the source editor is open; the canvas never owns content. */
export default function CanvasSourceEditor({
  book,
  request,
  chapterId,
  editBook,
  editChapter,
  flush,
  onChange,
  onClose,
  notify,
}: {
  book: Book;
  request: CanvasSourceRequest;
  chapterId: string;
  editBook: (patch: Partial<Book>) => void;
  editChapter: (id: string, patch: Partial<Chapter>) => void;
  flush: () => Promise<void>;
  onChange: (book: Book) => void;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const volume = book.volumes?.find((v) => v.id === request.id);
  const chapter = book.chapters.find((c) => c.id === request.id);
  const foreshadow = book.foreshadows?.find((f) => f.id === request.id);
  const isVolume =
    request.kind === "volume" || request.kind === "volume-detail";
  const isChapter = request.kind.startsWith("chapter");
  const isForeshadow = request.kind === "foreshadow";
  const isNew = request.kind === "new-structure";
  const textKey =
    request.kind === "world-base"
      ? "world"
      : request.kind === "premise"
        ? "premise"
        : "outline";
  const textLabel =
    textKey === "world"
      ? "世界观与固定规则"
      : textKey === "premise"
        ? "故事简介"
        : "全书总纲";
  const [structure, setStructure] = useState<"volume" | "chapter">("volume");
  const [title, setTitle] = useState(
    volume?.title || chapter?.title || foreshadow?.title || "",
  );
  const [outline, setOutline] = useState(
    volume?.outline || chapter?.outline || "",
  );
  const [detail, setDetail] = useState(volume?.detail || "");
  const [summary, setSummary] = useState(chapter?.summary || "");
  const [volumeId, setVolumeId] = useState(chapter?.volumeId || "");
  const [text, setText] = useState(book[textKey]);
  const [status, setStatus] = useState<Foreshadow["status"]>(
    foreshadow?.status || "open",
  );
  const [note, setNote] = useState(foreshadow?.note || "");
  const [planted, setPlanted] = useState(
    foreshadow?.plantedChapterId || chapterId,
  );
  const [payoff, setPayoff] = useState(foreshadow?.payoffChapterId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const modalTitle = isNew
    ? "添加大纲资料"
    : isVolume
      ? "编辑分卷"
      : isChapter
        ? "编辑章节规划"
        : isForeshadow
          ? foreshadow
            ? "编辑伏笔"
            : "记录伏笔"
          : "编辑原始资料";
  async function save() {
    setBusy(true);
    setError("");
    try {
      if ((isNew || isVolume || isChapter || isForeshadow) && !title.trim())
        throw new Error("请填写资料名称后再保存。");
      if (isForeshadow && title.length > 240)
        throw new Error("伏笔内容最多 240 字，请缩短后再保存。");
      if (
        (isChapter || (isNew && structure === "chapter")) &&
        volumeId &&
        !book.volumes?.some((v) => v.id === volumeId)
      )
        throw new Error("所选分卷已删除，请重新选择后保存。");
      await flush();
      if (isNew || isVolume) {
        if (isNew && structure === "chapter") {
          const created = await api<Chapter>("chapter:create", {
            bookId: book.id,
          });
          await api("chapter:save", {
            id: created.id,
            revision: created.revision,
            patch: { title: title.trim(), outline, summary },
          });
          onChange(
            await api<Book>("chapter:organize", { id: created.id, volumeId }),
          );
        } else {
          if (isVolume && !book.volumes?.some((v) => v.id === request.id))
            throw new Error("这条分卷已删除，请重新打开资料。");
          onChange(
            await api<Book>("volume:save", {
              bookId: book.id,
              volume: {
                id: volume?.id || crypto.randomUUID(),
                title: title.trim(),
                outline,
                detail,
              },
            }),
          );
        }
      } else if (isChapter) {
        if (!chapter) throw new Error("这个章节已删除，请重新打开资料。");
        editChapter(chapter.id, {
          title: title.trim(),
          outline,
          summary,
        });
        await flush();
        if (volumeId !== (chapter.volumeId || ""))
          onChange(
            await api<Book>("chapter:organize", { id: chapter.id, volumeId }),
          );
      } else if (isForeshadow) {
        if (request.id && !foreshadow)
          throw new Error("这条伏笔已删除，请重新打开资料。");
        const next: Foreshadow = {
          id: foreshadow?.id || crypto.randomUUID(),
          title: title.trim(),
          status,
          note,
          plantedChapterId: planted,
          payoffChapterId: status === "resolved" ? payoff : "",
        };
        editBook({
          foreshadows: [
            next,
            ...(book.foreshadows || []).filter((f) => f.id !== next.id),
          ],
        });
        await flush();
      } else {
        editBook({ [textKey]: text });
        await flush();
      }
      notify(tr("资料已保存，常规与画布已同步"));
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const chapterOptions = book.chapters.map((c) => (
    <option key={c.id} value={c.id}>
      {c.title}
    </option>
  ));
  return (
    <Modal title={modalTitle} wide onClose={() => !busy && onClose()}>
      <form
        data-testid="canvas-source-editor"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="modal-body">
          {isNew && (
            <Field label={tr("资料类型")}>
              <select
                value={structure}
                onChange={(e) =>
                  setStructure(e.target.value as "volume" | "chapter")
                }
              >
                <option value="volume">{tr("分卷")}</option>
                <option value="chapter">{tr("章节")}</option>
              </select>
            </Field>
          )}
          {isNew || isVolume || isChapter || isForeshadow ? (
            <>
              <Field
                label={
                  isForeshadow
                    ? tr("伏笔内容")
                    : isChapter || (isNew && structure === "chapter")
                      ? tr("章节名称")
                      : tr("分卷名称")
                }
              >
                <input
                  required
                  maxLength={isForeshadow ? 240 : 120}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              {(isChapter || (isNew && structure === "chapter")) && (
                <>
                  <Field label={tr("所属分卷")}>
                    <select
                      value={volumeId}
                      onChange={(e) => setVolumeId(e.target.value)}
                    >
                      <option value="">{tr("未分卷章节")}</option>
                      {book.volumes?.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={tr("章节概要")}>
                    <textarea
                      rows={4}
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                    />
                  </Field>
                </>
              )}
              {!isForeshadow && (
                <Field
                  label={
                    isChapter || (isNew && structure === "chapter")
                      ? tr("章节细纲")
                      : tr("卷大纲")
                  }
                >
                  <textarea
                    rows={6}
                    value={outline}
                    onChange={(e) => setOutline(e.target.value)}
                  />
                </Field>
              )}
              {(isVolume || (isNew && structure === "volume")) && (
                <Field label={tr("卷细纲")}>
                  <textarea
                    rows={6}
                    value={detail}
                    onChange={(e) => setDetail(e.target.value)}
                  />
                </Field>
              )}
              {isForeshadow && (
                <>
                  <div className="form-row">
                    <Field label={tr("埋下章节")}>
                      <select
                        required
                        value={planted}
                        onChange={(e) => setPlanted(e.target.value)}
                      >
                        <option value="">{tr("选择章节")}</option>
                        {chapterOptions}
                      </select>
                    </Field>
                    <Field label={tr("伏笔状态")}>
                      <select
                        value={status}
                        onChange={(e) =>
                          setStatus(e.target.value as Foreshadow["status"])
                        }
                      >
                        <option value="open">{tr("待回收")}</option>
                        <option value="resolved">{tr("已回收")}</option>
                        <option value="abandoned">{tr("已搁置")}</option>
                      </select>
                    </Field>
                  </div>
                  {status === "resolved" && (
                    <Field label={tr("回收章节")}>
                      <select
                        required
                        value={payoff}
                        onChange={(e) => setPayoff(e.target.value)}
                      >
                        <option value="">{tr("选择章节")}</option>
                        {chapterOptions}
                      </select>
                    </Field>
                  )}
                  <Field label={tr("备注")}>
                    <textarea
                      rows={4}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field>
                </>
              )}
            </>
          ) : (
            <Field label={textLabel}>
              <textarea
                rows={15}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
          )}
          {error && (
            <p role="alert" className="error-box">
              {tr(error)}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <Button type="button" disabled={busy} onClick={onClose}>{tr("取消")}</Button>
          <Button variant="primary" type="submit" busy={busy}>{tr("保存资料")}</Button>
        </div>
      </form>
    </Modal>
  );
}
