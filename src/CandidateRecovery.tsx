import { useEffect, useState } from 'react';
import { api } from './api';
import { tr } from './i18n';
import { Button, Field, Modal } from './ui';
import type { Book, Job } from './types';
type Recovery = { conflict: boolean; needsCompletion: boolean; changes: { label: string; before: string; after: string }[]; canMerge: boolean; current: string; suggested: string; targetLabel: string; field: string; signature: string; planningSignature: string; revision: number };
export default function CandidateRecovery({ job, book, flush, onChange, refresh = 0 }: { job: Job; book: Book; refresh?: number; flush: () => Promise<void>; onChange: (book: Book) => void }) {
  const [preview, setPreview] = useState<Recovery | null>(null), [open, setOpen] = useState(false), [value, setValue] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const basisKey = JSON.stringify([book.premise, book.outline, book.characters, book.world, book.worldRecords, book.timeline, book.memories, book.foreshadows, book.volumes, book.chapters.map(c => [c.id, c.title, c.volumeId, c.summary, c.outline, c.id === job.chapterId ? c.body : undefined, c.revision]), book.style, book.writingProfiles?.map(p => [p.id, p.kind, p.title, p.body]), book.writingSelection]);
  useEffect(() => {
    if (job.status === 'running' || job.adopted) return;
    let cancelled = false;
    api<Recovery>('candidate:recovery', { id: job.id }).then(result => { if (!cancelled) setPreview(result); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [job.id, job.status, job.adopted, book.updatedAt, basisKey, refresh]);
  if (job.adopted || job.status === 'running' || (!preview?.conflict && !preview?.needsCompletion && job.status === 'done' && !/待定|待确认|二选一|或者|任选/.test(job.output))) return null;
  return <div className="candidate-recovery">
    {preview?.conflict && <p role="alert">{tr('生成依据已变化：{0}', { 0: preview.changes.map(c => tr(c.label)).join('、') || tr('正文或故事资料') })}</p>}
    {preview?.canMerge && <Button onClick={async () => {
      setError(''); setBusy(true);
      try { await flush(); const fresh = await api<Recovery>('candidate:recovery', { id: job.id }); setPreview(fresh); setValue(fresh.suggested); setOpen(true); }
      catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }} disabled={busy}>{tr(job.status === 'done' ? '核对并手动合并' : '手动补齐并保存')}</Button>}
    {preview?.conflict && !preview.canMerge && <p>{tr('此结果涉及多个目标，请重新生成，或复制后在对应位置逐项修改。')}</p>}
    {error && <p role="alert" className="error-box">{tr(error)}</p>}
    {open && preview && <Modal wide title={tr('核对并手动合并')} onClose={() => !busy && setOpen(false)}>
      <div className="modal-body"><p>{preview.targetLabel} · {tr('只保存下方编辑内容，其他资料保持当前版本。')}</p>
        {preview.changes.map(change => <details key={change.label}><summary>{tr(change.label)}</summary><p>{tr('生成时：')}{change.before || '—'}</p><p>{tr('当前：')}{change.after || '—'}</p></details>)}
        <details><summary>{tr('查看目标当前内容')}</summary><pre className="recovery-current">{preview.current || '—'}</pre></details>
        {preview.needsCompletion && <p role="alert" className="notice">{tr('生成结构不完整，请参考原始结果填写完整内容；不要粘贴未完成的 JSON。')}</p>}
        <Field label={tr('合并后的内容')}><textarea rows={14} value={value} onChange={e => setValue(e.target.value)}/></Field>
        <p>{tr('请逐段核对，保留新增设定并补齐关键因果；此操作会保留原内容快照。')}</p>
        {error && <p role="alert" className="error-box">{tr(error)}</p>}
      </div>
      <div className="modal-footer"><Button disabled={busy} onClick={() => setOpen(false)}>{tr('取消')}</Button><Button variant="primary" disabled={busy || !value.trim()} onClick={async () => {
        setBusy(true); setError('');
        try { await flush(); onChange(await api<Book>('candidate:merge', { id: job.id, value, signature: preview.signature, planningSignature: preview.planningSignature, revision: preview.revision })); setOpen(false); }
        catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>{tr('保存手动合并')}</Button></div>
    </Modal>}
  </div>;
}
