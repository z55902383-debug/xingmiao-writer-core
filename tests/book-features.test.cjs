const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtempSync,rmSync,readFileSync}=require('node:fs'),{join,resolve}=require('node:path'),{tmpdir}=require('node:os');
const {Store}=require('../electron/store.cjs'),{buildContext}=require('../electron/context.cjs'),{contextSignature}=require('../electron/timeline.cjs');
const {saveMemo}=require('../electron/memo-actions.cjs');
const meta=require('../electron/memo-metadata.mjs');
function setup(t){const dir=mkdtempSync(join(tmpdir(),'xm-book-features-')),db=new Store(join(dir,'test.sqlite'));t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});let book=db.createBook({title:'能力边界',premise:'调查信件'});book=db.updateBook(book.id,{outline:'调查线索',reference:'SOURCE-ONLY'});book.volumes=[{id:'v',title:'第一卷',outline:'调查',detail:'询问'}];book.chapters[0].volumeId='v';book.chapters[0].body='林晚打开信封。';book.chapters[0].status='final';db.putBook(book);const c=db.updateChapter(book.chapters[0].id,{body:'林晚打开信封。',outline:'询问信使',volumeId:'v'},book.chapters[0].revision);db.finalize(c.id,c.revision);return{db,book:db.book(book.id)};}
const cheat={enabled:true,name:'回声',owner:'林晚',ability:'CHEAT-CONTENT-MARKER：听见物品的最后一句话',limits:'只能听一次',cost:'失去一段记忆',growth:'第三卷才解锁影像',reveal:'只有主角知道',notes:'不得绕过代价'};
test('全部创作步骤引用启用的金手指，分析和记忆提取隔离；关闭保留但不发送',t=>{
  const{db,book:initial}=setup(t);let book=db.updateBook(initial.id,{cheat});book.chapters[0].volumeId='v';
  for(const kind of new Set(require('../electron/extensions.cjs').KINDS)){
    if(kind==='chapterDetails')book.chapters[0].outline='';
    const context=buildContext(book,book.chapters[0],kind,'',[],{volumeId:'v'}),sent=JSON.stringify(context.messages);
    if(['style','memory'].includes(kind)){assert.doesNotMatch(sent,/CHEAT-CONTENT-MARKER/);assert.equal(context.cheat,undefined);}
    else {assert.match(sent,/CHEAT-CONTENT-MARKER/);assert.deepEqual(context.cheat,cheat);assert.equal(context.referenceSections.find(r=>r.key==='cheat').count,1);assert.match(context.messages[0].content,/不能临时追加能力/);}
  }
  book=db.updateBook(book.id,{cheat:{...cheat,enabled:false}});assert.equal(book.cheat.ability,cheat.ability);assert.doesNotMatch(JSON.stringify(buildContext(book,book.chapters[0],'write').messages),/CHEAT-CONTENT-MARKER/);
  const another=db.createBook({title:'另一书'});assert.equal(buildContext(another,another.chapters[0],'write').cheat,undefined);
});
test('金手指启停及有效内容影响采用签名，禁用草稿不影响；变更原因可追溯',t=>{
  const{db,book:initial}=setup(t),chapter=initial.chapters[0],before=contextSignature(initial,chapter);
  const disabled=db.updateBook(initial.id,{cheat:{...cheat,enabled:false}});assert.equal(contextSignature(disabled,chapter),before);
  const book=db.updateBook(initial.id,{cheat});const signature=contextSignature(book,chapter);assert.notEqual(signature,before);
  db.putJob({id:'cheat-candidate',bookId:book.id,chapterId:chapter.id,kind:'write',status:'done',output:'候选正文',adopted:false,baseRevision:chapter.revision,contextSignature:signature,adoptionBasis:require('../electron/candidate-recovery.cjs').basis(book,chapter)});
  db.updateBook(book.id,{cheat:{...cheat,enabled:false}});assert.throws(()=>db.adopt('cheat-candidate','replace'),/已变化/);
  assert.ok(require('../electron/candidate-recovery.cjs').prepare(db,'cheat-candidate').changes.some(r=>r.label==='金手指设定'));
  assert.throws(()=>db.updateBook(book.id,{cheat:{enabled:'yes'}}),/启用状态/);
});
test('备忘录分类、来源可编辑并兼容旧入口，单条新增不覆盖其他笔记',t=>{
  const{db,book}=setup(t),old=saveMemo(db,{bookId:book.id,id:'old',title:'已有',content:'不变',baseUpdatedAt:null});
  let note=saveMemo(db,{bookId:book.id,id:'new',title:'回声能力方案',content:'能力草稿',category:'金手指',sourceToolId:'cheat',sourceToolName:'金手指生成器',baseUpdatedAt:null});
  assert.deepEqual(db.book(book.id).memos.find(r=>r.id===old.id),old);
  note=saveMemo(db,{bookId:book.id,...note,category:'能力备选',baseUpdatedAt:note.updatedAt});assert.equal(note.category,'能力备选');
  note=saveMemo(db,{bookId:book.id,id:note.id,title:note.title,content:'修订草稿',baseUpdatedAt:note.updatedAt});assert.equal(note.sourceToolId,'cheat');assert.equal(note.category,'能力备选');
  const updated=db.updateBook(book.id,{memos:db.book(book.id).memos.map(row=>row.id===note.id?{...row,title:row.title+'修订'}:row)});assert.deepEqual(updated.memos.find(row=>row.id===old.id),old);assert.equal(updated.memos.find(r=>r.id===note.id).sourceToolName,'金手指生成器');
  assert.throws(()=>saveMemo(db,{bookId:book.id,id:'invalid',title:'错分类',content:'',category:['bad'],baseUpdatedAt:null}),/分类/);
});
test('工具箱标题来自主题并处理重名，分类按用途给默认值',()=>{
  const a=meta.suggestMemoTitle('金手指生成器','听见旧物回声','结果');assert.match(a,/听见旧物回声/);assert.doesNotMatch(a,/2026/);
  assert.equal(meta.suggestMemoTitle('金手指生成器','听见旧物回声','结果',[{title:a}]),a+'（2）');
  assert.equal(meta.defaultMemoCategory('cheat'),'金手指');assert.equal(meta.defaultMemoCategory('outline'),'故事大纲');assert.equal(meta.memoCategory({}),'未分类');
});
test('真实备份恢复入口同时还原金手指与备忘录分类和来源',async t=>{
  const{db,book}=setup(t);const restoredCheat={...cheat,document:'# 完整方案\n## 可选发散\n保持原文',holders:[holder('a','男主','当前定位'),holder('b','女主','初始印象')]};db.updateBook(book.id,{cheat:restoredCheat});saveMemo(db,{bookId:book.id,id:'memo',title:'能力草稿',content:'原始方案',category:'金手指',sourceToolId:'cheat',sourceToolName:'金手指生成器',baseUpdatedAt:null});
  const backup=db.backup(),main=readFileSync(resolve('electron/main.cjs'),'utf8'),start=main.indexOf('async function restoreBackup()'),end=main.indexOf('const actions =',start),{assert:guard,text,id,now}=require('../electron/store.cjs');
  const restore=require('node:vm').runInNewContext(main.slice(start,end)+';restoreBackup;',{require:require('node:module').createRequire(resolve('electron/main.cjs')),store:db,win:{},dialog:{showOpenDialog:async()=>({canceled:false,filePaths:['backup.json']})},fs:{readFile:async()=>JSON.stringify(backup),stat:async()=>({size:Buffer.byteLength(JSON.stringify(backup))})},assert:guard,text,id,now});
  assert.equal(await restore(),1);const copy=db.book(db.list().find(row=>row.id!==book.id).id);assert.deepEqual(copy.cheat,restoredCheat);assert.equal(copy.memos[0].category,'金手指');assert.equal(copy.memos[0].sourceToolId,'cheat');assert.equal(copy.memos[0].content,'原始方案');assert.notEqual(copy.memos[0].id,'memo');
});

