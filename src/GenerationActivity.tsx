import { useEffect, useState } from "react";
import { CircleNotch, CheckCircle, WarningCircle, ArrowDown, Stop } from "@phosphor-icons/react";
import { tr } from "./i18n";
import { Button } from "./ui";
import type { Job } from "./types";
import "./generation-activity.css";

export type GenerationStart = { startedAt: number; label: string };

// The model provides no total length or completion percentage. Show actual phases and received text.
export default function GenerationActivity({ job, preparing, label, onView, onStop }: {
  job?: Job; preparing: GenerationStart | null; label: string;
  onView: () => void; onStop: () => void;
}) {
  const active = !!preparing || job?.status === "running" || job?.review?.status === "analyzing";
  const startedAt = preparing?.startedAt || (job ? Date.parse(job.createdAt) : 0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  if (!job && !preparing) return null;
  const analyzing = job?.review?.status === "analyzing";
  const phase = preparing ? "正在准备资料" : analyzing ? "正在分析故事变化" : job?.status === "running"
    ? job.output ? "正在生成内容" : "等待模型响应" : job?.status === "error" ? "生成失败"
    : job?.status === "cancelled" ? "已停止生成" : job?.status === "interrupted" ? "生成已中断"
    : job?.review?.status === "error" ? "内容已生成，分析未完成" : "生成完成";
  const chars = preparing ? 0 : job?.output.replace(/\s/g, "").length || 0;
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const warning = job?.status === "error" || job?.status === "interrupted" || job?.review?.status === "error";
  return <section className={`generation-activity ${active ? "is-active" : ""}`} aria-label={tr("生成进度")} data-active={active}>
    <div className="generation-activity-heading">
      <span className="generation-activity-icon" aria-hidden="true">
        {active ? <CircleNotch size={17} /> : warning ? <WarningCircle size={17} /> : <CheckCircle size={17} />}
      </span>
      <strong role="status" aria-live="polite">{tr(phase)}</strong>
      {job && !preparing && active && <Button variant="ghost" onClick={onStop} aria-label={tr("停止当前生成")}><Stop size={14} weight="fill" /></Button>}
    </div>
    <p className="generation-activity-target">{preparing?.label || label}</p>
    <div className="generation-activity-meta">
      <span>{tr("耗时 {0} 秒", { 0: seconds })}{chars > 0 && ` · ${tr("已生成 {0} 字符", { 0: chars.toLocaleString() })}`}</span>
      {job && !preparing && <Button variant="ghost" onClick={onView}><ArrowDown size={13} />{tr(active ? "查看实时结果" : "查看结果")}</Button>}
    </div>
    {active && <>
      <div className="generation-activity-track" aria-hidden="true"><i /></div>
      <p className="generation-activity-hint">{tr(preparing ? "保存当前编辑，整理本次参考资料。" : analyzing ? "正文已保留，正在核对人物、世界与记忆变化。" : chars ? "内容正在逐段更新，可随时查看或停止。" : "已发出请求，模型返回内容后会逐段显示。")}</p>
    </>}
  </section>;
}
