import {useEffect,useState} from 'react';
import {api} from './api';
import {tr} from './i18n';
import {Button,Modal} from './ui';
import SyncReview from './SyncReview';
import type {Book,Job} from './types';

export default function ChapterSyncDialog({bookId,chapterId,onClose,onChange,onOpenBook}:{
  bookId:string;chapterId:string;onClose:()=>void;onChange?:(book:Book)=>void;
  onOpenBook?:(book:Book,target:'atlas'|'memory')=>void;
}){
  const [book,setBook]=useState<Book|null>(null),[job,setJob]=useState<Job|null>(null);
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true;
    setBusy(true);setError('');
    void(async()=>{
      try{
        const initial=await api<Book>('book:get',{id:bookId});
        const chapter=initial.chapters.find(c=>c.id===chapterId);
        if(!chapter)throw Error(tr('章节不存在，正文未被修改。'));
        const prepared=await api<{book:Book;job:Job}>('chapter:sync-prepare',{id:chapterId,revision:chapter.revision});
        if(!active)return;
        setBook(prepared.book);setJob(prepared.job);onChange?.(prepared.book);
        if(prepared.job.review?.status==='skipped'){
          setJob({...prepared.job,review:{...prepared.job.review,status:'analyzing'}});
          const result=await api<Book>('sync:analyze',{id:prepared.job.id});
          const current=await api<Job>('chapter:sync-current',{id:chapterId});
          if(active){setBook(result);setJob(current);onChange?.(result);}
        }
      }catch(e){if(active)setError((e as Error).message);}
      finally{if(active)setBusy(false);}
    })();
    return()=>{active=false;};
  },[bookId,chapterId,attempt]);
  const chapter=book?.chapters.find(c=>c.id===chapterId);
  const stale=!!job&&chapter?.revision!==job.review?.revision;
  const complete=!!job&&!stale&&(job.review?.applied||job.review?.status==='empty');
  const update=(value:Book)=>{
    setBook(value);onChange?.(value);
    void api<Job>('chapter:sync-current',{id:chapterId}).then(setJob).catch(e=>setError(e.message));
  };
  return <Modal title={tr('提交章节与同步资料')} wide className="chapter-sync-dialog" onClose={()=>{if(!busy)onClose();}}>
    <div className="modal-body">
      <p><strong>{chapter?.title||tr('正在读取章节…')}</strong></p>
      <p className="feature-help">{tr('正文先保存并定稿，再分析人物、关系、记忆、地点和物品变化；核对后统一同步。分析不会改写正文，会调用当前文字模型。')}</p>
      <ol className="chapter-sync-steps"><li>{chapter?.status==='final'?tr('正文已定稿'):tr('读取已保存正文')}</li><li>{busy?tr('资料分析中'):complete?tr('资料已核对'):tr('等待核对变化')}</li><li>{complete?tr('记忆与蓝图已更新'):tr('确认后更新记忆与蓝图')}</li></ol>
      {job&&chapter&&<SyncReview key={job.id} job={job} chapter={chapter} onChange={update} flush={async()=>{}} onBusyChange={setBusy}/>}
      {error&&<p className="error-box" role="alert">{error}<br/>{tr('已保存的正文不受影响，可稍后重试资料分析。')}</p>}
      {complete&&<p role="status" className="notice">{job?.review?.status==='empty'?tr('本章分析完成，未发现需要新增的资料。'):tr('所选变化已同步到人物、记忆、时间线与蓝图。')}</p>}
    </div>
    <div className="modal-footer">
      {busy&&job&&<Button onClick={()=>void api('ai:cancel',{id:job.id})}>{tr('停止分析')}</Button>}
      {error&&!busy&&<Button onClick={()=>setAttempt(v=>v+1)}>{tr('重试资料分析')}</Button>}
      <Button disabled={busy} onClick={onClose}>{tr('返回写作')}</Button>
      {onOpenBook&&book&&<><Button disabled={busy||!complete} onClick={()=>onOpenBook(book,'memory')}>{tr('查看记忆与关系')}</Button><Button variant="primary" disabled={busy||!complete} onClick={()=>onOpenBook(book,'atlas')}>{tr('查看知识蓝图')}</Button></>}
    </div>
  </Modal>;
}
