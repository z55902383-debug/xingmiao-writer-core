import {useEffect,useState} from 'react';
import {api} from './api';
import {tr} from './i18n';
import {Button} from './ui';
import type {Book,Job} from './types';

export default function ChapterSyncStatus({book,chapterId,onReview}:{book:Book;chapterId:string;onReview?:(id:string)=>void}){
  const [job,setJob]=useState<Job|null>(null),[error,setError]=useState('');
  const chapter=book.chapters.find(c=>c.id===chapterId);
  useEffect(()=>{
    let active=true;setJob(null);setError('');
    if(chapterId)void api<Job|null>('chapter:sync-current',{id:chapterId}).then(value=>{if(active)setJob(value);}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[book.id,chapterId,chapter?.revision,book.updatedAt,book.candidates]);
  if(!chapter)return null;
  const record=job||book.candidates.find(candidate=>candidate.chapterId===chapterId&&candidate.adopted&&candidate.review?.revision===chapter.revision);
  const stale=!!record&&record.review?.revision!==undefined&&record.review.revision!==chapter.revision;
  const status=stale?'正文已修改，资料待重新分析':record?.review?.status==='analyzing'?'本章资料分析中':record?.review?.applied?'本章所选变化已同步':record?.review?.status==='empty'?'本章已核对，无新增变化':record?.review?.status==='ready'?'本章变化待核对':record?.review?.status==='error'?'资料分析未完成，可重试':'本章尚未核对资料';
  return <div className="ka-sync-status"><span role="status">{tr(status)}</span>{error&&<span title={error}>{tr('同步状态暂不可用')}</span>}{onReview&&<Button onClick={()=>onReview(chapterId)}>{tr('核对本章资料')}</Button>}</div>;
}
