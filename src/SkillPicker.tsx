import { useId, useState } from 'react';
import { CaretDown, Check, PuzzlePiece } from '@phosphor-icons/react';
import { Button, Field } from './ui';
import { tr } from './i18n';
import type { Skill, Kind } from './types';
import './skill-library.css';

export default function SkillPicker({ skills, kind, ids, onChoose, onManage, disabled, loading, error, onRetry, sourceOnly, open, onToggle }: {
  skills: Skill[]; kind: Kind; ids?: string[]; onChoose: (ids?: string[]) => void; onManage: () => void;
  disabled: boolean; loading: boolean; error: string; onRetry: () => void; sourceOnly: boolean;
  open: boolean; onToggle: () => void;
}) {
  const [query, setQuery] = useState(''), [onlySelected, setOnlySelected] = useState(false);
  const optionsId = useId();
  const selected = ids ?? skills.filter(skill => skill.enabled && skill.tasks.includes(kind)).map(skill => skill.id!);
  const applicable = skills.filter(skill => skill.tasks.includes(kind));
  const active = applicable.filter(skill => selected.includes(skill.id!));
  const missing = (ids || []).filter(id => !skills.some(skill => skill.id === id));
  const rows = applicable.filter(skill => (!onlySelected || selected.includes(skill.id!)) && `${skill.name} ${skill.description} ${skill.source || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => Number(selected.includes(b.id!)) - Number(selected.includes(a.id!)));
  return <section className={`writing-picker skill-picker reference-disclosure${open ? ' is-open' : ''}`} aria-label={tr('本次写作 Skill')}>
    <button type="button" className="writing-picker-toggle disclosure-toggle" aria-expanded={open} aria-controls={optionsId} onClick={onToggle}>
      <span className="disclosure-icon"><PuzzlePiece size={20}/></span><span className="disclosure-copy"><strong>{tr('选择本次 Skill 与提示词')}</strong><small>{tr('当前任务适用 {0} 项', { 0: sourceOnly ? 0 : active.length })}</small></span><span className="disclosure-action">{tr(open ? '收起' : '展开')}<CaretDown size={14}/></span>
    </button>
    <p className="writing-picker-intro">{tr(sourceOnly ? '蒸馏只分析目标原文，不使用写作 Skill。' : 'Skill 规定怎么执行任务；风格与要求规定怎么写。')}</p>
    {!sourceOnly && active.length > 0 && <div className="writing-selected-preview">{active.slice(0, 2).map(skill => <span key={skill.id}><Check size={12}/><span title={skill.name}>{skill.name}</span></span>)}{active.length > 2 && <span>{tr('另 {0} 项', { 0: active.length - 2 })}</span>}</div>}
    {loading && <p role="status" className="muted">{tr('正在读取 Skill…')}</p>}
    {error && <div className="error-box" role="alert">{error}<Button onClick={onRetry}>{tr('重新读取 Skill')}</Button></div>}
    {!loading && missing.length > 0 && <p className="error-box" role="alert">{tr('部分所选 Skill 已删除，请重新选择或恢复默认。')}<Button onClick={() => onChoose(undefined)}>{tr('恢复默认启用')}</Button></p>}
    {open && <div id={optionsId} className="writing-picker-options">
      <div className="writing-section-head"><strong>{tr('当前任务可用')}</strong><Button variant="ghost" onClick={onManage}>{tr('管理写作 Skill')}</Button></div>
      {!sourceOnly && <>
        <p className="muted">{tr('适用且已启用的条目默认全部开启，各功能分别记住开关，新添加条目自动接入。')}</p>
        <Field label={tr('搜索 Skill 名称或说明')}><input type="search" value={query} onChange={event => setQuery(event.target.value)}/></Field>
        <div className="skill-choice-actions"><label className="writing-selected-filter"><input type="checkbox" checked={onlySelected} onChange={event => setOnlySelected(event.target.checked)}/>{tr('只看已选')}</label><Button variant="ghost" disabled={disabled || loading} onClick={() => onChoose([])}>{tr('本次不使用 Skill')}</Button><Button variant="ghost" disabled={disabled || loading} onClick={() => onChoose(undefined)}>{tr('恢复默认启用')}</Button></div>
        <fieldset disabled={disabled || loading || !!error} className="skill-choice-field"><legend>{tr('已选 {0}/{1}', { 0: active.length, 1: applicable.length })}</legend>
          <div className="writing-choice-list">{rows.map(skill => <div className={`writing-choice ${selected.includes(skill.id!) ? 'is-selected' : ''}`} key={skill.id}>
            <label><input type="checkbox" aria-label={tr('本次使用 {0}', { 0: skill.name })} checked={selected.includes(skill.id!)} onChange={event => onChoose(event.target.checked ? [...selected, skill.id!] : selected.filter(id => id !== skill.id))}/><span>{skill.name}<small>{skill.instructionKind === 'prompt' ? tr('提示词') : 'Skill'}</small></span></label>
            <small>{skill.description}</small><details><summary>{tr('查看完整指令')}</summary><div className="writing-profile-text">{skill.body}</div></details>
          </div>)}</div>
          {!rows.length && <p className="muted">{tr(!applicable.length ? '当前任务暂无适用 Skill，可在管理页新增或调整适用任务。' : '没有匹配的条目，可清除搜索或取消只看已选。')}</p>}
        </fieldset>
      </>}
    </div>}
  </section>;
}
