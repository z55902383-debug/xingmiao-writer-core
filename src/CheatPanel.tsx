import { useId, useState } from 'react';
import type { Character, CheatConfig, CheatHolder, MemoNote } from './types';
import { Button, Field } from './ui';
import { tr } from './i18n';
import './book-features.css';
const empty: CheatConfig = {enabled:false,name:'',owner:'',ability:'',limits:'',cost:'',growth:'',reveal:'',notes:''};
const details = [['trigger','触发与读取方式'],['limits','限制与失效条件'],['cost','使用代价'],['growth','成长与解锁计划'],['reveal','知情与揭露边界']] as const;
export default function CheatPanel({value,memos=[],characters=[],disabled,onChange}:{value?:CheatConfig;memos?:MemoNote[];characters?:Character[];disabled:boolean;onChange:(value:CheatConfig)=>void}) {
  const config={...empty,...value};
  const characterList=useId();
  const [tab,setTab]=useState('holders');
  const [memoId,setMemoId]=useState('');
  const holders:CheatHolder[]=config.holders ?? (config.owner ? [{id:'legacy-holder',name:config.owner,powerName:config.name,ability:config.ability,trigger:'',limits:config.limits,cost:config.cost,growth:config.growth,reveal:config.reveal}] : []);
  const edit=(key:'name'|'ability'|'limits'|'cost'|'growth'|'reveal'|'notes'|'document',text:string)=>onChange({...config,[key]:text});
  const saveHolders=(next:CheatHolder[])=>onChange({...config,...(config.owner&&!config.holders?{owner:'',ability:'',limits:'',cost:'',growth:'',reveal:''}:{}),holders:next});
  const editHolder=(id:string,key:keyof Omit<CheatHolder,'id'>,text:string)=>saveHolders(holders.map(row=>row.id===id?{...row,[key]:text}:row));
  return <section className="cheat-panel" aria-label={tr('金手指设定')}>
    <label className="cheat-enable"><input type="checkbox" checked={config.enabled} disabled={disabled} onChange={event=>onChange({...config,enabled:event.target.checked})}/><span><strong>{tr('本书启用金手指')}</strong><small>{tr(config.enabled?'已启用：后续规划和创作会参考这份设定。':'未启用：保留填写内容，不发送给生成模型。')}</small></span></label>
    <p className="feature-help">{tr('按本书保存。设定贯穿后续创作，不自动修改已写正文；当前能力状态仍以已确认正文和时间线为准。')}</p>
    <div className="cheat-tabs" role="tablist" aria-label={tr('设定内容')}>{[['holders','多人能力'],['document','完整方案'],['shared','共同规则']].map(([id,label])=><button key={id} role="tab" id={`cheat-tab-${id}`} aria-controls={`cheat-content-${id}`} aria-selected={tab===id} tabIndex={tab===id?0:-1} onKeyDown={event=>{const ids=['holders','document','shared'];const current=ids.indexOf(tab);const next=event.key==='ArrowRight'?ids[(current+1)%3]:event.key==='ArrowLeft'?ids[(current+2)%3]:event.key==='Home'?ids[0]:event.key==='End'?ids[2]:null;if(next){event.preventDefault();setTab(next);document.getElementById(`cheat-tab-${next}`)?.focus();}}} onClick={()=>setTab(id)}>{tr(label)}</button>)}</div>
    <div role="tabpanel" id={`cheat-content-${tab}`} aria-labelledby={`cheat-tab-${tab}`}>
    {tab==='holders'&&<>
      <div className="cheat-toolbar"><p className="feature-help">{tr('每个人可设置不同的金手指名称、能力与边界。持有者可选择本书人物，也可直接输入。')}</p><Button disabled={disabled||holders.length>=30} onClick={()=>saveHolders([...holders,{id:crypto.randomUUID(),name:'',powerName:'',ability:'',trigger:'',limits:'',cost:'',growth:'',reveal:''}])}>{tr('添加持有者')}</Button></div>
      {!holders.length&&<p className="feature-help">{tr('尚未添加持有者。也可以在完整方案中直接粘贴多人设定。')}</p>}
      {holders.map((holder,index)=><fieldset className="cheat-holder" disabled={disabled} key={holder.id}><legend>{tr('持有者')} {index+1}{holder.name?` · ${holder.name}`:''}</legend><div className="cheat-fields">
        <Field label={tr('持有者')}><input list={characterList} maxLength={160} value={holder.name} onChange={event=>editHolder(holder.id,'name',event.target.value)}/></Field>
        <Field label={tr('金手指名称')}><input maxLength={160} value={holder.powerName} onChange={event=>editHolder(holder.id,'powerName',event.target.value)}/></Field>
        <div className="cheat-wide"><Field label={tr('核心能力与作用')}><textarea rows={3} maxLength={30000} value={holder.ability} onChange={event=>editHolder(holder.id,'ability',event.target.value)}/></Field></div>
      </div><details className="cheat-holder-details"><summary>{tr('限制、代价与成长边界')}</summary><div className="cheat-fields">{details.map(([key,label])=><Field key={key} label={tr(label)}><textarea rows={3} maxLength={30000} value={holder[key]} onChange={event=>editHolder(holder.id,key,event.target.value)}/></Field>)}</div></details>
      <Button onClick={()=>saveHolders(holders.filter(row=>row.id!==holder.id))}>{tr('移除此持有者')}</Button></fieldset>)}
    </>}
    {tab==='document'&&<><p className="feature-help">{tr('保存完整 Markdown 方案，保留标题、表格与可选发散。备选机制不会自动成为既定规则，未来阶段不等于当前能力。')}</p>
      <Field label={tr('完整金手指方案')}><textarea className="cheat-document" disabled={disabled} rows={18} maxLength={300000} value={config.document||''} onChange={event=>edit('document',event.target.value)}/></Field>
      <div className="cheat-toolbar"><Field label={tr('从本书备忘录导入')}><select value={memoId} disabled={disabled} onChange={event=>setMemoId(event.target.value)}><option value="">{tr('选择备忘录')}</option>{memos.map(memo=><option key={memo.id} value={memo.id}>{memo.title}</option>)}</select></Field><Button disabled={disabled||!memoId||!!config.document} onClick={()=>{const memo=memos.find(row=>row.id===memoId);if(memo)edit('document',memo.content);}}>{tr('导入完整方案')}</Button></div>
      <p className="feature-help">{tr('导入保留全文，不自动启用；已有方案时请先自行整理或清空，避免覆盖。')}</p>
    </>}
    {tab==='shared'&&<><Field label={tr('方案名称（可选）')} hint={tr('仅用于整理整份方案，不是所有人的金手指名称。')}><input disabled={disabled} value={config.name} maxLength={160} onChange={event=>edit('name',event.target.value)}/></Field><p className="feature-help">{tr('共同规则适用于整套金手指；个人能力请在多人能力中填写。已确认规则优先于完整方案中的备选建议。')}</p><fieldset className="cheat-fields" disabled={disabled}>{([['ability','核心能力与作用'],['limits','限制与失效条件'],['cost','使用代价'],['growth','成长与解锁计划'],['reveal','知情与揭露边界'],['notes','贯穿全书的补充约束']] as const).map(([key,label])=><Field key={key} label={tr(label)}><textarea rows={3} maxLength={30000} value={config.owner&&!config.holders&&key!=='notes'?'':config[key]} onChange={event=>onChange({...config,...(config.owner&&!config.holders?{owner:'',ability:'',limits:'',cost:'',growth:'',reveal:'',holders}:{}),[key]:event.target.value})}/></Field>)}</fieldset></>}
    </div>
    <datalist id={characterList}>{characters.map(character=><option key={character.id} value={character.name}/>)}</datalist>
  </section>;
}