const holder=(id,name,ability)=>({id,name,powerName:name+'的能力',ability,trigger:'主动集中注意',limits:'只给一个标签',cost:'必须验证',growth:'第三阶段才改变',reveal:'底层规则仅作者知道'});
test('多人能力与完整长篇方案无损保存，归属、备选、阶段边界随实际请求传递',t=>{
 const {db,book:initial}=setup(t);
 const document='# 核心金手指：关系误判系统\n'+('## 可选发散\n空白不是恋人；底层规则不向人物解释。\n'.repeat(2200))+'| 场景 | 优势 |\n|---|---|\n| 招新 | 验证分工 |';
 const config={...cheat,owner:'',ability:'',holders:[holder('male','男主','BOY-ONLY 当前关系定位'),holder('female','校花','GIRL-ONLY 初始印象残留')],document};
 const book=db.updateBook(initial.id,{cheat:config});assert.deepEqual(db.book(book.id).cheat,config);
 const context=buildContext(book,book.chapters[0],'write');assert.deepEqual(context.cheat,config);
 const sent=JSON.stringify(context.messages);assert.match(sent,/BOY-ONLY/);assert.match(sent,/GIRL-ONLY/);
 assert.equal(sent.split('BOY-ONLY').length-1,1);assert.equal(sent.split('GIRL-ONLY').length-1,1);
 assert.match(context.messages[0].content,/只约束本人/);assert.match(context.messages[0].content,/作者掌握的底层规则/);
 assert.ok(!context.warnings.some(row=>row.includes('核心能力尚未填写')));
 const docOnly={...config,holders:[]};assert.ok(!buildContext({...book,cheat:docOnly},book.chapters[0],'write').warnings.some(row=>row.includes('核心能力尚未填写')));
 for(const kind of ['style','memory'])assert.doesNotMatch(JSON.stringify(buildContext(book,book.chapters[0],kind).messages),/BOY-ONLY|GIRL-ONLY|空白不是恋人/);
 assert.doesNotMatch(JSON.stringify(buildContext({...book,cheat:{...config,enabled:false}},book.chapters[0],'write').messages),/BOY-ONLY|GIRL-ONLY|空白不是恋人/);
 const sig=contextSignature(book,book.chapters[0]);assert.notEqual(contextSignature({...book,cheat:{...config,document:document+'修改'}},book.chapters[0]),sig);
 assert.notEqual(contextSignature({...book,cheat:{...config,holders:[...config.holders.slice(0,1)]}},book.chapters[0]),sig);
});
test('多人输入验证与旧版单持有者兼容',()=>{
 const {normalize}=require('../electron/cheat.cjs');assert.deepEqual(normalize(cheat),cheat);
 assert.throws(()=>normalize({...cheat,holders:{}}),/列表/);
 assert.throws(()=>normalize({...cheat,holders:[holder('a','男主','甲'),holder('a','女主','乙')]}),/重复/);
 assert.throws(()=>normalize({...cheat,holders:[{...holder('a','男主','甲'),ability:[]}]}),/字段/);
 assert.throws(()=>normalize({...cheat,document:'字'.repeat(300001)}),/完整方案/);
 assert.throws(()=>normalize({...cheat,holders:Array.from({length:31},(_,i)=>holder(String(i),'某人','甲'))}),/最多30/);
});

