const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path'),{randomUUID}=require('node:crypto');
const {Store}=require('../electron/store.cjs'),{buildContext}=require('../electron/context.cjs'),routes=require('../electron/planning-routes.cjs'),workflow=require('../electron/author-workflow.cjs'),recovery=require('../electron/candidate-recovery.cjs'),{contextSignature}=require('../electron/timeline.cjs');
function fixture(t,input={}){const dir=mkdtempSync(join(tmpdir(),'xm-onboard-')),db=new Store(join(dir,'book.sqlite'));t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});return{db,book:db.createBook({title:'回归',premise:'寻找失物。',...input})};}
function job(db,book,kind,output,extra={}){const b=db.book(book.id),c=b.chapters[0];return db.putJob({id:randomUUID(),bookId:b.id,chapterId:c.id,kind,output:typeof output==='string'?output:JSON.stringify(output),status:'done',adopted:false,baseRevision:c.revision,contextSignature:contextSignature(b,c),planningSignature:routes.planningSignature(b),adoptionBasis:recovery.basis(b,c),...extra});}
test('章节规划可按真实ID安全复用默认空章并归卷，不接管有内容的未分卷章',t=>{
 const{db,book}=fixture(t);db.saveVolume(book.id,{title:'第一卷',outline:'纲',detail:'细'});const v=db.book(book.id).volumes[0];
 assert.throws(()=>db.updateBook(book.id,{creationMode:'short'}),/已有分卷/);
 const j=job(db,book,'chapterPlan',{chapters:[{id:book.chapters[0].id,title:'第1章 失物',summary:'寻找失物'},{title:'第2章 回家',summary:'返还'}]},{targetVolumeId:v.id});
 const adopted=db.adopt(j.id,'replace');assert.equal(adopted.chapters.length,2);assert.equal(adopted.chapters[0].id,book.chapters[0].id);assert.equal(adopted.chapters[0].volumeId,v.id);
 const other=db.createChapter(book.id,'第3章');db.updateChapter(other.id,{body:'作者原稿'},other.revision);
 const bad=job(db,book,'chapterPlan',{chapters:[{id:other.id,title:other.title,summary:'不得接管'}]},{targetVolumeId:v.id});assert.throws(()=>db.adopt(bad.id),/不属于指定目标/);assert.equal(db.chapter(other.id).body,'作者原稿');
});
test('短篇由简纲直接拆章节和细纲，不要求卷纲、卷细纲或隐式分卷',t=>{
 const{db,book}=fixture(t,{creationMode:'short',target:3000});db.updateBook(book.id,{outline:'钥匙归还，真相确定。'});
 let b=db.book(book.id),ctx=buildContext(b,b.chapters[0],'chapterPlan');assert.match(ctx.messages[1].content,/短篇路径/);assert.match(ctx.messages[1].content,/根据故事简纲/);
 assert.ok(!ctx.messages[1].content.includes('"targetVolume":'));
 const j=job(db,book,'chapterPlan',{chapters:[{id:b.chapters[0].id,title:'第1章 钥匙',summary:'找到钥匙',outline:'发现旧门'},{title:'第2章 门',summary:'打开门',outline:'返还失物'}]});b=db.adopt(j.id);
 assert.equal(b.volumes.length,0);assert.equal(b.chapters.length,2);assert.ok(b.chapters.every(c=>!c.volumeId&&c.summary&&c.outline));
 const wrong=job(db,book,'chapterDetails',{volumeId:'foreign',chapters:[{id:b.chapters[0].id,title:'第1章',outline:'坏'}]});assert.throws(()=>db.adopt(wrong.id),/不能指定其他分卷/);
 db.saveVolume(book.id,{title:'高级分卷'});assert.equal(db.book(book.id).creationMode,'long');
});
test('字数达标不表示完结；确认需要所有章节定稿，改稿或新增章节取消完结',t=>{
 const{db,book}=fixture(t,{target:1000});let c=db.updateChapter(book.chapters[0].id,{body:'文'.repeat(1100)},1);
 assert.ok(db.list()[0].words>=1000);assert.ok(!db.list()[0].completedAt);assert.throws(()=>workflow.completeBook(db,book.id),/填写正文并定稿/);
 db.finalize(c.id,c.revision);assert.ok(workflow.completeBook(db,book.id).completedAt);
 c=db.updateChapter(c.id,{body:'改稿'},c.revision);assert.equal(c.status,'draft');assert.ok(!db.book(book.id).completedAt);
 db.finalize(c.id,c.revision);workflow.completeBook(db,book.id);db.createChapter(book.id,'下一章');assert.ok(!db.book(book.id).completedAt);
});
test('生成后新增人物保留拦截；核对差异后只合并目标卷纲，二次变化拒绝保存',t=>{
 const{db,book}=fixture(t);db.saveVolume(book.id,{title:'第一卷',outline:'旧稿',detail:'现有细纲'});const v=db.book(book.id).volumes[0];
 const j=job(db,book,'volumeOutline',{id:v.id,title:v.title,outline:'候选卷纲'},{targetVolumeId:v.id});
 db.updateBook(book.id,{characters:[{id:'new',name:'新增人物',role:'主角',description:'当前人物'}]});assert.throws(()=>db.adopt(j.id),/已变化/);
 let preview=recovery.prepare(db,j.id);assert.ok(preview.conflict);assert.ok(preview.changes.some(c=>c.label==='人物档案'));assert.equal(preview.current,'旧稿');
 db.updateBook(book.id,{world:'再次修改'});assert.throws(()=>recovery.merge(db,{id:j.id,value:'合并',...preview}),/再次变化/);
 preview=recovery.prepare(db,j.id);const b=recovery.merge(db,{...preview,id:j.id,value:'保留新增人物后的合并稿'});
 assert.equal(b.volumes[0].outline,'保留新增人物后的合并稿');assert.equal(b.volumes[0].detail,'现有细纲');assert.equal(b.characters[0].name,'新增人物');assert.equal(b.world,'再次修改');assert.ok(db.job(j.id).manualMerged);
});
test('不完整单卷规划允许手工补齐，多目标结构和正在分析的候选不允许直接合并',t=>{
 const{db,book}=fixture(t);db.saveVolume(book.id,{title:'卷',outline:'纲',detail:''});const v=db.book(book.id).volumes[0];
 const partial=job(db,book,'volumeDetail','{"detail":"未完',{status:'interrupted',targetVolumeId:v.id});let preview=recovery.prepare(db,partial.id);assert.ok(preview.canMerge);
 recovery.merge(db,{...preview,id:partial.id,value:'作者补齐的完整细纲'});assert.equal(db.book(book.id).volumes[0].detail,'作者补齐的完整细纲');
 const multi=job(db,book,'chapterPlan',{chapters:[]},{targetVolumeId:v.id});assert.equal(recovery.prepare(db,multi.id).canMerge,false);
 const analyzing=job(db,book,'write','正文',{review:{status:'analyzing'}});assert.equal(recovery.prepare(db,analyzing.id).canMerge,false);
});
test('备份默认日期使用本机日历日期而非UTC日期',()=>{
 const date={getFullYear:()=>2026,getMonth:()=>9,getDate:()=>13,toISOString:()=> '2026-10-12T16:20:00Z'};
 assert.equal(workflow.localDate(date),'2026-10-13');
});
test('缺失关系对象不能同步，作者可调整记录类型，失败不会写入部分变化',t=>{
 const{db,book}=fixture(t),sync=require('../electron/sync-review.cjs');const c=db.updateChapter(book.chapters[0].id,{body:'总站准备拆除。'},1),b=db.book(book.id);
 const rows=sync.parse(JSON.stringify({changes:[{kind:'relation',subject:'总站',target:'',attribute:'拆除状态',value:'准备拆除',evidence:'总站准备拆除。'}]}),c.body);
 const j=db.putJob({id:randomUUID(),bookId:b.id,chapterId:c.id,kind:'write',output:c.body,status:'done',adopted:true,review:{status:'ready',bodyHash:sync.hash(c.body),revision:c.revision,signature:contextSignature(b,c),changes:rows}});
 assert.throws(()=>sync.apply(db,j.id,rows),/关系对象为空/);assert.equal(db.chapter(c.id).status,'draft');assert.equal(db.book(b.id).timeline.length,0);
 const updated=sync.apply(db,j.id,[{...rows[0],kind:'world'}]);assert.equal(updated.timeline[0].kind,'world');assert.equal(updated.timeline[0].value,'准备拆除');assert.equal(updated.chapters[0].status,'final');
});

