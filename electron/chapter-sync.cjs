const {randomUUID}=require('node:crypto');
const {hash}=require('./sync-review.cjs');
const {contextSignature}=require('./timeline.cjs');
const prefix='chapter-sync:';
function isChapterSync(id){return typeof id==='string'&&id.startsWith(prefix);}
function read(store,id){
  const job=store.setting(id,null);
  if(!isChapterSync(id)||!job||job.id!==id||!job.chapterSync)throw Error('章节同步记录不存在，请重新提交');
  const chapter=store.chapter(job.chapterId);
  if(chapter.bookId!==job.bookId||chapter.deletedAt||store.rawBook(job.bookId).deletedAt)throw Error('请先恢复作品和章节');
  return job;
}
function current(store,chapterId,runningIds=new Set()){
  const chapter=store.chapter(chapterId),id=store.setting(prefix+'active:'+chapter.id,'');
  if(!id)return null;
  const job=read(store,id);
  if(job.review?.status==='analyzing'&&!runningIds.has(id)){
    job.review={...job.review,status:'error',error:'上次资料分析已中断，正文已保留，请重试'};
    store.putSetting(id,job);
  }
  return job;
}
function prepare(store,input,runningIds=new Set()){
  return store.transaction(()=>{
    let chapter=store.chapter(input.id),book=store.book(chapter.bookId);
    if(chapter.deletedAt||book.deletedAt||book.archived)throw Error('请先恢复作品和章节');
    if(chapter.revision!==input.revision)throw Error('正文版本已变化，请先保存最新正文再提交');
    if(!chapter.body.trim())throw Error('空章节不能提交');
    if(chapter.status!=='final')chapter=store.finalize(chapter.id,chapter.revision);
    book=store.book(book.id);
    const previous=current(store,chapter.id,runningIds),bodyHash=hash(chapter.body),signature=contextSignature(book,chapter);
    if(previous&&previous.review?.revision===chapter.revision&&previous.review?.bodyHash===bodyHash&&
      (previous.review.applied||previous.review.status==='empty'||previous.review.signature===signature))return {book,job:previous};
    const id=prefix+randomUUID();
    const job={id,chapterSync:true,bookId:book.id,chapterId:chapter.id,kind:'write',instruction:'核对已提交章节，不生成或覆盖正文',output:'',status:'done',error:'',adopted:true,baseRevision:chapter.revision,createdAt:new Date().toISOString(),targetLabel:chapter.title,
      context:{warnings:[],memoryCount:0,chapterCount:0,characterCount:book.characters.length,characters:book.characters.length},
      review:{status:'skipped',revision:chapter.revision,bodyHash,signature}};
    store.putSetting(id,job);store.putSetting(prefix+'active:'+chapter.id,id);
    return {book,job};
  });
}
// Reuse the same evidence checks and transaction as AI prose reviews without
// inserting a hand-written submission into generated-candidate history.
function adapter(store){
  const proxy=Object.create(store);
  proxy.job=id=>read(store,id);
  proxy.putJob=job=>store.putSetting(job.id,job);
  return proxy;
}
function apply(store,input){
  const job=read(store,input.id),chapter=store.chapter(job.chapterId);
  if(job.review?.applied){
    if(chapter.revision!==job.review.revision||hash(chapter.body)!==job.review.bodyHash)throw Error('正文已修改，请重新分析');
    return store.book(job.bookId);
  }
  return require('./sync-review.cjs').apply(adapter(store),input.id,input.changes);
}
module.exports={isChapterSync,read,current,prepare,adapter,apply};
