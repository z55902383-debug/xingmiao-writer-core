import { CaretRight } from '@phosphor-icons/react';
import { tr } from "./i18n";
import { number } from "./api";
import type { ContextInfo } from "./types";

const labels: Record<string, string> = {
  imitationReferences: '仿写故事对标', imitationSource: '仿写分析原文',
  book: "作品信息", premise: "故事想法", bookOutline: "全文大纲", world: "世界设定", characters: "人物档案",
  worldRecords: "世界条目", foreshadows: "待回收伏笔", memories: "有效记忆", timeline: "时间线状态", chapterPlans: "本章计划",
  volume: "本章所属卷", structure: "卷章结构", targetVolume: "目标分卷", chapterOutline: "本章细纲", chapterBody: "当前章正文",
  recent: "已定稿前文", writingStyles: "写作风格", writingRequirements: "写作要求", skills: "写作 Skill", source: "分析参考原文", instruction: "补充创作要求",
  chapterSummary: "本章概要", availableIds: "规划可用对象",
  writingCard: "本章写前卡", techniques: "已选拆文技法",
  continuity: "续写状态卡", retrieved: "已选旧文片段",
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
          {item.titles?.length ? <details className="reference-titles"><summary title={item.titles.join("、")}><CaretRight size={13}/><span className="reference-title-preview">{item.titles.slice(0, 2).join("、")}</span>{item.titles.length > 2 && <small>{tr("另 {0} 项", { 0: item.titles.length - 2 })}</small>}</summary><ul tabIndex={0} aria-label={tr("引用名称清单")}>{item.titles.map((title, i) => <li key={i}>{title}</li>)}</ul></details> : null}
        </li>)}</ul>
      </section>;
    }) : <p className="reference-help">{tr(snapshot ? "旧记录的参考清单不完整；未记录不代表未使用，无法从当前配置补还原。" : "正在准备引用清单。")}</p>}
    {snapshot && !!context.writingReferences?.length && <details className="reference-snapshot-styles"><summary>{tr("查看当时的风格与要求内容")} · {context.writingReferences.length}</summary>{context.writingReferences.map(item => <details key={item.id}><summary>{tr(item.kind === "style" ? "写作风格" : "写作要求")} · {item.title}{item.weight != null ? ` · ${item.weight}%` : ''}</summary><div className="writing-profile-text">{item.body}</div></details>)}</details>}
    <div className="reference-total"><p>{Number.isFinite(context.characters) && context.characters >= 0 ? tr(snapshot ? '当时输入约 {0} 字符' : '预计输入约 {0} 字符', { 0: number(context.characters) }) : tr('输入字符数未记录')}</p><details className="reference-input-help"><summary>{tr('输入字符数包含什么？')}</summary><p>{tr('包含系统规则、任务说明及发送的资料文本；不是生成字数，也不是 Token 数。仿写、风格和要求的数量仅统计参考档案，不包含分析原文或全部故事资料。')}</p></details></div>
    {!!context.imitationReferences?.length && <details className="reference-snapshot-styles"><summary>{tr('查看仿写对标档案与占比')}</summary>{context.imitationReferences.map(row => <details key={row.id}><summary>{row.title} · {row.weight}%</summary><div className="writing-profile-text">{row.body}</div></details>)}</details>}
    {snapshot && context.continuityCard && <details className="continuity-snapshot"><summary>{tr('查看当时的续写状态')}</summary>{context.continuityCard.sections.filter(section => section.items.length).map(section => <section key={section.key}><h4>{tr(section.title)}</h4>{section.items.map(item => <div key={item.id}><p>{item.text}</p><small>{item.source.title} · {item.source.revision ? tr('版本 {0}', { 0: item.source.revision }) : tr('作者确认资料')}</small>{item.source.evidence && <blockquote>{item.source.evidence}</blockquote>}</div>)}</section>)}</details>}
    {snapshot && !!context.retrievedExcerpts?.length && <details className="continuity-snapshot"><summary>{tr('查看实际引用的旧文片段')}</summary>{context.retrievedExcerpts.map(item => <div key={item.id}><strong>{item.title} · {tr('版本 {0}', { 0: item.revision })}</strong><blockquote>{item.text}</blockquote></div>)}</details>}
  </div>;
}
