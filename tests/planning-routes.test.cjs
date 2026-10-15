const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const { Store } = require("../electron/store.cjs");
const { buildContext } = require("../electron/context.cjs");
const { planningSignature, planningRows } = require("../electron/planning-routes.cjs");
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(),"xm-routes-"));
  const db = new Store(join(dir,"test.sqlite"));
  t.after(() => { db.close(); rmSync(dir,{ recursive:true,force:true }); });
  const b = db.createBook({ title:"想法书",premise:"侦探调查失踪案" });
  return { db,b,c:b.chapters[0] };
}
function job(db,b,c,kind,data,extra={}) {
  const j = { id:randomUUID(),bookId:b.id,chapterId:c.id,baseRevision:db.chapter(c.id).revision,kind,output:typeof data === "string" ? data : JSON.stringify(data),status:"done",adopted:false,createdAt:new Date().toISOString(),...extra };
  db.putJob(j); return j;
}
test('卷目标章数可配置并进入上下文，只需卷大纲即可拆章，编辑保留目标',t=>{
 const {db,b,c}=setup(t);db.saveVolume(b.id,{title:'目标卷',outline:'调查、转折、解决',targetChapters:6});const volume=db.book(b.id).volumes[0];
 const context=buildContext(db.book(b.id),c,'chapterPlan','',[],{volumeId:volume.id});assert.equal(JSON.parse(context.messages[1].content.split('以下 JSON 为资料数据：\n')[1]).targetVolume.targetChapters,6);
 db.saveVolume(b.id,{...volume,detail:'阶段划分'});assert.equal(db.book(b.id).volumes[0].targetChapters,6);
 assert.throws(()=>db.saveVolume(b.id,{...volume,targetChapters:201}));assert.throws(()=>db.saveVolume(b.id,{...volume,targetChapters:1.5}));
});
test('逐章编辑选用仅写入勾选结果并自动归卷，保留现有正文和其他章节',t=>{
 const {db,b,c}=setup(t);db.saveVolume(b.id,{title:'目标卷',outline:'调查'});const v=db.book(b.id).volumes[0];db.organizeChapter(c.id,{volumeId:v.id});db.updateChapter(c.id,{body:'作者既有正文'},c.revision);const latest=db.chapter(c.id);
 const j=job(db,b,latest,'chapterPlan',{volumeId:v.id,chapters:[{id:c.id,title:'第1章 原名',summary:'原概要'},{title:'第2章 新线索',summary:'线索'},{title:'第3章 未选',summary:'未采用'}]},{targetVolumeId:v.id,planningSignature:planningSignature(db.book(b.id))});
 db.adopt(j.id,'replace',[{index:0,title:'第1章 编辑后的名称',summary:'作者修订概要',outline:'作者修订细纲'},{index:1,title:'第2章 新线索',summary:'编辑线索',outline:'新的场景顺序'}]);const after=db.book(b.id);
 assert.equal(after.chapters.length,2);assert.equal(after.chapters[0].body,'作者既有正文');assert.equal(after.chapters[0].summary,'作者修订概要');assert.equal(after.chapters[1].volumeId,v.id);assert.ok(!after.chapters.some(row=>row.title==='第3章 未选'));assert.equal(db.job(j.id).planningPreview.length,2);
});
test('逐章选择拒绝伪造目标、重复选择、清空必填概要和修改后过期采用',t=>{
 const {db,b,c}=setup(t);db.saveVolume(b.id,{title:'目标卷',outline:'调查'});const v=db.book(b.id).volumes[0], j=job(db,b,c,'chapterPlan',{chapters:[{title:'章节一',summary:'大纲'},{title:'章节二',summary:'大纲'}]},{targetVolumeId:v.id,planningSignature:planningSignature(db.book(b.id))});
 const before=JSON.stringify(db.book(b.id));for(const edits of [[{index:0,id:'foreign',title:'伪造'}],[{index:0},{index:0}],[{index:0,summary:''}],[]])assert.throws(()=>db.adopt(j.id,'replace',edits));assert.equal(JSON.stringify(db.book(b.id)),before);
 db.saveVolume(b.id,{...v,targetChapters:4});assert.throws(()=>db.adopt(j.id,'replace',[{index:0,title:'新名称'}]),/修改/);assert.equal(db.job(j.id).adopted,false);
});
test('只选新增章时不会写入未勾选的初始空章',t=>{
 const {db,b,c}=setup(t);db.saveVolume(b.id,{title:'甲卷',outline:'规划'});const v=db.book(b.id).volumes[0];const j=job(db,b,c,'chapterPlan',{chapters:[{title:'第1章 来客',summary:'概要'},{title:'第2章 线索',summary:'概要'}]},{targetVolumeId:v.id});db.adopt(j.id,'replace',[{index:1,title:'第2章 作者选择',summary:'作者概要'}]);assert.equal(db.chapter(c.id).title,c.title);assert.equal(db.chapter(c.id).summary,'');assert.equal(db.chapter(c.id).volumeId,c.volumeId);assert.equal(db.book(b.id).chapters.filter(row=>row.volumeId===v.id).length,1);
});
test("分步结构化结果同步作品名、卷名、章名和对应内容，并复用空白初始章", t => {
  const {db,b,c}=setup(t);
  db.adopt(job(db,b,c,"bookOutline",{title:"雾城追踪",outline:"调查、发现阴谋、揭开真相"}).id,"replace");
  assert.equal(db.book(b.id).title,"雾城追踪");
  db.adopt(job(db,b,c,"volumePlan",{volumes:[{title:"第一卷 失踪者"},{title:"第二卷 真相"}]}).id,"replace");
  const v=db.book(b.id).volumes[0];
  db.adopt(job(db,b,c,"volumeOutline",{id:v.id,title:"第一卷 雾中来客",outline:"追踪线索"},{targetVolumeId:v.id}).id,"replace");
  db.adopt(job(db,b,c,"volumeDetail",{id:v.id,title:"第一卷 雾中来客",detail:"码头到旧宅"},{targetVolumeId:v.id}).id,"replace");
  const j=job(db,b,c,"chapterPlan",{volumeId:v.id,chapters:[{title:"第1章 来客",summary:"陌生人求助"},{title:"第2章 旧宅",summary:"发现线索"}]},{targetVolumeId:v.id});
  assert.equal(planningRows(db.book(b.id),j,db.chapter(c.id))[0].id,c.id);
  db.adopt(j.id,"replace");
  const after=db.book(b.id);
  assert.equal(after.chapters.length,2);
  assert.equal(after.chapters[0].id,c.id);
  assert.equal(after.chapters[0].title,"第1章 来客");
  assert.equal(after.chapters[0].volumeId,v.id);
  assert.equal(after.chapters[1].summary,"发现线索");
  assert.equal(db.job(j.id).planningPreview[1].id,after.chapters[1].id);
});
test("再次采用按 ID 更新章名和细纲，保留正文、同卷未列出章节及其他卷", t => {
  const {db,b,c}=setup(t);
  db.saveVolume(b.id,{title:"甲卷"}); db.saveVolume(b.id,{title:"乙卷"});
  const [v,other]=db.book(b.id).volumes;
  db.organizeChapter(c.id,{volumeId:v.id});
  db.updateChapter(c.id,{title:"旧章名",body:"作者正文",summary:"旧概要"},c.revision);
  const untouched=db.createChapter(b.id,"保留章");db.organizeChapter(untouched.id,{volumeId:v.id});
  const j=job(db,b,c,"chapterDetails",{volumeId:v.id,chapters:[{id:c.id,title:"新章名",outline:"场景、冲突、结尾"}]},{targetVolumeId:v.id});
  db.adopt(j.id,"replace");
  assert.equal(db.chapter(c.id).title,"新章名");assert.equal(db.chapter(c.id).body,"作者正文");
  assert.equal(db.chapter(c.id).summary,"旧概要");assert.equal(db.chapter(untouched.id).title,"保留章");
  assert.equal(db.book(b.id).volumes.find(x=>x.id===other.id).outline,"");
  assert.ok(db.versions(c.id).some(x=>x.title==="旧章名"));
  assert.throws(()=>db.adopt(j.id,"replace"),/已经采用/);
});
test("卷细纲包含明确章节时，同一次采用完成归卷和字段同步", t=>{
  const {db,b,c}=setup(t); db.saveVolume(b.id,{title:"甲卷"}); const v=db.book(b.id).volumes[0];
  db.adopt(job(db,b,c,"volumeDetail",{title:"新甲卷",detail:"阶段事件",chapters:[{title:"第1章 开端",summary:"初遇",outline:"三场戏"}]},{targetVolumeId:v.id}).id,"replace");
  assert.equal(db.book(b.id).volumes[0].title,"新甲卷");assert.equal(db.chapter(c.id).outline,"三场戏");assert.equal(db.chapter(c.id).volumeId,v.id);
});
test("批量结果重复、跨卷 ID 或不完整时，整个采用回滚",t=>{
  const {db,b,c}=setup(t);db.saveVolume(b.id,{title:"甲卷"});db.saveVolume(b.id,{title:"乙卷"});
  const [v,other]=db.book(b.id).volumes;db.organizeChapter(c.id,{volumeId:other.id});
  const foreign=db.createBook({title:"他书"}).chapters[0];
  for(const chapters of [
    [{title:"同名",summary:"一"},{title:"同名",summary:"二"}],
    [{title:"正常",summary:"一"},{id:c.id,title:"跨卷",summary:"二"}],
    [{title:"正常",summary:"一"},{id:foreign.id,title:"跨书",summary:"二"}],
    [{title:"正常",summary:"一"},{title:"缺字段"}],
    [{title:"正文混入",summary:"一",body:"不可写入"}],
  ]){
    const j=job(db,b,c,"chapterPlan",{chapters},{targetVolumeId:v.id});
    assert.throws(()=>db.adopt(j.id,"replace"));assert.equal(db.book(b.id).chapters.length,1);assert.equal(db.job(j.id).adopted,false);
  }
});
test("分卷采用快照可恢复原名称与文本，JSON 格式错误不能当成正文写入",t=>{
  const {db,b,c}=setup(t);db.saveVolume(b.id,{title:"旧卷",outline:"旧纲"});const v=db.book(b.id).volumes[0];
  db.adopt(job(db,b,c,"volumeOutline",{title:"新卷",outline:"新纲"},{targetVolumeId:v.id}).id,"replace");
  const snapshot=db.trash().find(x=>x.item?.field==="title" && x.item?.volumeId===v.id);
  db.restoreTrash(snapshot.id);assert.equal(db.book(b.id).volumes[0].title,"旧卷");
  assert.throws(()=>db.adopt(job(db,b,c,"summary",'{"title":"坏结果",').id,"replace"),/结构不完整/);
  assert.equal(db.chapter(c.id).summary,"");
});
test("结构化规划生成后其他章节被编辑，也阻止批量采用",t=>{
  const {db,b,c}=setup(t);db.saveVolume(b.id,{title:"甲卷"});const v=db.book(b.id).volumes[0];
  const later=db.createChapter(b.id,"后章");db.organizeChapter(later.id,{volumeId:v.id});
  const j=job(db,b,c,"chapterPlan",{chapters:[{id:later.id,title:"后章",summary:"AI"}]},{targetVolumeId:v.id,planningSignature:planningSignature(db.book(b.id))});
  db.updateChapter(later.id,{summary:"作者新规划"},later.revision);
  assert.throws(()=>db.adopt(j.id,"replace"),/规划已修改/);assert.equal(db.chapter(later.id).summary,"作者新规划");
});
test("上下文保留完整流程资料与真实目标 ID，缺少前置步骤给出明确提示",t=>{
  const {db,b,c}=setup(t);
  assert.throws(()=>buildContext(db.book(b.id),c,"volumePlan"),/全文大纲/);
  db.updateBook(b.id,{outline:"总纲"});db.saveVolume(b.id,{title:"甲卷",outline:"卷纲",detail:"细纲"});const v=db.book(b.id).volumes[0];
  const context=buildContext(db.book(b.id),c,"chapterPlan","",[],{volumeId:v.id});
  const data=JSON.parse(context.messages[1].content.split("以下 JSON 为资料数据：\n")[1]);
  assert.equal(data.targetVolume.id,v.id);assert.equal(data.chapter.id,c.id);assert.equal(data.storyStructure.volumes.length,1);
  assert.match(context.messages[1].content,/章节规划/);
});
test("给前卷补章时插在后卷之前，保留原章与已删除章的顺序位置",t=>{
  const {db,b,c}=setup(t);db.saveVolume(b.id,{title:"甲卷"});db.saveVolume(b.id,{title:"乙卷"});const [v,other]=db.book(b.id).volumes;
  db.organizeChapter(c.id,{volumeId:v.id});
  const deleted=db.createChapter(b.id,"暂时删除章");db.deleteChapter(deleted.id);
  const later=db.createChapter(b.id,"后卷第一章");db.organizeChapter(later.id,{volumeId:other.id});
  for (const chapter of [c,later]) { const saved=db.updateChapter(chapter.id,{body:chapter.title+"的既有正文"},db.chapter(chapter.id).revision); db.finalize(chapter.id,saved.revision); }
  db.adopt(job(db,b,c,"chapterPlan",{chapters:[{title:"前卷新增章",summary:"新增剧情"}]},{targetVolumeId:v.id}).id,"replace");
  const after=db.book(b.id).chapters;
  assert.deepEqual(after.map(x=>x.title),[c.title,"前卷新增章","后卷第一章"]);
  assert.equal(db.chapter(c.id).order,c.order);assert.equal(db.chapter(later.id).order,later.order);
  assert.notEqual(after[1].order,deleted.order);
  const context=buildContext(db.book(b.id),after[1],"write");assert.equal(context.sourceChapters.some(x=>x.id===c.id),true);assert.equal(context.sourceChapters.some(x=>x.id===later.id),false);
});
test("生成具体章名时复用同卷同编号的空白默认章，不留下重复空壳",t=>{
  const {db,b,c}=setup(t);db.saveVolume(b.id,{title:"甲卷"});const v=db.book(b.id).volumes[0];
  db.organizeChapter(c.id,{volumeId:v.id});const second=db.createChapter(b.id);db.organizeChapter(second.id,{volumeId:v.id});
  db.adopt(job(db,b,c,"chapterPlan",{chapters:[{title:"第1章 访客",summary:"初遇"},{title:"第2章 消息",summary:"新线索"}]},{targetVolumeId:v.id}).id,"replace");
  const after=db.book(b.id).chapters;assert.equal(after.length,2);assert.equal(after[0].id,c.id);assert.equal(after[1].id,second.id);
});
