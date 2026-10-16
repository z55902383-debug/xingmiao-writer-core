import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { WritingProfile, WritingSelection } from './types';
import { normalizeWeights, reselectWeights } from '../electron/style-weights.mjs';
import { tr } from './i18n';
import { Button } from './ui';
import './style-blend.css';

const colors = ['#87b7f2', '#bc9bea', '#efa36b', '#74c6b2', '#e28fab', '#bacb77'];
export function selectStyles(selection: WritingSelection, ids: string[]): WritingSelection {
  return { ...selection, styleIds: ids, styleWeights: reselectWeights(ids, selection.styleIds, selection.styleWeights) };
}

export default function StyleBlend({ profiles, selection, disabled, onChange, previewWeights, onPreview, heading, actions, compact = false, label }: {
  profiles: WritingProfile[]; selection: WritingSelection; disabled: boolean;
  onChange: (selection: WritingSelection) => Promise<void>;
  previewWeights?: Record<string, number> | null;
  onPreview?: (weights: Record<string, number> | null) => void;
  heading?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  label?: string;
}) {
  const ids = selection.styleIds;
  const rows = ids.map(id => profiles.find(row => row.id === id)).filter((row): row is WritingProfile => !!row);
  const saved = normalizeWeights(ids, selection.styleWeights);
  const displayed = previewWeights && ids.every(id => id in previewWeights) ? normalizeWeights(ids, previewWeights) : saved;
  const signature = JSON.stringify(displayed);
  const [weights, setWeights] = useState(saved);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; weights: Record<string, number> } | null>(null);
  const latest = useRef(weights);
  const blocked = disabled || pending;
  useEffect(() => { if (!drag.current) { setWeights(displayed); latest.current = displayed; } }, [signature, disabled]);
  useEffect(() => () => { if (drag.current) onPreview?.(null); }, [onPreview]);
  function update(value: Record<string, number>) { latest.current = value; setWeights(value); }
  async function commit(value: Record<string, number>) {
    if (blocked) return;
    setPending(true); setError(''); update(value);
    onPreview?.(value);
    try { await onChange({ ...selection, styleWeights: value }); }
    catch (e) { setError((e as Error).message); update(saved); }
    finally { setPending(false); onPreview?.(null); }
  }
  function boundary(index: number, value: number, base = weights) {
    const left = ids.slice(0, index).reduce((sum, id) => sum + base[id], 0);
    const pair = base[ids[index]] + base[ids[index + 1]];
    const next = Math.max(0, Math.min(pair, Math.round(value - left)));
    return { ...base, [ids[index]]: next, [ids[index + 1]]: pair - next };
  }
  function setShare(id: string, amount: number) {
    if (!Number.isFinite(amount) || rows.length < 2) return;
    const value = Math.max(0, Math.min(100, Math.round(amount)));
    const otherIds = ids.filter(key => key !== id);
    const shares = normalizeWeights(otherIds, weights);
    // Allocate the remainder directly so a 0% row stays selected but isn't sent.
    const raw = otherIds.map(key => shares[key] * (100 - value) / 100);
    const allocated = raw.map(Math.floor);
    const remaining = 100 - value - allocated.reduce((a, b) => a + b, 0);
    const order = raw.map((n, i) => ({ i, fraction: n - allocated[i] })).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
    for (let i = 0; i < remaining; i++) allocated[order[i].i]++;
    void commit({ [id]: value, ...Object.fromEntries(otherIds.map((key, i) => [key, allocated[i]])) });
  }
  if (!rows.length) return <p className="writing-help">{tr('选择已蒸馏或填写的风格后，可调整本书参考占比。')}</p>;
  return <section className={`style-blend${compact ? ' is-compact' : ''}`} aria-label={label || tr('本书风格融合')} aria-busy={pending}>
    <div className="style-blend-heading">{heading || <strong>{tr('参考占比')}</strong>}<div className="style-blend-actions">{rows.length > 1 && <Button variant="ghost" disabled={blocked} onClick={() => void commit(normalizeWeights(ids))}>{tr('平均分配')}</Button>}{actions}</div></div>
    <div className="style-blend-track" ref={track}>
      {rows.map((row, i) => <span key={row.id} className="style-blend-segment" style={{ width: `${weights[row.id] || 0}%`, background: colors[i % colors.length] }} title={`${row.title} ${weights[row.id] || 0}%`}/>)}
      {rows.slice(0, -1).map((row, index) => {
        const value = ids.slice(0, index + 1).reduce((sum, id) => sum + (weights[id] || 0), 0);
        const min = ids.slice(0, index).reduce((sum, id) => sum + (weights[id] || 0), 0);
        const max = min + (weights[row.id] || 0) + (weights[ids[index + 1]] || 0);
        return <button type="button" key={row.id} className="style-blend-handle" role="slider" aria-label={tr('调整 {0} 与 {1} 的占比', { 0: row.title, 1: rows[index + 1].title })} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${row.title} ${weights[row.id]}%, ${rows[index + 1].title} ${weights[ids[index + 1]]}%`} disabled={blocked || max === min} style={{ left: `${value}%`, zIndex: max > min ? 2 : 1 }}
          onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { index, weights }; }}
          onPointerMove={event => { if (!drag.current || blocked || !track.current) return; const rect = track.current.getBoundingClientRect(); const next = boundary(index, (event.clientX - rect.left) / rect.width * 100, drag.current.weights); update(next); onPreview?.(next); }}
          onPointerUp={event => { if (!drag.current) return; drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); void commit(latest.current); }}
          onPointerCancel={() => { drag.current = null; update(saved); onPreview?.(null); }}
          onLostPointerCapture={() => { if (drag.current) { drag.current = null; update(saved); onPreview?.(null); } }}
          onKeyDown={event => { const deltas: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }; if (event.key in deltas || ['Home', 'End'].includes(event.key)) { event.preventDefault(); void commit(boundary(index, event.key === 'Home' ? min : event.key === 'End' ? max : value + deltas[event.key])); } }} />;
      })}
    </div>
    <div className="style-blend-legend">{rows.map((row, i) => <label key={row.id}><i style={{ background: colors[i % colors.length] }}/><span title={row.title}>{row.title}</span><input key={`${row.id}:${weights[row.id]}`} type="number" min={0} max={100} step={1} disabled={blocked || rows.length === 1} defaultValue={weights[row.id] || 0} aria-label={tr('{0} 参考占比', { 0: row.title })} onBlur={event => { const raw = Number(event.currentTarget.value); if (event.currentTarget.value === '' || !Number.isFinite(raw)) { event.currentTarget.value = String(weights[row.id]); return; } const value = Math.max(0, Math.min(100, Math.round(raw))); event.currentTarget.value = String(value); if (value !== weights[row.id]) setShare(row.id, value); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}/><small>%</small></label>)}</div>
    {!compact && rows.length > 1 && <p className="writing-help">{tr('拖动分隔点或输入百分比；0%不参与生成。')}</p>}
    {!compact && rows.length === 1 && <p className="writing-help">{tr('当前风格占100%；再选一种风格即可拖动分隔点融合。')}</p>}
    {pending && <p role="status" className="writing-help">{tr('正在保存占比…')}</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
  </section>;
}
