import { useEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { api, count } from './api';
import { tr } from './i18n';
import { Button } from './ui';
import type { Book, Job } from './types';
import { useManuscriptFormat } from './ManuscriptSettings';
import { handleManuscriptEnter, useManuscriptTyping } from './manuscriptInput';
import './compare-writing.css';
type Draft = { chapterId: string; revision: number; baseRevision: number; baseHash: string; text: string; updatedAt: string; reference: { id: string; title: string; text: string; kind: string } | null };
type Edits = { text: string; sourceId?: string; referenceText?: string; loadBody?: boolean };
export default function CompareWriter({ chapterId, onApplied, beforeApply, guard, preferredSourceId, style }: {
  chapterId: string; onApplied?: (book: Book) => void; beforeApply?: () => Promise<unknown>; guard?: MutableRefObject<() => Promise<void>>; preferredSourceId?: string; style?: CSSProperties;
}) {
  const [draft, setDraft] = useState<Draft | null>(null), [sources, setSources] = useState<Job[]>([]), [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const [ratio, setRatio] = useState(50), [sync, setSync] = useState(false), [paste, setPaste] = useState(false), [referenceText, setReferenceText] = useState('');
  const [reload, setReload] = useState(0);
  const current = useRef<Draft | null>(null), pending = useRef<Edits | null>(null), version = useRef(0), request = useRef<Promise<void> | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null), alive = useRef(true);
  const left = useRef<HTMLTextAreaElement>(null), right = useRef<HTMLTextAreaElement>(null), columns = useRef<HTMLDivElement>(null), scrollLock = useRef(false);
  const recoveryKey = `xm-comparison-recovery:${chapterId}`;
  const retain = () => { if (pending.current && current.current) localStorage.setItem(recoveryKey, JSON.stringify({ revision: current.current.revision, edits: pending.current })); };
  const publish = () => { if (alive.current && current.current) setDraft({ ...current.current, ...(pending.current ? { text: pending.current.text } : {}) }); };
  const flush = async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    if (request.current) { await request.current; if (pending.current) await flush(); return; }
    const task = async () => {
      while (pending.current && current.current) {
        const edits = { ...pending.current }, at = version.current;
        if (alive.current) setStatus(tr('正在保存对照草稿…'));
        const saved = await api<Draft>('comparison:save', { chapterId, revision: current.current.revision, ...edits });
        current.current = saved;
        if (at === version.current) pending.current = null;
        if (pending.current) retain(); else localStorage.removeItem(recoveryKey);
        publish();
      }
      if (alive.current) { setStatus(tr('对照草稿已保存')); setError(''); }
    };
    request.current = task();
    try { await request.current; } catch (e) { retain(); if (alive.current) setError((e as Error).message); throw e; } finally { request.current = null; }
  };
  const flushRef = useRef(flush); flushRef.current = flush;
  const edit = (patch: Partial<Edits>) => {
    if (!current.current) return;
    pending.current = { text: pending.current?.text ?? current.current.text, ...pending.current, ...patch }; version.current++;
    if (patch.sourceId !== undefined && patch.referenceText === undefined) delete pending.current.referenceText;
    try { retain(); } catch { setError(tr('本机恢复副本暂未保存，请及时保存或导出。')); }
    publish(); setStatus(tr('正在保存对照草稿…'));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current().catch(() => {}), 400);
  };
  const manuscript = useManuscriptFormat();
  const inputFormat = { ...manuscript.format, autoIndent: !manuscript.loading && !manuscript.error && manuscript.format.autoIndent };
  useManuscriptTyping(right, inputFormat, text => edit({ text }), `${chapterId}:${draft ? 'ready' : 'loading'}`);
  useEffect(() => {
    alive.current = true;
    void Promise.all([api<Draft>('comparison:read', { chapterId }), api<Job[]>('manual:chapter-sources', { chapterId })]).then(([d, jobs]) => {
      if (!alive.current) return;
      current.current = d; setSources(jobs.filter(j => ['write', 'continue', 'polish'].includes(j.kind) && ['done', 'cancelled', 'interrupted'].includes(j.status) && j.output.trim()));
      try {
        const recovery = JSON.parse(localStorage.getItem(recoveryKey) || 'null');
        if (recovery?.edits && typeof recovery.edits.text === 'string') {
          if (recovery.edits.text !== d.text || recovery.edits.sourceId || recovery.edits.referenceText !== undefined) {
            pending.current = recovery.edits; version.current++;
            setError(tr('已恢复尚未保存的对照输入，请核对后重试保存或导出。'));
          } else localStorage.removeItem(recoveryKey);
          // Do not silently overwrite edits made in a second entry point.
          if (pending.current && recovery.revision !== d.revision) current.current = { ...d, revision: recovery.revision };
        }
      } catch { setError(tr('本机恢复副本暂未保存，请及时保存或导出。')); }
      publish(); setStatus(tr('对照草稿已保存'));
      if (!pending.current && !d.reference) {
        const selected = jobs.find(j => j.id === preferredSourceId && ['write', 'continue', 'polish'].includes(j.kind) && ['done', 'cancelled', 'interrupted'].includes(j.status)) || jobs.find(j => ['write', 'continue', 'polish'].includes(j.kind) && j.status === 'done' && j.output.trim());
        if (selected) edit({ sourceId: selected.id });
      }
    }).catch(e => { if (alive.current) setError(e.message); });
    const flushOnHide = () => { if (document.visibilityState === 'hidden') void flushRef.current().catch(() => {}); };
    document.addEventListener('visibilitychange', flushOnHide);
    const saveBeforeLeave = async () => { await flushRef.current(); };
    if (guard) guard.current = saveBeforeLeave;
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); void flushRef.current().catch(() => {}); document.removeEventListener('visibilitychange', flushOnHide); if (guard?.current === saveBeforeLeave) guard.current = async () => {}; };
  }, [chapterId, reload]);
  const exportDraft = async () => { try { await api('manual:export-draft', { title: tr('对照创作草稿'), body: pending.current?.text ?? current.current?.text ?? '' }); } catch (e) { setError((e as Error).message); } };
  const scroll = (from: HTMLTextAreaElement, to: HTMLTextAreaElement | null) => { if (!sync || !to || scrollLock.current) return; scrollLock.current = true; to.scrollTop = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight) * (to.scrollHeight - to.clientHeight); requestAnimationFrame(() => { scrollLock.current = false; }); };
  return <section className="compare-writer" aria-label={tr('双列对照创作')}>
    <div className="compare-controls"><label>{tr('AI参考稿')}<select aria-label={tr('选择对照候选稿')} disabled={!draft || busy} value={draft?.reference?.id || ''} onChange={e => edit({ sourceId: e.target.value })}><option value="">{draft?.reference?.kind === 'custom' ? tr('自定义参考文') : tr('选择本章候选稿')}</option>{sources.map(j => <option key={j.id} value={j.id}>{tr(j.kind === 'continue' ? '续写候选' : j.kind === 'polish' ? '润色候选' : '正文候选')} · {j.createdAt?.replace('T', ' ').slice(0, 19)}</option>)}</select></label>
      <Button disabled={!draft || busy} onClick={() => setPaste(v => !v)}>{tr('粘贴参考文')}</Button><label className="compare-sync"><input type="checkbox" checked={sync} onChange={e => setSync(e.target.checked)}/>{tr('同步滚动')}</label>
    </div>
    {paste && <div className="compare-paste"><textarea aria-label={tr('自定义参考文')} value={referenceText} onChange={e => setReferenceText(e.target.value)} placeholder={tr('粘贴要对照的参考内容，不会写入右栏。')}/><Button disabled={!draft || !referenceText.trim() || busy} onClick={() => { edit({ referenceText, sourceId: '' }); setPaste(false); }}>{tr('使用这份参考文')}</Button></div>}
    {error && <div className="compare-error" role="alert"><p>{error}</p><Button disabled={busy} onClick={() => { if (!current.current) { setError(''); setReload(v => v + 1); } else void flushRef.current().catch(() => {}); }}>{tr('重试保存草稿')}</Button><Button onClick={() => void exportDraft()}>{tr('导出右栏草稿')}</Button>{draft?.text.trim() && <Button disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        if (timer.current) clearTimeout(timer.current);
        if (request.current) await request.current.catch(() => {});
        const result = await api<{ draft: Draft; book: Book }>('comparison:rescue', { chapterId, text: pending.current?.text ?? current.current?.text ?? '' });
        pending.current = null; current.current = result.draft; localStorage.removeItem(recoveryKey); publish(); onApplied?.(result.book); setError(''); setStatus(tr('人工稿已另存为新章节，当前对照区已载入最新草稿。'));
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>{tr('另存为新章节并载入最新草稿')}</Button>}</div>}
    {!draft && !error && <p role="status">{tr('正在读取对照草稿…')}</p>}
    {draft && <>
      <div className="compare-columns" ref={columns} style={{ gridTemplateColumns: `minmax(0, ${ratio}fr) 12px minmax(0, ${100 - ratio}fr)` }}>
        <div className="compare-column"><div className="compare-column-head"><strong>{tr('AI参考稿 · 只读')}</strong><span>{count(draft.reference?.text || '')} {tr('字')}</span></div><textarea ref={left} aria-label={tr('AI参考正文')} readOnly value={draft.reference?.text || ''} style={style} onScroll={e => scroll(e.currentTarget, right.current)} placeholder={tr('选择本章AI候选稿，或粘贴参考文。')}/>{draft.reference?.kind === 'continue' && <small>{tr('当前参考仅为AI新增续写段落。')}</small>}</div>
        <div role="separator" tabIndex={0} aria-label={tr('调整对照栏宽')} aria-orientation="vertical" aria-valuenow={Math.round(ratio)} aria-valuemin={25} aria-valuemax={75} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); setRatio(v => Math.min(75, Math.max(25, v + (e.key === 'ArrowLeft' ? -2 : 2)))); } }} onPointerDown={e => e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={e => { if (e.buttons !== 1 || !columns.current) return; const r = columns.current.getBoundingClientRect(); setRatio(Math.min(75, Math.max(25, (e.clientX - r.left) / r.width * 100))); }}/>
        <div className="compare-column"><div className="compare-column-head"><strong>{tr('我的创作 · 独立草稿')}</strong><span>{count(draft.text)} {tr('字')}</span></div><textarea ref={right} aria-label={tr('人工对照正文')} value={draft.text} disabled={busy} style={style} onKeyDown={e => handleManuscriptEnter(e, inputFormat, text => edit({ text }))} onChange={e => edit({ text: e.target.value })} onScroll={e => scroll(e.currentTarget, left.current)} placeholder={tr('参考左栏，用自己的方式写下这一章。输入自动保存，写入正文前不会改变原章节。')}/></div>
      </div>
      <div className="compare-footer"><span role="status">{status}</span><div><Button disabled={busy || !!draft.text.trim()} onClick={async () => { setBusy(true); try { await flushRef.current(); edit({ loadBody: true }); await flushRef.current(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{tr('载入现有正文到右栏')}</Button><Button disabled={busy} onClick={() => void exportDraft()}>{tr('导出右栏草稿')}</Button><Button variant="primary" disabled={busy || !draft.text.trim()} onClick={async () => { setBusy(true); setError(''); try { await beforeApply?.(); await flushRef.current(); const result = await api<{ draft: Draft; book: Book }>('comparison:apply', { chapterId, revision: current.current!.revision }); current.current = result.draft; publish(); onApplied?.(result.book); setStatus(tr('已写入本章正文，旧正文保留在历史版本。')); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{tr('写入本章正文')}</Button></div></div>
      <p className="compare-note">{tr('两处入口共用本章对照草稿。参考稿不会自动替换；右栏写入并核对定稿后，才用于正式记忆提取。')}</p>
    </>}
  </section>;
}
