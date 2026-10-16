import { useId, useRef, useState, type ReactNode } from 'react';
import { Check, Plus, UploadSimple, Sparkle, PencilSimple, Trash, ArrowCounterClockwise, Export, FileText, CaretDown, DotsThree, CopySimple } from '@phosphor-icons/react';
import { api } from './api';
import { tr } from './i18n';
import { Button, Field, Modal, Menu } from './ui';
import StyleBlend from './StyleBlend';
import ReferenceSourceOptions from './ReferenceSourceOptions';
import { reselectWeights } from '../electron/style-weights.mjs';
import type { Book, ImitationProfile, WritingProfile } from './types';
import './imitation-profiles.css';

type Shared = { book: Book; disabled: boolean; onChanged: (book: Book) => void; flush: () => Promise<void>; onSaving: (value: boolean) => void; preview: Record<string, number> | null; onPreview: (value: Record<string, number> | null) => void };
type Source = { name: string; title: string; body: string; error?: string };

export function ImitationChoice({ book, disabled, onChanged, flush, onSaving, preview, onPreview, showChoices = true, showBlend = true, heading, actions }: Shared & { showChoices?: boolean; showBlend?: boolean; heading?: ReactNode; actions?: ReactNode }) {
  const [pending, setPending] = useState<Book['imitationSelection']>();
  const [error, setError] = useState('');
  const chosen = pending || book.imitationSelection || { ids: [], weights: {} };
  const rows = book.imitationProfiles || [];
  async function choose(value: NonNullable<Book['imitationSelection']>) {
    setPending(value); setError(''); onSaving(true);
    try { await flush(); onChanged(await api<Book>('imitation:select', { bookId: book.id, selection: value })); }
    catch (error) { setError((error as Error).message); throw error; }
    finally { setPending(undefined); onSaving(false); }
  }
  return <section className="imitation-choice" aria-label={tr('仿写对标选择')}>
    {showChoices && !!rows.length && <div className="writing-style-tags" role="group" aria-label={tr('选择故事对标')}>{rows.map(row => <button type="button" className={`writing-style-tag${chosen.ids.includes(row.id) ? ' is-selected' : ''}`} key={row.id} title={row.title} aria-label={row.title} aria-pressed={chosen.ids.includes(row.id)} disabled={disabled || !!pending || !row.body.trim() || (!chosen.ids.includes(row.id) && chosen.ids.length >= 30)} onClick={() => { const ids = chosen.ids.includes(row.id) ? chosen.ids.filter(id => id !== row.id) : [...chosen.ids, row.id]; void choose({ ids, weights: reselectWeights(ids, chosen.ids, chosen.weights) }).catch(() => {}); }}>{chosen.ids.includes(row.id) && <Check size={14}/>}<span>{row.title}</span>{!row.body.trim() && <small>{tr('待分析')}</small>}</button>)}</div>}
    {showBlend && (chosen.ids.length ? <StyleBlend profiles={rows.map(row => ({ ...row, kind: 'style' })) as WritingProfile[]} selection={{ styleIds: chosen.ids, requirementIds: [], styleWeights: chosen.weights }} disabled={disabled || !!pending} onChange={value => choose({ ids: value.styleIds, weights: value.styleWeights || {} })} previewWeights={preview} onPreview={onPreview} compact label={tr('仿写对标融合')} heading={heading || <strong>{tr('仿写对标占比')}</strong>} actions={actions}/> : <>{heading && <div className="writing-section-head">{heading}{actions}</div>}<p className="writing-blend-empty">{tr(heading ? '尚未选用故事对标，可在下方资料库点击标题或勾选。' : '分析并采用对标档案后，点击标题选择故事参考。')}</p></>)}
    {error && <p role="alert" className="error-message">{error}</p>}
  </section>;
}

