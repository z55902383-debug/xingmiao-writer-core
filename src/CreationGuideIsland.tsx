import { tr } from "./i18n";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle,
  CaretDown,
  FileText,
  GlobeHemisphereWest,
  ListBullets,
  Sparkle,
  Users,
  X,
} from "@phosphor-icons/react";
import type { Book } from "./types";

const COLLAPSED_KEY = "xm-creation-guide-collapsed";

type GuideStep = {
  id: "premise" | "outline" | "chapters" | "characters" | "world" | "draft" | "memory";
  title: string;
  detail: string;
  done: boolean;
  icon: typeof FileText;
};

export default function CreationGuideIsland({
  book,
  onNavigate,
}: {
  book: Book;
  onNavigate: (step: GuideStep["id"]) => void;
}) {
  const [open, setOpen] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "0");
  const steps = useMemo<GuideStep[]>(() => [
    { id: "premise", title: "写下故事方向", detail: "用几句话说清主角、目标和难题", done: !!book.premise.trim(), icon: FileText },
    { id: "outline", title: "整理全书总纲", detail: "先确定故事从哪里开始、走向哪里", done: !!book.outline.trim(), icon: ListBullets },
    { id: "chapters", title: "规划分卷与章节", detail: "拆成可继续创作的章节安排", done: (book.volumes || []).length > 0 || book.chapters.some((c) => !!(c.summary || c.outline).trim()), icon: BookOpen },
    { id: "characters", title: "建立核心人物", detail: "补充身份、动机和人物关系", done: book.characters.length > 0, icon: Users },
    { id: "world", title: "补充世界设定", detail: "记录地点、阵营和故事规则", done: !!book.world.trim(), icon: GlobeHemisphereWest },
    { id: "draft", title: "写下第一章", detail: "进入正文，写出故事的开场", done: book.chapters.some((c) => !!c.body.trim()), icon: BookOpen },
    { id: "memory", title: "确认故事记忆", detail: "从定稿章节提取并确认关键事实", done: book.memories.some((m) => !m.stale), icon: CheckCircle },
  ], [book]);
  const completed = steps.filter((step) => step.done).length;
  const nextIndex = steps.findIndex((step) => !step.done);
  const nextStep = nextIndex < 0 ? null : steps[nextIndex];

  const toggle = (next: boolean) => {
    setOpen(next);
    localStorage.setItem(COLLAPSED_KEY, next ? "0" : "1");
  };

  return (
    <div className={`creation-island ${open ? "is-open" : ""}`}>
      <button
        className="creation-island-pill"
        aria-expanded={open}
        aria-controls="creation-guide-panel"
        onClick={() => toggle(!open)}
      >
        <span className="creation-island-mark"><Sparkle size={15} weight="fill" /></span>
        <span className="creation-island-label">{tr("新手创作步骤")}</span>
        <span className="creation-island-progress">{completed}<i>/</i>{steps.length}</span>
        <span className="creation-island-track"><i style={{ width: `${(completed / steps.length) * 100}%` }} /></span>
        <CaretDown size={13} className="creation-island-chevron" />
      </button>

      {open && (
        <section className="creation-guide-panel" id="creation-guide-panel" aria-label={tr("新手创作步骤")}>
          <header className="creation-guide-heading">
            <div>
              <span className="creation-guide-eyebrow">{tr("从灵感到第一章")}</span>
              <h2>{tr("一步步搭起你的故事")}</h2>
              <p>{tr("完成任意一步后，这里的进度会自动更新。顺序可以按你的习惯调整。")}</p>
            </div>
            <button className="creation-guide-close" aria-label={tr("收起新手步骤")} onClick={() => toggle(false)}><X size={16} /></button>
          </header>

          <div className="creation-guide-progress-line">
            <span><b>{completed}</b> / {steps.length}{" "}{tr("步已完成")}</span>
            <div className="creation-guide-meter"><i style={{ width: `${(completed / steps.length) * 100}%` }} /></div>
          </div>

          <ol className="creation-guide-steps">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const current = !step.done && index === nextIndex;
              return (
                <li key={step.id} className={`${step.done ? "is-done" : ""} ${current ? "is-current" : ""}`}>
                  <button onClick={() => onNavigate(step.id)} aria-label={`${tr(step.done ? "查看" : "前往")} ${tr(step.title)}`}>
                    <span className="creation-guide-status">{step.done ? <CheckCircle size={19} weight="fill" /> : <Icon size={17} />}</span>
                    <span className="creation-guide-copy">
                      <strong>{tr(step.title)}</strong>
                      <small>{tr(step.detail)}</small>
                    </span>
                    <span className="creation-guide-step-state">{step.done ? tr("已完成") : current ? tr("下一步") : tr("待完成")}</span>
                    <ArrowRight className="creation-guide-arrow" size={15} />
                  </button>
                </li>
              );
            })}
          </ol>

          <footer className="creation-guide-footer">
            <span>{nextStep ? tr("建议先完成：{0}", {0: tr(nextStep.title)}) : tr("基础创作步骤已完成，可以继续完善作品")}</span>
            {nextStep && <button onClick={() => onNavigate(nextStep.id)}>{tr("继续这一步")}{" "}<ArrowRight size={14} /></button>}
          </footer>
        </section>
      )}
    </div>
  );
}
