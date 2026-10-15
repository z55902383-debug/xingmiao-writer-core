import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { tr } from './i18n';
import { Button, Field, Modal } from './ui';
import type { Book, Chapter, Job, WritingCard } from './types';
import { checkProse } from '../electron/prose-check.mjs';
import './author-tools.css';

export function ProseReview({ job }: { job: Job }) {
  const key = `xm-prose-ignore:${job.id}`;
  const [ignored, setIgnored] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } });
  const findings = useMemo(() => checkProse(job.output), [job.output]);
  if (job.status === 'running' || !job.output || !['write', 'continue', 'polish'].includes(job.kind)) return null;
  const visible = findings.filter(row => !ignored.includes(row.id));
  const save = (ids: string[]) => { setIgnored(ids); try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* Reading remains available. */ } };
  return <details className="prose-review"><summary>{tr('本地正文检查')} · {visible.length ? tr('{0} 处待核对', { 0: visible.length }) : tr('未发现规则命中')}</summary>
    <p>{tr('只提示可定位的文本问题，不判定作品质量，也不自动改稿。')}</p>
    {visible.map(row => <article key={row.id}>
      <strong>{tr('第 {0} 行', { 0: row.line })} · {tr(row.message)}</strong><blockquote>{row.excerpt}</blockquote>
      <div className="author-tool-actions"><Button onClick={() => {
        const node = document.querySelector(`[data-prose-id="${CSS.escape(job.id)}"]`);
        if (!node?.firstChild || node.textContent !== job.output) return;
        const range = document.createRange(); range.setStart(node.firstChild, row.start); range.setEnd(node.firstChild, row.end);
        const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
        node.scrollIntoView({ block: 'nearest' });
        const rect = range.getBoundingClientRect(), container = node.getBoundingClientRect();
        (node as HTMLElement).scrollTop += rect.top - container.top - container.height / 2;
      }}>{tr('定位原文')}</Button><Button onClick={() => save([...ignored, row.id])}>{tr('忽略此处')}</Button></div>
    </article>)}
    {!!ignored.length && <Button onClick={() => save([])}>{tr('恢复已忽略项')}</Button>}
  </details>;
}

export function WritingCardEditor({ chapter, book, disabled, onChange, defaultOpen = false }: { chapter: Chapter; book: Book; disabled: boolean; onChange: (card: WritingCard) => void; defaultOpen?: boolean }) {
  const card = chapter.writingCard || { must: '', avoid: '', knowledge: '', stop: '' };
  return <details className="writing-card" open={defaultOpen}><summary>{tr('本章写前卡')} · {tr('目标、边界与停笔点')}</summary>
    <div className="writing-card-intro">
    <p>{tr('空项不限制自由创作；填写后随本章保存，并用于正文生成。')}</p>
    <Button disabled={disabled} onClick={() => {
      const outline = chapter.outline || chapter.summary || '';
      const stop = outline.match(/(?:停笔点|章末|结尾)[：:]([^\n]+)/)?.[1] || '';
      const knowledge = book.characters.filter(c => (!c.introducedOrder || c.introducedOrder <= chapter.order) && (!c.knowledgeFromChapterId || (book.chapters.find(row => row.id === c.knowledgeFromChapterId)?.order ?? Infinity) <= chapter.order)).filter(c => c.characterKnown || c.readerKnown).map(c => `${c.name}：${c.characterKnown || ''}；读者已知：${c.readerKnown || ''}`).join('\n');
      onChange({ must: card.must || outline.slice(0, 12000), avoid: card.avoid, knowledge: card.knowledge || knowledge.slice(0, 12000), stop: card.stop || stop.slice(0, 12000) });
    }}>{tr('从已有细纲整理空项')}</Button>
    </div>
    {(['must', 'avoid', 'knowledge', 'stop'] as const).map((field, i) => <Field key={field} label={tr(['本章必须发生', '本章禁止发生', '人物与读者知情边界', '写到哪里停'][i])}><textarea rows={2} maxLength={12000} disabled={disabled} value={card[field]} onChange={e => onChange({ ...card, [field]: e.target.value })}/></Field>)}
  </details>;
}

