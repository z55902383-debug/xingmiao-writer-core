import { CaretDown, FolderOpen } from '@phosphor-icons/react';
import { tr } from './i18n';
import type { ContextInfo, Job } from './types';
import ReferenceOverview from './ReferenceOverview';

// Missing historical fields mean unknown, not zero. Never consult the live book.
function recordedCount(context: ContextInfo, key: string, entries?: unknown[]) {
  if (Array.isArray(entries)) return entries.length;
  if (Array.isArray(context.referenceSections)) return context.referenceSections.find(row => row.key === key)?.count ?? 0;
  return null;
}
export function recordedSkills(context: ContextInfo) {
  const count = recordedCount(context, 'skills', context.skills);
  return count === null ? tr('Skill 未记录') : tr('Skill {0}', { 0: count });
}
export default function CandidateReferences({ context }: { context: ContextInfo }) {
  const writing = context.writingReferences;
  const counts = [
    { label: '仿写', value: recordedCount(context, 'imitationReferences', context.imitationReferences) },
    { label: '风格', value: recordedCount(context, 'writingStyles', writing?.filter(row => row.kind === 'style')) },
    { label: '要求', value: recordedCount(context, 'writingRequirements', writing?.filter(row => row.kind === 'requirement')) },
  ];
  return <details className="candidate-reference-snapshot">
    <summary><FolderOpen size={15}/><span>{tr('历史生成参考')}<small>{counts.map(row => `${tr(row.label)} ${row.value === null ? tr('未记录') : row.value}`).join(' · ')}</small></span><CaretDown size={14}/></summary>
    <p className="reference-help">{tr('仅对应下面选中的生成记录，不受当前选择影响。')}</p>
    <ReferenceOverview context={context} snapshot/>
  </details>;
}
export function candidateDestination(job: Job) {
  if (job.imitationProfileSnapshot) return `${tr('仿写对标')} → ${job.imitationProfileSnapshot.title}`;
  if (job.writingProfileSnapshot) return `${tr(job.writingProfileSnapshot.kind === 'style' ? '写作风格' : '写作要求')} → ${job.writingProfileSnapshot.title}`;
  const labels: Record<string, string> = {
    style: '风格档案 → 本书风格', write: '当前章节正文', continue: '当前章节正文', polish: '当前章节正文',
    bookOutline: '故事大纲 → 全文大纲', volumePlan: '故事大纲 → 分卷结构', volumeOutline: '目标分卷大纲', volumeDetail: '目标分卷细纲',
    chapterPlan: '章节概要', chapterDetails: '章节细纲', outline: '当前章节细纲', summary: '当前章节概要',
    characters: '人物档案', worldBuild: '世界设定', timelinePlan: '时间线 → 变化计划', memory: '关系与记忆',
  };
  return tr(labels[job.kind] || '对应资料板块');
}