export function ImitationPicker(props: Shared & { onManage: () => void; open: boolean; onToggle: () => void }) {
  const { open, onToggle } = props;
  const optionsId = useId();
  const rows = props.book.imitationProfiles || [];
  const count = (props.book.imitationSelection?.ids || []).filter(id => (props.book.imitationSelection?.weights[id] || 0) > 0).length;
  const status = !rows.length ? tr('尚未添加故事对标') : count ? tr('已启用 {0} 篇故事对标', { 0: count }) : tr('已添加 {0} 篇 · 未选用', { 0: rows.length });
  return <section id="assistant-imitation-reference" className={`imitation-picker reference-disclosure${open ? ' is-open' : ''}`} aria-label={tr('仿写参考')}>
    <button type="button" className="imitation-picker-toggle disclosure-toggle" aria-expanded={open} aria-controls={optionsId} onClick={onToggle}>
      <span className="disclosure-icon"><FileText size={19}/></span>
      <span className="disclosure-copy"><strong>{tr('仿写故事对标')}</strong><small>{status}</small></span>
      <span className="disclosure-action">{tr(open ? '收起' : '展开')}<CaretDown size={14}/></span>
    </button>
    <div id={optionsId} className="imitation-picker-content">
      {open && <p className="writing-help">{tr('参考故事骨架、人物关系与桥段；文笔语感在风格档案单独选择。')}</p>}
      {!!rows.length && <ImitationChoice {...props} showChoices={open}/>}
      <div className="imitation-picker-footer"><span>{tr(!rows.length ? '添加小说，分析并采用后即可选用。' : '故事参考与文风分别配置。')}</span><Button variant="ghost" onClick={props.onManage}>{tr(!rows.length ? '添加对标' : '管理对标')}</Button></div>
    </div>
  </section>;
}

