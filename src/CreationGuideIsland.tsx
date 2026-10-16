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
import {chapterBatch} from '../electron/chapter-batches.mjs';

const COLLAPSED_KEY = "xm-creation-guide-collapsed";

type GuideStep = {
  id: "style" | "imitation" | "premise" | "outline" | "chapters" | "volumePlans" | "chapterPlans" | "draft" | "complete";
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
  onNavigate: (step: GuideStep["id"], intent: "view" | "continue") => void;
}) {
  const [open, setOpen] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "0");
  const steps = useMemo<GuideStep[]>(() => [
    ...(book.imitationProfiles?.length ? [{ id: 'imitation', title: '配置仿写对标', detail: '上传原文、分析故事对标并采用，选择参考与占比', done: (book.imitationSelection?.ids || []).some(id => (book.imitationSelection?.weights[id] || 0) > 0 && !!book.imitationProfiles?.find(row => row.id === id)?.body.trim()), icon: Sparkle }] : []),
    { id: "premise", title: "写下故事方向", detail: "用几句话说清主角、目标和难题", done: !!book.premise.trim(), icon: FileText },
    { id: "outline", title: "整理全书总纲", detail: "先确定故事从哪里开始、走向哪里", done: !!book.outline.trim(), icon: ListBullets },
    { id: "chapters", title: "生成分卷规划", detail: "采用后创建对应分卷与名称", done: (book.volumes || []).length > 0, icon: BookOpen },
    { id: "volumePlans", title: "完善卷大纲与细纲", detail: "明确每卷目标、事件与转折", done: !!book.volumes?.length && book.volumes.every(v => !!v.outline.trim() && !!v.detail.trim()), icon: ListBullets },
    { id: "chapterPlans", title: "拆出章节大纲与细纲", detail: "采用后同步章名、归卷与章节规划", done: !!book.volumes?.length && book.volumes.every(v => book.chapters.some(c => c.volumeId === v.id) && (!chapterBatch(book,v.id) || chapterBatch(book,v.id)?.complete)) && !!book.chapters.length && book.chapters.every(c => !!c.summary?.trim() && !!c.outline.trim()), icon: ListBullets },
    { id: "draft", title: "逐章生成与采用正文", detail: "按章细纲写作，核对后写入对应章节", done: !!book.chapters.length && book.chapters.every(c => !!c.body.trim()), icon: BookOpen },
    { id: "complete", title: "确认作品完结", detail: "各章定稿后由作者确认；导出和备份分别操作", done: !!book.completedAt, icon: CheckCircle },
  ].filter(step => book.creationMode !== 'short' || !['chapters', 'volumePlans'].includes(step.id)).map(step => book.creationMode === 'short' && step.id === 'chapterPlans' ? { ...step, title: '拆出短篇章节', detail: '由故事简纲生成章概要与细纲，无需分卷', done: !!book.chapters.length && book.chapters.every(c => !!c.summary?.trim() && !!c.outline.trim()) } : step) as GuideStep[], [book]);
  const completed = steps.filter((step) => step.done).length;
  const nextIndex = steps.findIndex((step) => !step.done);
  const nextStep = nextIndex < 0 ? null : steps[nextIndex];

  const toggle = (next: boolean) => {
    setOpen(next);
    localStorage.setItem(COLLAPSED_KEY, next ? "0" : "1");
  };
  const navigate = (step: GuideStep['id'], intent: 'view' | 'continue' = 'view') => { toggle(false); onNavigate(step, intent); };

  return (
    <div className={`creation-island ${open ? "is-open" : ""}`}>
      <button
        key={`${book.id}:${nextStep?.id || 'done'}`}
        className="creation-island-pill"
        data-step={nextStep?.id || 'done'}
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
              <span className="creation-guide-eyebrow">{tr("从想法到全书完成")}</span>
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
                  <button key={`${step.id}:${current}`} aria-current={current ? 'step' : undefined} onClick={() => navigate(step.id, step.done ? 'view' : 'continue')} aria-label={`${tr(step.done ? "查看" : "前往")} ${tr(step.title)}`}>
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
            {nextStep && <button onClick={() => navigate(nextStep.id, 'continue')}>{tr("继续这一步")}{" "}<ArrowRight size={14} /></button>}
          </footer>
        </section>
      )}
    </div>
  );
}