type ParsedChapter = { index: number; title: string; body: string; words: number; possiblePartial: boolean };
export function ManuscriptImport({ onClose, onCreated }: { onClose: () => void; onCreated: (book: Book) => void }) {
  const [content, setContent] = useState(''), [title, setTitle] = useState(''), [sourceName, setSourceName] = useState('粘贴书稿');
  const [chapters, setChapters] = useState<ParsedChapter[]>([]), [finalIndexes, setFinalIndexes] = useState<number[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [mode, setMode] = useState('long');
  const action = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <Modal title={tr('导入已有书稿')} wide onClose={() => !busy && onClose()}>
    <div className="modal-body author-tools">
      <p>{tr('先预览章节并核对完整章节。导入创建新作品，原始书稿随备份保存；末章残稿可继续写。')}</p>
      <div className="author-tool-actions"><Button disabled={busy} onClick={() => void action(async () => {
        const source = await api<{ content: string; sourceName: string } | null>('craft:read');
        if (source) { setContent(source.content); setSourceName(source.sourceName); setTitle(source.sourceName.replace(/\.(txt|md)$/i, '').slice(0, 120)); setChapters([]); }
      })}>{tr('选择 TXT 或 Markdown')}</Button></div>
      <Field label={tr('导入书名')}><input value={title} maxLength={120} disabled={busy} onChange={e => setTitle(e.target.value)}/></Field>
      <Field label={tr('创作篇幅')}><select value={mode} disabled={busy} onChange={e => setMode(e.target.value)}><option value="long">{tr('长篇')}</option><option value="short">{tr('短篇')}</option></select></Field>
      <Field label={tr('原始书稿')}><textarea rows={6} value={content} disabled={busy} onChange={e => { setContent(e.target.value); setChapters([]); }}/></Field>
      <Button disabled={busy || !content.trim()} onClick={() => void action(async () => {
        const rows = await api<ParsedChapter[]>('craft:parse', { content }); setChapters(rows); setFinalIndexes(rows.filter(c => !c.possiblePartial && c.body.trim()).map(c => c.index));
      })}>{tr('预览章节切分')}</Button>
      {!!chapters.length && <><p>{tr('识别到 {0} 章；勾选表示作者确认本章完整并定稿，未勾选保留为草稿。', { 0: chapters.length })}</p>
        <div className="author-tool-list">{chapters.map(c => <details key={c.index}><summary>{c.title} · {c.words}{tr('字')}{c.possiblePartial ? ` · ${tr('请核对是否残稿')}` : ''}</summary><label><input type="checkbox" disabled={busy || !c.body.trim()} checked={finalIndexes.includes(c.index)} onChange={e => setFinalIndexes(e.target.checked ? [...finalIndexes, c.index] : finalIndexes.filter(i => i !== c.index))}/>{tr('确认本章完整并定稿')}</label><pre>{c.body}</pre></details>)}</div>
        <Button variant="primary" disabled={busy || !title.trim()} onClick={() => void action(async () => onCreated(await api<Book>('craft:import', { content, title, sourceName, finalIndexes, creationMode: mode })))}>{tr('创建可续写作品')}</Button>
        <p>{tr('导入后可在“素材与复核”中分批重建人物、事实和伏笔，采用前逐项核对。')}</p></>}
      {error && <p role="alert">{error}</p>}
    </div>
  </Modal>;
}

type CraftRow = { id: string; kind?: string; title?: string; method?: string; useWhen?: string; subject?: string; value?: string; relation?: string; evidence: string };
type CraftRun = { id: string; kind: string; chapterId?: string; status: string; sourceName: string; error?: string; raw: string; rows: CraftRow[]; appliedIds: string[]; retired?: boolean };
type ImpactRow = { dependents: { id: string; title: string; revision: number; sourceRevision: number }[]; chapterId: string; title: string; status: string; memories: { id: string; subject: string; relation: string; object: string; evidence: string }[]; events: { id: string; title: string; value: string; evidence: string }[]; candidates: { id: string; kind: string; title: string; chapterId: string }[] };

export function AuthorToolsPanel({ book, flush, onChange, onOpenChapter, onClose }: { book: Book; flush: () => Promise<unknown>; onChange: (book: Book) => void; onOpenChapter: (id: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState('facts'), [source, setSource] = useState(''), [sourceName, setSourceName] = useState('参考原文');
  const [runs, setRuns] = useState<CraftRun[]>([]), [impact, setImpact] = useState<ImpactRow[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [selectedChapters, setSelectedChapters] = useState<string[]>([]), [selected, setSelected] = useState<Record<string, string[]>>({}), [query, setQuery] = useState('');
  const [retire, setRetire] = useState(''), [progress, setProgress] = useState('');
  const [techniquePending, setTechniquePending] = useState<Record<string, boolean>>({});
  const refresh = async () => { const [r, i] = await Promise.all([api<CraftRun[]>('craft:runs', { bookId: book.id }), api<ImpactRow[]>('craft:impact', { bookId: book.id })]); setRuns(r); setImpact(i); };
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [book.id]);
  const action = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await flush(); await fn(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); setProgress(''); } };
  const analyzeFacts = async (ids: string[]) => {
    for (let index = 0; index < ids.length; index++) {
      const chapter = book.chapters.find(c => c.id === ids[index]);
      setProgress(tr('正在分析 {0}（{1}/{2}）', { 0: chapter?.title || '', 1: index + 1, 2: ids.length }));
      const run = await api<CraftRun>('craft:analyze', { bookId: book.id, chapterId: ids[index], kind: 'facts' });
      setRuns(old => [run, ...old.filter(r => r.id !== run.id)]);
      if (run.status !== 'ready') throw Error(run.error || tr('分析未完成，已保留结果'));
    }
  };
  const toggleRow = (run: CraftRun, id: string, checked: boolean) => setSelected(old => ({ ...old, [run.id]: checked ? [...(old[run.id] || []), id] : (old[run.id] || []).filter(v => v !== id) }));
  return <Modal title={tr('素材与复核')} wide onClose={() => !busy && onClose()}><div className="modal-body author-tools">
    <div className="author-tool-tabs" role="tablist" aria-label={tr('创作工具')}>
      {['facts', 'techniques', 'impact'].map((id, index) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{tr(['资料重建', '拆文素材', '改稿影响'][index])}</button>)}
    </div>
    {tab === 'facts' && <><p>{tr('只分析作者已定稿正文。每批最多5章，逐章保存进度；失败或停止后可取消已完成章节再继续。原文证据核对通过后，才可采用资料。')}</p>
      <div className="author-tool-list">{book.chapters.filter(c => c.body.trim()).map(c => <label key={c.id}><input type="checkbox" checked={selectedChapters.includes(c.id)} disabled={busy || c.status !== 'final'} onChange={e => setSelectedChapters(e.target.checked ? [...selectedChapters, c.id] : selectedChapters.filter(id => id !== c.id))}/>{c.title} · {tr(c.status === 'final' ? '已定稿' : '草稿，需先核对定稿')}</label>)}</div>
      <Button disabled={busy || !selectedChapters.length || selectedChapters.length > 5} onClick={() => void action(() => analyzeFacts(selectedChapters))}>{tr('分析选中章节')} · {selectedChapters.length}/5</Button>
    </>}
    {tab === 'techniques' && <><p>{tr('从参考原文提炼写法，保存证据和适用条件。采用后默认不启用，勾选才用于正文生成。')}</p>
      <Field label={tr('参考作品或来源名称')}><input disabled={busy} value={sourceName} maxLength={240} onChange={e => setSourceName(e.target.value)}/></Field>
      <Field label={tr('拆文原文')}><textarea disabled={busy} rows={5} value={source} onChange={e => setSource(e.target.value)}/></Field>
      <Button disabled={busy || !source.trim()} onClick={() => void action(async () => { const run = await api<CraftRun>('craft:analyze', { bookId: book.id, kind: 'techniques', source, sourceName }); if (run.status !== 'ready') throw Error(run.error || '分析未完成'); })}>{tr('提炼可复用技法')}</Button>
      <Field label={tr('搜索拆文素材')}><input value={query} onChange={e => setQuery(e.target.value)}/></Field>
      {(book.techniques || []).filter(row => `${row.title} ${row.method} ${row.sourceName}`.includes(query)).map(row => <details key={row.id}><summary>{row.title} · {row.sourceName}</summary>
        <p>{row.method}</p><p>{tr('适用条件')}：{row.useWhen}</p><blockquote>{row.evidence}</blockquote>
        <label><input type="checkbox" disabled={busy} checked={techniquePending[row.id] ?? row.enabled} onChange={e => { const enabled = e.target.checked; setTechniquePending(old => ({ ...old, [row.id]: enabled })); void action(async () => onChange(await api<Book>('book:update', { id: book.id, patch: { techniques: (book.techniques || []).map(t => t.id === row.id ? { ...t, enabled } : t) } }))).finally(() => setTechniquePending(old => { const next = { ...old }; delete next[row.id]; return next; })); }}/>{tr('用于本书正文生成')}</label>
        <Field label={tr('作者笔记')}><textarea defaultValue={row.note} disabled={busy} onBlur={e => { const note = e.target.value; if (note !== row.note) void action(async () => onChange(await api<Book>('book:update', { id: book.id, patch: { techniques: (book.techniques || []).map(t => t.id === row.id ? { ...t, note } : t) } }))); }}/></Field>
        <details><summary>{tr('查看来源原文')}</summary><pre>{row.source}</pre></details>
        <Button disabled={busy} onClick={() => void action(async () => onChange(await api<Book>('book:update', { id: book.id, patch: { techniques: (book.techniques || []).filter(t => t.id !== row.id) } })))}>{tr('移除此素材')}</Button>
      </details>)}
    </>}
    {tab === 'impact' && <><p>{tr('按来源列出待复核记忆、时间线和版本已变化的候选。后续内容属于保守复核范围，不能据此认定剧情一定有错。')}</p>
      <p>{tr('正文引用来源从本次更新后采用的结果开始记录；旧稿和未记录来源的手写内容仍需人工核对。')}</p>
      {!impact.length && <p>{tr('没有待复核资料。没有记录的依赖仍需作者自行核对。')}</p>}
      {impact.map(row => <article key={row.chapterId} className="author-impact"><h3>{row.title}</h3>
        <p>{tr('待复核记忆 {0} · 时间线 {1} · 候选 {2}', { 0: row.memories.length, 1: row.events.length, 2: row.candidates.length })}</p>
        <ul>{row.memories.map(m => <li key={m.id}>{m.subject} · {m.relation} · {m.object}<blockquote>{m.evidence}</blockquote></li>)}{row.events.map(e => <li key={e.id}>{e.title} · {e.value}<blockquote>{e.evidence}</blockquote></li>)}</ul>
        {row.dependents.map(c => <p className="author-related-actions" key={c.id}>{tr("曾引用此前文的正文")}：{c.title} <Button disabled={busy} onClick={() => onOpenChapter(c.id)}>{tr("打开关联章节")}</Button><Button disabled={busy || row.status !== "final"} onClick={() => void action(async () => onChange(await api<Book>("craft:confirm-source", { chapterId: c.id, sourceId: row.chapterId, revision: c.revision, sourceRevision: c.sourceRevision })))}>{tr("已人工核对这条关联")}</Button></p>)}
        {row.candidates.map(j => <p className="author-related-actions" key={j.id}>{tr('关联候选')}：{j.title} <Button disabled={busy} onClick={() => onOpenChapter(j.chapterId)}>{tr('打开关联章节')}</Button></p>)}
        <div className="author-tool-actions"><Button disabled={busy} onClick={() => onOpenChapter(row.chapterId)}>{tr('打开来源章节')}</Button><Button disabled={busy || row.status !== 'final'} onClick={() => void action(() => analyzeFacts([row.chapterId]))}>{tr('重新分析本章资料')}</Button></div>
        {row.status !== 'final' && <p>{tr('先核对正文并定稿，再重新分析。')}</p>}
      </article>)}
    </>}
    {busy && <div role="status"><p>{progress || tr('正在处理，请稍候…')}</p><Button onClick={() => void api('craft:cancel', { bookId: book.id })}>{tr('停止分析')}</Button></div>}
    {error && <p role="alert">{error}</p>}
    <h3>{tr('待核对分析记录')}</h3>
    {runs.filter(run => run.kind === (tab === 'techniques' ? 'techniques' : 'facts')).map(run => <details className="author-analysis-run" key={run.id}><summary>{run.sourceName} · {tr(run.status === 'ready' ? '可核对' : run.status === 'running' ? '上次分析未结束，可重新分析' : '分析未完成')}</summary>
      {run.error && <p role="alert">{run.error}</p>}
      {run.rows.map(row => <label className="author-analysis-row" key={row.id}><input type="checkbox" disabled={busy || run.appliedIds.includes(row.id)} checked={run.appliedIds.includes(row.id) || (selected[run.id] || []).includes(row.id)} onChange={e => toggleRow(run, row.id, e.target.checked)}/><span><strong>{row.title || row.subject}{run.appliedIds.includes(row.id) ? ` · ${tr('已采用')}` : ''}</strong><p>{row.method || row.value}</p>{row.useWhen && <p>{row.useWhen}</p>}<blockquote>{row.evidence}</blockquote></span></label>)}
      {run.status === 'ready' && <div className="author-tool-actions"><Button disabled={busy || !(selected[run.id] || []).length} onClick={() => void action(async () => { onChange(await api<Book>('craft:apply', { id: run.id, ids: selected[run.id] || [] })); setSelected(old => ({ ...old, [run.id]: [] })); })}>{tr('采用勾选资料')}</Button>
        {run.kind === 'facts' && !run.retired && <Button disabled={busy} onClick={() => setRetire(run.id)}>{tr('归档本章旧的过期资料')}</Button>}
      </div>}
      {retire === run.id && <div className="notice"><p>{tr('请先采用需要的新资料。确认后，本章旧的过期记忆与时间线将移入回收站；新分析未覆盖的旧事实也会退出上下文。')}</p><Button disabled={busy} onClick={() => void action(async () => { onChange(await api<Book>('craft:retire', { id: run.id, confirm: true })); setRetire(''); })}>{tr('确认归档旧记录')}</Button><Button onClick={() => setRetire('')}>{tr('取消')}</Button></div>}
      <details><summary>{tr('查看分析原始输出')}</summary><pre>{run.raw}</pre></details>
    </details>)}
    <p>{tr('已采用素材、写前卡和导入原稿随作品备份保存；分析过程记录仅保存在当前书库，不随备份迁移。')}</p>
  </div></Modal>;
}
