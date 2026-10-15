import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { tr } from './i18n';
import { Button, Field } from './ui';
import type { Book, Chapter, ContinuityCard, RetrievedExcerpt } from './types';
import './continuity.css';
import RelationMemory from './RelationMemory';

type Review = { id: string; kind: string; text: string; sourceId: string; sourceTitle: string; canConfirm: boolean; basis: string };
type Preview = { stateCard: ContinuityCard; reviews: Review[]; excerpts: RetrievedExcerpt[]; eligibleChapters: number; semanticCandidateCount: number };
export default function ContinuityPanel({ book, chapter, chapterIds, excerptIds, query, disabled, onQuery, onExcerpts, onInclude, onRelated, onSource, onChanged, flush, defaultOpen = false }: {
  defaultOpen?: boolean;
  book: Book; chapter: Chapter; chapterIds: string[] | null; excerptIds: string[]; query: string; disabled: boolean;
  onQuery: (value: string) => void; onExcerpts: (ids: string[]) => void; onInclude: (include: boolean) => void;
  onSource: (id: string) => void; onChanged: (book: Book) => void; flush: () => Promise<unknown>;
  onRelated: (value: boolean) => void;
}) {
  const [tab, setTab] = useState('state'), [preview, setPreview] = useState<Preview | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [semantic, setSemantic] = useState<RetrievedExcerpt[]>([]), [searching, setSearching] = useState(false), [semanticError, setSemanticError] = useState('');
  const [semanticCount, setSemanticCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const intent = `${book.id}:${chapter.id}:${query}:${JSON.stringify(chapterIds)}`, intentRef = useRef(intent); intentRef.current = intent;
  const alive = useRef(true), active = useRef(false), stopRequested = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (active.current) void api('continuity:cancel', { bookId: book.id }).catch(() => {}); }; }, [book.id]);
  useEffect(() => { setSemantic([]); setSemanticCount(null); setSemanticError(''); }, [intent]);
  useEffect(() => {
    let cancelled = false; setPending(true); setError('');
    const timer = setTimeout(() => {
      void api<Preview>('continuity:preview', { bookId: book.id, chapterId: chapter.id, chapterIds: chapterIds ?? undefined, excerptIds, query })
        .then(value => { if (!cancelled) setPreview(value); })
        .catch(e => { if (!cancelled) { setError(e.message); setPreview(null); } })
        .finally(() => { if (!cancelled) setPending(false); });
    }, 800);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [book.id, book.chapters, book.characters, book.memories, book.timeline, book.foreshadows, book.worldRecords, book.contextChapters, chapter.id, chapter.body, chapter.outline, chapter.summary, chapter.writingCard, chapterIds, excerptIds, query, refresh]);
  const excerpts = new Map<string, RetrievedExcerpt>();
  for (const item of [...(preview?.excerpts || []), ...semantic]) excerpts.set(item.id, { ...excerpts.get(item.id), ...item });
  const semanticSearch = async () => {
    setSearching(true); setSemanticError(''); active.current = true; stopRequested.current = false;
    const expected = intentRef.current;
    try {
      await flush();
      if (!alive.current || stopRequested.current || intentRef.current !== expected) return;
      const result = await api<{ matches: RetrievedExcerpt[]; candidateCount: number }>('continuity:search', { bookId: book.id, chapterId: chapter.id, chapterIds: chapterIds ?? undefined, query });
      if (alive.current && intentRef.current === expected) { setSemantic(result.matches); setSemanticCount(result.candidateCount); }
    } catch (e) { if (alive.current && intentRef.current === expected) setSemanticError((e as Error).message); }
    finally { active.current = false; if (alive.current) setSearching(false); }
  };
  return <details className="continuity-panel" open={defaultOpen}><summary>{tr('续写状态与旧文检索')}<span>{tr('保留所选完整前文，补充长期记忆')}</span></summary>
    <div className="continuity-tabs" role="tablist" aria-label={tr('续写资料')}>
      <button role="tab" aria-selected={tab === 'state'} onClick={() => setTab('state')}>{tr('续写状态卡')}</button>
      <button role="tab" aria-selected={tab === 'search'} onClick={() => setTab('search')}>{tr('检索旧文')} · {excerptIds.length}</button>
      <button role="tab" aria-selected={tab === 'relations'} onClick={() => setTab('relations')}>{tr('关系与原文联动')}</button>
    </div>
    {pending && <p role="status">{tr('正在核对前文来源…')}</p>}
    {error && <div><p role="alert">{error}</p><div className="continuity-actions"><Button disabled={disabled} onClick={() => setRefresh(value => value + 1)}>{tr('重新核对资料')}</Button>{tab === 'state' && !!excerptIds.length && <Button disabled={disabled} onClick={() => onExcerpts([])}>{tr('清空片段选择')}</Button>}</div></div>}
    {tab === 'relations' && <RelationMemory book={book} chapter={chapter} query={query} disabled={disabled} onSource={onSource} onMode={onRelated} onSearch={value => { onQuery(value); setTab('search'); }}/ >}
    {tab === 'state' && <>
      <label className="continuity-choice"><input type="checkbox" checked={book.includeContinuity !== false} disabled={disabled} onChange={e => onInclude(e.target.checked)}/>{tr('生成正文时引用状态卡')}</label>
      <p>{tr('状态随当前章和来源版本实时整理；章纲中的未来安排不算已发生事实。')}</p>
      <p className="continuity-hint">{tr('每组展示最多12条来源记录；完整资料仍保留在人物、记忆和时间线中。')}</p>
      {!pending && preview && <>
        <p>{tr(preview.stateCard.warning)}</p>
        {!!preview.reviews?.length && <section className="continuity-reviews"><h4>{tr('来源变更，以下资料已暂停引用')}</h4>{preview.reviews.map(row => <article key={row.kind + row.id}><p>{row.text}</p><small>{row.sourceTitle}</small><div className="continuity-actions"><Button disabled={disabled || !row.sourceId} onClick={() => onSource(row.sourceId)}>{tr('打开来源章节')}</Button><Button disabled={disabled || confirming || !row.canConfirm} onClick={async () => { setConfirming(true); try { await flush(); onChanged(await api<Book>('continuity:confirm', { bookId: book.id, id: row.id, kind: row.kind, basis: row.basis })); } catch (e) { setError((e as Error).message); } finally { setConfirming(false); } }}>{tr('核对后重新确认')}</Button></div></article>)}</section>}
        {preview.stateCard.sections.map(section => <details className="continuity-section" key={section.key}><summary>{tr(section.title)} · {section.items.length}</summary>
          {!section.items.length && <p>{tr('尚未记录，不自动推断。')}</p>}
          {section.items.map(item => <article key={item.id}><p>{item.text}</p><div className="continuity-source"><small>{item.source.title} · {item.source.revision ? tr('版本 {0}', { 0: item.source.revision }) : tr('作者确认资料')}</small>{item.source.chapterId && <Button variant="quiet" disabled={disabled} onClick={() => onSource(item.source.chapterId)}>{tr('打开来源章节')}</Button>}</div>{item.source.evidence && <blockquote>{item.source.evidence}</blockquote>}</article>)}
        </details>)}
      </>}
    </>}
    {tab === 'search' && <>
      <p>{tr('只检索当前章之前已定稿且未完整引用的旧文；勾选后才发送片段，保留原章和原文位置。')}</p>
      <Field label={tr('查找人物、物品或事件')}><input value={query} maxLength={4000} disabled={disabled || searching} onChange={e => onQuery(e.target.value)} placeholder={tr('例如：铜钥匙最后交给了谁？')}/></Field>
      <p className="continuity-hint">{tr('本地检索自动结合章纲、人物别名和相关事件用词，不调用模型。')}</p>
      <div className="continuity-actions"><Button disabled={disabled || searching || !query.trim() || pending || !preview?.semanticCandidateCount} onClick={() => void semanticSearch()}>{tr('语义补搜')}</Button>{searching && <Button onClick={() => { stopRequested.current = true; void api('continuity:cancel', { bookId: book.id }); }}>{tr('停止检索')}</Button>}{!!excerptIds.length && <Button disabled={disabled} onClick={() => onExcerpts([])}>{tr('清空片段选择')}</Button>}</div>
      <p className="continuity-hint">{tr('语义补搜会调用当前模型，最多比较64段本次候选，不代表已覆盖全书；推荐理由也需核对。')}</p>
      {searching && <p role="status">{tr('正在比较候选片段…')}</p>}
      {semanticError && <p role="alert">{semanticError}</p>}
      {semanticCount !== null && <p>{tr('本次语义补搜比较了 {0} 段候选。', { 0: semanticCount })}</p>}
      {!pending && !error && !excerpts.size && <p>{tr('没有找到匹配的旧文片段，可换用具体人名、物品或事件描述。')}</p>}
      {!pending && !error && [...excerpts.values()].map(item => <article className="retrieved-excerpt" key={item.id}>
        <label><input type="checkbox" disabled={disabled || (!excerptIds.includes(item.id) && excerptIds.length >= 20)} checked={excerptIds.includes(item.id)} onChange={e => onExcerpts(e.target.checked ? [...excerptIds, item.id] : excerptIds.filter(id => id !== item.id))}/><strong>{item.title}</strong></label>
        <small>{tr('版本 {0}', { 0: item.revision })} · {tr('原文位置 {0}–{1}', { 0: item.start + 1, 1: item.end })}</small>
        <p className="continuity-hint">{item.semanticReason ? tr('模型推荐理由：{0}', { 0: item.semanticReason }) : (item.reasons || []).join('；')}</p>
        <blockquote>{item.text}</blockquote><Button variant="quiet" disabled={disabled} onClick={() => onSource(item.chapterId)}>{tr('打开来源章节')}</Button>
      </article>)}
      {!!excerptIds.length && <p>{tr('已选 {0}/20 段；来源修改或取消定稿后，需要重新检索。', { 0: excerptIds.length })}</p>}
    </>}
  </details>;
}
