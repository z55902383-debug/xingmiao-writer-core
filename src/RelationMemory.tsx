import { useEffect, useState } from 'react';
import { api } from './api';
import { tr } from './i18n';
import { Button } from './ui';
import type { Book, Chapter } from './types';
export type RelationResult = {
  total: number; selectedCount: number; filtered: boolean; fallback: boolean;
  rows: { id: string; kind: string; subject: string; relation: string; object: string; state: string; reason: string; source: RelationSource }[];
  conflicts: { id: string; text: string; source: RelationSource }[];
};
type RelationSource = { chapterId: string; title: string; revision: number; evidence?: string; start?: number; end?: number };
export default function RelationMemory({ book, chapter, focusId, query = '', disabled, onSource, onSearch, onMode }: {
  book: Book; chapter: Chapter; focusId?: string; query?: string; disabled?: boolean; onSource: (id: string) => void; onSearch?: (query: string) => void; onMode?: (value: boolean) => void;
}) {
  const [result, setResult] = useState<RelationResult | null>(null), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [shown, setShown] = useState(30);
  useEffect(() => {
    let cancelled = false; setResult(null); setError(''); setShown(30);
    const timer = setTimeout(() => { void api<RelationResult>('relations:inspect', { bookId: book.id, chapterId: chapter.id, focusId, query }).then(r => { if (!cancelled) setResult(r); }).catch(e => { if (!cancelled) setError(e.message); }); }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [book, chapter, focusId, query, refresh]);
  return <section className="relation-memory">
    <h4>{tr('关系与原文联动')}</h4>
    <p>{focusId ? tr('查看这条记忆关联的全书已定稿记录，按来源章节核对变化；此处浏览不会自动加入生成引用。') : tr('按本章之前的已定稿资料查看人物、事件与物品记录；普通事实保留为历史，归属变化按来源章排序，同章冲突需核对。')}</p>
    {onMode && <label className="continuity-choice"><input type="checkbox" checked={book.relatedMemoryOnly === true} disabled={disabled} onChange={e => onMode(e.target.checked)}/>{tr('仅引用本章相关关系记忆，固定设定始终保留')}</label>}
    {error ? <p role="alert">{error}<Button onClick={() => setRefresh(v => v + 1)}>{tr('重新核对资料')}</Button></p> : !result ? <p role="status">{tr('正在核对前文来源…')}</p> : <>
      <p>{focusId ? tr('找到 {0} 条关联记录，原始资料全部保留。', { 0: result.rows.length }) : tr('本次引用 {0}/{1} 条关系与事实记录；原始资料全部保留。', { 0: result.selectedCount, 1: result.total })}</p>
      {result.fallback && <p>{tr('尚无明确关联线索，暂时完整引用；补充章纲或具体人名、物品后可缩小范围。')}</p>}
      {!!result.conflicts.length && <div className="relation-conflicts" role="status"><strong>{tr('归属待核对')}</strong>{result.conflicts.map(row => <p key={row.id}>{row.text}</p>)}</div>}
      {!result.rows.length && <p>{tr('暂无本章之前的有效记录；来源变更的记忆请先在记忆板块复核。')}</p>}
      <div className="relation-records">{result.rows.slice(0, shown).map(row => <article key={row.kind + row.id}>
        <p><strong>{row.subject}</strong> · {row.relation}：{row.object}</p>
        <small>{tr(({ history: '历史记录', current: '当前时间线状态', latest: '最近归属记录', conflict: '同章归属待核对' } as Record<string, string>)[row.state])} · {tr(row.reason)}</small>
        <div className="continuity-source"><small>{row.source.title}{row.source.revision ? ' · ' + tr('版本 {0}', { 0: row.source.revision }) : ''}{row.source.start !== undefined ? ' · ' + tr('原文位置 {0}–{1}', { 0: row.source.start + 1, 1: row.source.end || 0 }) : ''}</small>
          <div className="continuity-actions">{row.source.chapterId && <Button variant="quiet" disabled={disabled} onClick={() => onSource(row.source.chapterId)}>{tr('打开来源章节')}</Button>}{onSearch && <Button disabled={disabled} onClick={() => onSearch(`${row.subject} ${row.object}`.slice(0, 4000))}>{tr('查找相关旧文')}</Button>}</div>
        </div>{row.source.evidence && <blockquote>{row.source.evidence}</blockquote>}
      </article>)}</div>
      {result.rows.length > shown && <Button onClick={() => setShown(v => v + 30)}>{tr('继续查看记录')} · {shown}/{result.rows.length}</Button>}
    </>}
  </section>;
}

export function CandidateRelationReview({ book, chapter, output }: { book: Book; chapter: Chapter; output: string }) {
  const [result, setResult] = useState<RelationResult | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false; setResult(null); setError('');
    void api<RelationResult>('relations:inspect', { bookId: book.id, chapterId: chapter.id, body: output }).then(r => { if (!cancelled) setResult(r); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [book, chapter.id, output]);
  return <details className="prose-review relation-check"><summary>{tr('与当前关系记忆核对')} · {result?.conflicts.length || 0}</summary><p>{tr('本地规则只检查明确归属句和同章冲突，不代表已完成全文逻辑审查；提示不阻止采用。')}</p>{error && <p role="alert">{error}</p>}{result?.conflicts.map(row => <p key={row.id}>{row.text}<small> · {row.source.title}</small></p>)}</details>;
}
