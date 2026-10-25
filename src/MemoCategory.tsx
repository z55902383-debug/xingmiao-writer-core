import { useId } from 'react';
import { MEMO_CATEGORIES, memoCategory } from '../electron/memo-metadata.mjs';
import { tr } from './i18n';
import { Field } from './ui';
import type { MemoNote } from './types';
import './book-features.css';
export function MemoCategoryInput({value,onChange,disabled=false}:{value?:string;onChange:(value:string)=>void;disabled?:boolean}){
  const id=useId();
  return <><Field label={tr('备忘录分类')}><input list={id} maxLength={40} value={value || ''} disabled={disabled} placeholder={tr('选择或输入分类')} onChange={event=>onChange(event.target.value)}/></Field><datalist id={id}>{MEMO_CATEGORIES.map(category=><option value={category} key={category}>{tr(category)}</option>)}</datalist></>;
}
export function MemoCategoryFilter({notes,value,onChange,disabled=false}:{notes:MemoNote[];value:string;onChange:(value:string)=>void;disabled?:boolean}){
  const categories=[...new Set(notes.map(memoCategory))];
  return <Field label={tr('筛选备忘录分类')}><select value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}><option value="">{tr('全部分类')}</option>{[...new Set([...categories,...(value===''?[]:[value])])].map(category=><option key={category} value={category}>{tr(category)}</option>)}</select></Field>;
}
