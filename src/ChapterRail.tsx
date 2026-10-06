import { tr } from "./i18n";
import { useEffect, useRef } from "react";
import type { Book } from "./types";
export default function ChapterRail({
  book,
  value,
  onChange,
}: {
  book: Book;
  value: string;
  onChange: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    host.current
      ?.querySelector('[aria-current="step"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [value]);
  const items = [{ id: "", title: "故事开始前" }, ...book.chapters];
  const index = items.findIndex((c) => c.id === value);
  return (
    <div className="chapter-scrubber">
      <div className="scrubber-head">
        <b>{tr("剧情时间轴")}</b>
        <span>{tr("按章节推进 · 点击节点回看")}</span>
        <button
          disabled={index <= 0}
          aria-label={tr("上一时间点")}
          onClick={() => onChange(items[index - 1].id)}
        >
          ←
        </button>
        <button
          disabled={index >= items.length - 1}
          aria-label={tr("下一时间点")}
          onClick={() => onChange(items[index + 1].id)}
        >
          →
        </button>
      </div>
      <div
        className="chapter-rail"
        ref={host}
        role="navigation"
        aria-label={tr("剧情时间点")}
      >
        {items.map((c, i) => (
          <button
            key={c.id}
            aria-current={c.id === value ? "step" : undefined}
            onClick={() => onChange(c.id)}
          >
            <span className="rail-dot" />
            <small>{i === 0 ? tr("起点") : String(i).padStart(2, "0")}</small>
            <b>{c.title}</b>
            <em>
              {(book.timeline || []).filter((e) => e.chapterId === c.id).length}{" "}{tr("次变化")}</em>
          </button>
        ))}
      </div>
    </div>
  );
}
