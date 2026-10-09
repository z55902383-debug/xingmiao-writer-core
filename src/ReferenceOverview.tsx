import { tr } from "./i18n";
import { number } from "./api";
import type { ContextInfo } from "./types";

const labels: Record<string, string> = {
  book: "作品信息", premise: "故事想法", bookOutline: "全文大纲", world: "世界设定", characters: "人物档案",
  worldRecords: "世界条目", foreshadows: "待回收伏笔", memories: "有效记忆", timeline: "时间线状态", chapterPlans: "本章计划",
  volume: "本章所属卷", structure: "卷章结构", targetVolume: "目标分卷", chapterOutline: "本章细纲", chapterBody: "当前章正文",
  recent: "已定稿前文", writingStyles: "写作风格", writingRequirements: "写作要求", skills: "写作 Skill", source: "分析参考原文", instruction: "补充创作要求",
  chapterSummary: "本章概要", availableIds: "规划可用对象",
};
export default function ReferenceOverview({ context, snapshot = false }: { context: ContextInfo; snapshot?: boolean }) {
  const rows = context.referenceSections;
  return <div className="reference-overview">
    {rows ? (["story", "writing", "task"] as const).map(group => {
      const items = rows.filter(row => row.group === group);
      if (!items.length) return null;
      return <section className="reference-group" key={group} aria-label={tr(group === "story" ? "故事资料" : group === "writing" ? "写作依据" : "当前任务资料")}>
        <h4>{tr(group === "story" ? "故事资料" : group === "writing" ? "写作依据" : "当前任务资料")}</h4>
        <ul>{items.map(item => <li key={item.key}>
          <div><strong>{tr(labels[item.key] || item.key)}</strong><span>{item.count != null ? tr("{0} 项", { 0: item.count }) : tr("已引用")}</span></div>
          {item.titles?.length ? <details className="reference-titles"><summary title={item.titles.join("、")}>{item.titles.slice(0, 2).join("、")}{item.titles.length > 2 ? ` · ${tr("另 {0} 项", { 0: item.titles.length - 2 })}` : ""}</summary><ul>{item.titles.map((title, i) => <li key={i}>{title}</li>)}</ul></details> : null}
        </li>)}</ul>
      </section>;
    }) : <p className="reference-help">{tr(snapshot ? "这份旧记录未保存完整清单，下方显示已记录的资料。" : "正在准备引用清单。")}</p>}
    {snapshot && !!context.writingReferences?.length && <details className="reference-snapshot-styles"><summary>{tr("查看当时的风格与要求内容")} · {context.writingReferences.length}</summary>{context.writingReferences.map(item => <details key={item.id}><summary>{tr(item.kind === "style" ? "写作风格" : "写作要求")} · {item.title}</summary><div className="writing-profile-text">{item.body}</div></details>)}</details>}
    <p className="reference-total">{tr(snapshot ? "这次请求约 {0} 字符" : "预计请求约 {0} 字符", { 0: number(context.characters) })}</p>
  </div>;
}