test('手动恢复统一解析纯JSON和围栏JSON，中断结构提示补齐且不能直接保存',t=>{
 const{db,book}=fixture(t);db.saveVolume(book.id,{title:'卷',outline:'原纲',detail:'原细纲'});const v=db.book(book.id).volumes[0];
 for(const output of [JSON.stringify({outline:'可读卷纲'}),'```json\n'+JSON.stringify({outline:'可读卷纲'})+'\n```']) {
  const j=job(db,book,'volumeOutline',output,{targetVolumeId:v.id});const p=recovery.prepare(db,j.id);
  assert.equal(p.suggested,'可读卷纲');assert.equal(p.needsCompletion,false);
  assert.throws(()=>recovery.merge(db,{...p,id:j.id,value:output}),/不要直接保存/);
  assert.equal(recovery.merge(db,{...p,id:j.id,value:p.suggested}).volumes[0].outline,'可读卷纲');
 }
 const j=job(db,book,'volumeDetail','```json\n{"detail":"中断',{targetVolumeId:v.id,status:'interrupted'}),p=recovery.prepare(db,j.id);
 assert.equal(p.suggested,'');assert.equal(p.needsCompletion,true);
 assert.throws(()=>recovery.merge(db,{...p,id:j.id,value:j.output}),/结构不完整/);
 assert.equal(db.book(book.id).volumes[0].detail,'原细纲');assert.equal(db.job(j.id).adopted,false);
});