export default function ImitationProfiles(props: Shared & { onAnalyze: (id: string) => Promise<void> }) {
  const { book, onChanged, disabled } = props;
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [draft, setDraft] = useState<Partial<ImitationProfile> | null>(null);
  const [batch, setBatch] = useState<Source[] | null>(null);
  const [remove, setRemove] = useState<ImitationProfile | null>(null);
  const [query, setQuery] = useState('');
  const [pendingSelection, setPendingSelection] = useState<Book['imitationSelection']>();
  const [filter, setFilter] = useState('all');
  const libraryRef = useRef<HTMLDivElement>(null);
  const blocked = disabled || saving;
  const all = book.imitationProfiles || [];
  const selectedIds = pendingSelection?.ids || book.imitationSelection?.ids || [];
  const choiceBook = pendingSelection ? { ...book, imitationSelection: pendingSelection } : book;
  const pendingCount = all.filter(row => !row.body.trim()).length;
  const rows = all.filter(row => (filter === 'all' || filter === 'selected' && selectedIds.includes(row.id) || filter === 'pending' && !row.body.trim()) && `${row.title} ${row.sourceName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function openDraft() { setError(''); setDraft({ title: '', body: '', source: '', sourceName: '' }); }
  function showProfiles(value = 'all') { setQuery(''); setFilter(value); window.requestAnimationFrame(() => libraryRef.current?.scrollIntoView({ block: 'start' })); }
  async function perform(task: () => Promise<void>) {
    setSaving(true); props.onSaving(true); setError('');
    try { await props.flush(); await task(); }
    catch (error) { setError((error as Error).message); }
    finally { setSaving(false); props.onSaving(false); }
  }
  async function save(analyze = false) {
    let id = '';
    await perform(async () => { const saved = await api<Book>('imitation:save', { bookId: book.id, profile: draft }); id = draft?.id || saved.imitationProfiles!.at(-1)!.id; onChanged(saved); setDraft(null); showProfiles(); });
    if (analyze && id) await props.onAnalyze(id);
  }
  function copyExisting() {
    const sources = [...(book.reference.trim() ? [{ name: book.referenceName || tr('本书参考文章'), title: tr('本书参考文章'), body: book.reference }] : []), ...(book.writingProfiles || []).filter(row => row.kind === 'style' && row.source.trim()).map(row => ({ name: row.sourceName || row.title, title: row.title, body: row.source }))];
    setError(''); setBatch(sources);
  }
  function toggleProfile(row: ImitationProfile) {
    const selected = book.imitationSelection || { ids: [], weights: {} };
    const ids = selected.ids.includes(row.id) ? selected.ids.filter(id => id !== row.id) : [...selected.ids, row.id];
    const next = { ids, weights: reselectWeights(ids, selected.ids, selected.weights) };
    setPendingSelection(next);
    void perform(async () => onChanged(await api<Book>('imitation:select', { bookId: book.id, selection: next }))).finally(() => setPendingSelection(undefined));
  }
  const blendHeading = <div className="writing-active-title"><h3>{tr('本书使用的对标')}</h3><small>{tr('已选 {0} 篇', { 0: selectedIds.length })}</small>{!!pendingCount && <button type="button" className="writing-pending-link" disabled={blocked} onClick={() => showProfiles('pending')}><Sparkle size={14}/>{tr('{0} 篇待分析或填写', { 0: pendingCount })}</button>}</div>;
  const blendActions = <Button variant="ghost" disabled={blocked} onClick={() => showProfiles()}>{tr('选择对标')}<CaretDown size={14}/></Button>;
  return <section className="imitation-library" aria-label={tr('仿写对标管理')}>
    <section className="imitation-active" aria-label={tr('本书使用的对标')}><ImitationChoice {...props} book={choiceBook} disabled={blocked} showChoices={false} heading={blendHeading} actions={blendActions}/></section>
    <div className="imitation-materials" tabIndex={0} aria-label={tr('仿写资料管理列表')}>
      <section className="writing-source-upload imitation-source" aria-label={tr('仿写小说原文')}>
        <div className="writing-source-top"><div className="writing-source-copy"><h3><UploadSimple size={19}/>{tr('从小说建立故事对标')}</h3></div><div className="writing-upload-actions"><Button variant="primary-soft" disabled={blocked} onClick={() => void perform(async () => { const files = await api<Source[] | null>('writing:import-sources'); if (files?.length) setBatch(files); })}><UploadSimple size={16}/>{tr('上传仿写小说')}</Button><Button disabled={blocked} onClick={openDraft}>{tr('粘贴参考原文')}</Button></div></div>
        <ReferenceSourceOptions description={tr('仿写参考故事骨架、人物关系与桥段；分析时发送目标原文，创作时只发送已选档案。风格资料单独管理。')}><Button variant="quiet" disabled={blocked || (!book.reference.trim() && !(book.writingProfiles || []).some(row => row.kind === 'style' && row.source.trim()))} onClick={copyExisting}><CopySimple size={15}/>{tr('从现有风格原文复制')}</Button></ReferenceSourceOptions>
      </section>
      <div ref={libraryRef} className="writing-section-head imitation-library-heading"><div><h3>{tr('仿写对标库')}</h3><small>{tr('共 {0} 篇 · 已选 {1} 篇', { 0: all.length, 1: selectedIds.length })}</small></div><Button disabled={blocked} onClick={openDraft}><Plus size={16}/>{tr('新建仿写对标')}</Button></div>
      {!!all.length && <section className="writing-quick-select imitation-quick-select"><p>{tr('点击标题选用，再点取消；支持多选融合。')}</p><ImitationChoice {...props} book={choiceBook} disabled={blocked} showBlend={false}/></section>}
      {!!all.length && <div className="writing-library-search imitation-library-search"><Field label={tr('搜索仿写对标')}><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={tr('名称或来源文件名')}/></Field><Field label={tr('资料状态')}><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">{tr('全部资料')}</option><option value="selected">{tr('已选用')}</option><option value="pending">{tr('待分析或填写')}</option></select></Field></div>}
      {!rows.length && <div className="writing-empty"><p>{tr(all.length ? '没有匹配的资料。' : '尚无独立仿写对标。已有风格资料保留在风格档案，可复制原文到这里重新分析。')}</p>{!!all.length && <Button onClick={() => showProfiles()}>{tr('清除筛选')}</Button>}</div>}
      {rows.map(row => <article className="writing-profile-row imitation-profile-row" key={row.id}>
        <div className="writing-section-head writing-row-heading"><div className="writing-row-title"><input className="writing-row-select" type="checkbox" aria-label={row.title} checked={selectedIds.includes(row.id)} disabled={blocked || !row.body.trim() || (!book.imitationSelection?.ids.includes(row.id) && (book.imitationSelection?.ids.length || 0) >= 30)} onChange={() => toggleProfile(row)}/><h4>{row.title}</h4><span className={`writing-row-badge ${!row.body.trim() ? 'pending' : selectedIds.includes(row.id) ? 'selected' : ''}`}>{tr(!row.body.trim() ? '待分析' : selectedIds.includes(row.id) ? '已选用' : '可选用')}</span></div><div className="writing-row-actions"><Button disabled={blocked} onClick={() => { setError(''); setDraft({ ...row }); }}><PencilSimple size={15}/>{tr('编辑')}</Button><Button variant="primary-soft" disabled={blocked || !row.source.trim()} onClick={() => void props.onAnalyze(row.id)}><Sparkle size={15}/>{tr('分析对标')}</Button><Menu escapeClipping label={tr('更多操作：{0}', { 0: row.title })} trigger={<DotsThree size={19}/>}><button disabled={blocked} aria-label={tr('导出对标：{0}', { 0: row.title })} onClick={() => void perform(async () => { await api('imitation:export', { bookId: book.id, id: row.id }); })}><Export size={15}/>{tr('导出')}</button><span className="menu-divider"/><button disabled={blocked} aria-label={tr('删除对标：{0}', { 0: row.title })} onClick={() => { setError(''); setRemove(row); }}><Trash size={15}/>{tr('删除')}</button></Menu></div></div>
        <p className="writing-row-preview">{row.body || tr('原文已保存，等待独立对标分析。')}</p><p className="writing-row-meta">{row.body.trim() && tr('{0} 字符', { 0: row.body.replace(/\s/g, '').length.toLocaleString() })}{row.body.trim() && row.sourceName && ' · '}{row.sourceName}</p><details><summary>{tr(row.body.trim() ? '查看完整对标档案' : '查看参考原文')}</summary><div className="writing-profile-text">{row.body.trim() ? row.body : row.source}</div>{row.body.trim() && row.source && <details><summary>{tr('查看参考原文')}</summary><div className="writing-profile-text">{row.source}</div></details>}</details>
      </article>)}
      {!!book.imitationTrash?.length && <details className="writing-trash"><summary>{tr('已删除的仿写对标')} · {book.imitationTrash.length}</summary>{book.imitationTrash.map(row => <div className="writing-section-head" key={row.id}><span>{row.title}</span><Button disabled={blocked} onClick={() => void perform(async () => onChanged(await api<Book>('imitation:restore', { bookId: book.id, id: row.id })))}><ArrowCounterClockwise size={14}/>{tr('恢复')}</Button></div>)}</details>}
      {error && !draft && !batch && !remove && <p role="alert" className="error-message">{error}</p>}
    </div>
    {draft && <Modal title={tr('编辑仿写对标')} wide onClose={() => !saving && setDraft(null)}><div className="modal-body writing-profile-editor"><Field label={tr('对标名称')}><input maxLength={120} value={draft.title || ''} onChange={event => setDraft({ ...draft, title: event.target.value })} disabled={saving}/></Field><Field label={tr('仿写参考原文')}><textarea rows={7} value={draft.source || ''} onChange={event => setDraft({ ...draft, source: event.target.value })} disabled={saving}/></Field><Field label={tr('故事对标档案')} hint={tr('用于后续仿写，可保留原作故事信息与仿写建议；与文风档案分开。')}><textarea rows={7} value={draft.body || ''} onChange={event => setDraft({ ...draft, body: event.target.value })} disabled={saving}/></Field>{error && <p role="alert" className="error-message">{error}</p>}</div><div className="modal-footer"><Button disabled={saving} onClick={() => setDraft(null)}>{tr('取消')}</Button><Button disabled={blocked || !draft.source?.trim() || !draft.title?.trim()} onClick={() => void save(true)}>{tr('保存并分析')}</Button><Button variant="primary" busy={saving} disabled={disabled || !draft.title?.trim() || !(draft.body?.trim() || draft.source?.trim())} onClick={() => void save()}>{tr('保存对标')}</Button></div></Modal>}
    {batch && <Modal title={tr('核对仿写参考')} wide onClose={() => !saving && setBatch(null)}><div className="modal-body"><p>{tr('保存为独立对标，原风格档案不变；每篇需要重新分析并采用。')}</p>{!batch.length && <p>{tr('暂无可复制的原文。')}</p>}{batch.map((row, index) => <div className="writing-batch-row" key={index}><div className="writing-section-head"><strong>{row.name}</strong><Button disabled={saving} onClick={() => setBatch(batch.filter((_, i) => i !== index))}>{tr('移除')}</Button></div>{row.error ? <p role="alert">{row.error}</p> : <><Field label={tr('对标名称')}><input maxLength={120} disabled={saving} value={row.title} onChange={event => setBatch(batch.map((item, i) => i === index ? { ...item, title: event.target.value } : item))}/></Field><details><summary>{tr('查看参考原文')}</summary><div className="writing-profile-text">{row.body}</div></details></>}</div>)}{error && <p role="alert" className="error-message">{error}</p>}</div><div className="modal-footer"><Button disabled={saving} onClick={() => setBatch(null)}>{tr('取消')}</Button><Button variant="primary" busy={saving} disabled={disabled || !batch.some(row => !row.error) || batch.some(row => !row.error && !row.title.trim())} onClick={() => void perform(async () => { onChanged(await api<Book>('imitation:import-batch', { bookId: book.id, sources: batch.filter(row => !row.error) })); setBatch(null); showProfiles(); })}>{tr('保存有效对标')}</Button></div></Modal>}
    {remove && <Modal title={tr('删除仿写对标？')} onClose={() => !saving && setRemove(null)}><div className="modal-body"><p>{remove.title}</p><p>{tr('移入已删除对标并取消引用，不改变风格资料与正文。')}</p>{error && <p role="alert">{error}</p>}</div><div className="modal-footer"><Button disabled={saving} onClick={() => setRemove(null)}>{tr('取消')}</Button><Button variant="danger" busy={saving} onClick={() => void perform(async () => { onChanged(await api<Book>('imitation:delete', { bookId: book.id, id: remove.id, revision: remove.revision })); setRemove(null); })}>{tr('删除')}</Button></div></Modal>}
  </section>;
}
