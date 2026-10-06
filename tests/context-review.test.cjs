const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildContext } = require('../electron/context.cjs');
const { contextSignature } = require('../electron/timeline.cjs');
function fixture(){
 const chapters=Array.from({length:6},(_,i)=>({id:'c'+i,title:'第'+i+'章',order:i+1,status:'final',revision:1,body:'正文'+i,outline:''}));
 return {id:'b',title:'测试',genre:'',premise:'',outline:'',world:'',style:'',characters:[],memories:[],chapters,timeline:[]};
}
function data(b,kind='continue'){return JSON.parse(buildContext(b,b.chapters[5],kind).messages[1].content.split('以下 JSON 为资料数据：\n')[1]);}
test('前N章可配置，0不会意外读取全部，草稿与未来不进入正文上下文',()=>{
 const b=fixture();b.contextChapters=3;b.chapters[4].status='draft';
 assert.deepEqual(data(b).recent.map(c=>c.title),['第2章','第3章']);
 b.contextChapters=0;assert.deepEqual(data(b).recent,[]);
 b.contextChapters=20;assert.equal(data(b).recent.length,4);
});
test('长章续写与整章润色都保留完整正文',()=>{
 const b=fixture();b.chapters[5].body='开头标记'+'甲'.repeat(12000)+'结尾标记';
 assert.ok(data(b).chapter.body.endsWith('结尾标记'));
 assert.equal(data(b).chapter.body,b.chapters[5].body);
 assert.equal(data(b,'polish').chapter.body,b.chapters[5].body);
});
test('前文修改或关联数量变化使生成上下文签名失效',()=>{
 const b=fixture(),c=b.chapters[5],old=contextSignature(b,c);
 b.chapters[0].revision++;assert.notEqual(contextSignature(b,c),old);
 const second=contextSignature(b,c);b.contextChapters=0;assert.notEqual(contextSignature(b,c),second);
});
test('按本章主题推荐早期定稿章，并允许排除默认前章',()=>{
 const b=fixture();b.contextChapters=1;b.chapters[1].body='古老银色钥匙藏在钟楼';b.chapters[5].outline='古老银色钥匙将在钟楼出现';
 const result=buildContext(b,b.chapters[5],'write','',[],{chapterIds:['c1']});
 const payload=JSON.parse(result.messages[1].content.split('以下 JSON 为资料数据：\n')[1]);
 assert.deepEqual(payload.recent.map(c=>c.title),['第1章']);
 assert.ok(result.sourceChapters.some((source)=>source.id==='c1'&&!source.selected&&source.relevance>0));
 assert.ok(result.sourceChapters.every((source)=>source.order< b.chapters[5].order));
});
test('人物认知边界与待回收伏笔进入上下文并明确作为作者资料',()=>{
 const b=fixture();b.characters=[{id:'p1',name:'林雾',role:'主角',description:'调查员',characterKnown:'只知道失踪案',readerKnown:'看见红色印记',knowledgeFromChapterId:'c3',authorNotes:'印记来自未来的她',secretFromChapterId:'c4'}];
 b.foreshadows=[{id:'f1',title:'钟楼停摆的钟',plantedChapterId:'c1',status:'open',note:'第三卷再揭示'}];
 const result=buildContext(b,b.chapters[5],'write','',[],{});
 const payload=JSON.parse(result.messages[1].content.split('以下 JSON 为资料数据：\n')[1]);
 assert.equal(JSON.parse(payload.characters)[0].authorNotes,'印记来自未来的她');
 assert.equal(JSON.parse(payload.openForeshadows)[0].title,'钟楼停摆的钟');
 assert.match(result.messages[0].content,/不能让角色提前知道/);
 const earlier=buildContext(b,b.chapters[2],'write','',[],{}),earlierData=JSON.parse(earlier.messages[1].content.split('以下 JSON 为资料数据：\n')[1]);
 assert.equal(JSON.parse(earlierData.characters)[0].characterKnown,undefined);
 assert.equal(JSON.parse(earlierData.characters)[0].authorNotes,undefined);
});
test('全部前章包含超过100章的完整正文，仍排除草稿、未来与过期记忆',()=>{
 const b=fixture(); b.contextChapters=100;
 b.chapters=Array.from({length:123},(_,i)=>({id:'c'+i,title:'第'+i+'章',order:i+1,status:i===4?'draft':'final',revision:1,outline:'',body:'开篇'+i+'甲'.repeat(4500)+'收尾'+i}));
 const current=b.chapters[121]; b.memories=[{subject:'旧事实',relation:'发生',object:'过期标记',stale:true,sourceChapterId:'c0',sourceRevision:1}];
 const context=buildContext(b,current,'continue');
 const payload=JSON.parse(context.messages[1].content.split('以下 JSON 为资料数据：\n')[1]);
 assert.equal(payload.recent.length,120);
 assert.equal(payload.recent[0].body,b.chapters[0].body);
 assert.equal(payload.recent.at(-1).body,b.chapters[120].body);
 assert.equal(payload.chapter.body,current.body);
 assert.ok(!payload.recent.some(c=>['第4章','第121章','第122章'].includes(c.title)));
 assert.deepEqual(JSON.parse(payload.facts),[]);
 assert.ok(context.characters>500000);
 const manual=buildContext(b,current,'write','',[],{chapterIds:['c0','c4','c122']});
 assert.deepEqual(manual.chapterTitles,['第0章']);
});
test('完整资料不受总预算影响，序列化人物记忆和时间线始终保持可解析',()=>{
 const b=fixture(), long='资料开头'+'甲'.repeat(70000)+'资料结尾';
 b.premise=long;b.outline=long;b.world=long;b.style=long;
 b.characters=[{id:'p',name:'甲',role:'主角',description:long}];
 b.worldRecords=[{id:'w',title:'世界',description:long}];
 b.memories=[{subject:'甲',relation:'保管',object:long,evidence:long,sourceChapterId:'c0',sourceRevision:1}];
 const instruction='要求开头'+'乙'.repeat(9000)+'要求结尾';
 const result=buildContext(b,b.chapters[5],'write',instruction);
 const payload=JSON.parse(result.messages[1].content.split('以下 JSON 为资料数据：\n')[1]);
 assert.equal(payload.book.outline,long);assert.equal(payload.book.world,long);assert.equal(payload.style,long);
 assert.equal(JSON.parse(payload.characters)[0].description,long);
 assert.equal(JSON.parse(payload.worldRecords)[0].description,long);
 assert.equal(JSON.parse(payload.facts)[0].evidence,long);
 assert.doesNotThrow(()=>JSON.parse(payload.timelineState));
 assert.ok(result.messages[1].content.includes(instruction));
 assert.ok(!result.warnings.some(w=>/预算|截断/.test(w)));
});
