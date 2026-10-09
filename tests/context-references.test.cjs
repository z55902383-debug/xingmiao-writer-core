const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildContext}=require('../electron/context.cjs');
const fixture=()=>({id:'b',title:'引用测试',genre:'',premise:'故事想法',outline:'全文规划',world:'固定世界',style:'',reference:'未用于正文的原文',characters:[{id:'p',name:'当下人物',introducedOrder:1},{id:'future',name:'后续人物',introducedOrder:3}],memories:[],timeline:[],worldRecords:[],foreshadows:[],contextChapters:100,chapters:[{id:'a',title:'已定稿前章',order:1,revision:1,status:'final',body:'前章内容',outline:''},{id:'c',title:'当前章',order:2,revision:1,status:'draft',body:'当前正文',outline:'章纲'},{id:'futureChapter',title:'未来章',order:3,revision:1,status:'final',body:'未来正文',outline:''}],writingProfiles:[{id:'s',kind:'style',title:'已选风格',body:'短句',source:'私有原文',sourceName:'source.txt',revision:1},{id:'r',kind:'requirement',title:'未选要求',body:'不可发送要求',source:'',sourceName:'',revision:1}],writingSelection:{styleIds:['s'],requirementIds:[]}});
test('引用清单按实际模型资料生成，排除未来人物、未选风格、未读取原文和前章',()=>{
 const b=fixture(),ctx=buildContext(b,b.chapters[1],'write','额外要求',[{id:'k',name:'已启用技巧',body:'技巧',enabled:true,tasks:['write']},{id:'off',name:'未启用',body:'无',enabled:false,tasks:['write']}],{chapterIds:[]});
 const rows=new Map(ctx.referenceSections.map(r=>[r.key,r]));
 assert.deepEqual(rows.get('characters').titles,['当下人物']);assert.equal(ctx.characterCount,1);assert.equal(rows.get('characters').count,1);
 assert.deepEqual(rows.get('writingStyles').titles,['已选风格']);assert.ok(!rows.has('writingRequirements')&&!rows.has('source')&&!rows.has('recent'));
 assert.deepEqual(rows.get('skills').titles,['已启用技巧']);assert.ok(rows.has('chapterOutline')&&rows.has('chapterBody')&&rows.has('instruction'));
 const raw=ctx.messages.map(m=>m.content).join('\n');assert.ok(!raw.includes('后续人物')&&!raw.includes('未来正文')&&!raw.includes('私有原文')&&!raw.includes('不可发送要求'));
 assert.ok(!JSON.stringify(ctx.referenceSections).includes('当前正文'));
});
test('定向蒸馏只记录目标原文和补充要求，旧快照不随新选择变化',()=>{
 const b=fixture(),distill=buildContext(b,b.chapters[1],'style','提炼节奏',[],{writingProfileId:'s'});
 assert.deepEqual(distill.referenceSections.map(row=>row.key),['source','instruction']);assert.deepEqual(distill.referenceSections[0].titles,['source.txt']);assert.deepEqual(distill.writingReferences,[]);
 const original=buildContext(b,b.chapters[1],'write');const before=JSON.stringify(original);
 b.writingSelection={styleIds:[],requirementIds:['r']};b.writingProfiles[0].body='已修改的风格';
 const newer=buildContext(b,b.chapters[1],'write');assert.equal(JSON.stringify(original),before);assert.ok(!newer.referenceSections.some(row=>row.key==='writingStyles'));assert.deepEqual(newer.referenceSections.find(row=>row.key==='writingRequirements').titles,['未选要求']);
 assert.deepEqual(original.referenceSections.find(row=>row.key==='recent').titles,['已定稿前章']);
});
