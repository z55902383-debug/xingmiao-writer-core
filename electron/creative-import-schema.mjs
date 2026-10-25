export const importTools = ['brainstorm','outline','detail','opening','cheat','names','character','world'];
const field=(label,required=false,max=100000)=>({label,required,max});
export const importTargets={
 premise:{label:'故事想法',types:['book'],fields:{premise:field('故事想法',true)}},
 outline:{label:'全书总纲',types:['book'],fields:{outline:field('全书总纲',true)}},
 volume:{label:'分卷大纲与细纲',types:['volume'],fields:{title:field('卷名称',true,160),outline:field('卷大纲'),detail:field('卷细纲')}},
 chapters:{label:'章节大纲与细纲',types:['volume','chapter'],fields:{title:field('章节名称',true,120),summary:field('章节大纲'),outline:field('章节细纲')}},
 body:{label:'章节正文',types:['chapter'],fields:{title:field('章节名称',true,120),body:field('正文',true,300000)}},
 characters:{label:'人物档案',types:['character'],fields:{name:field('姓名',true,100),role:field('人物定位',false,100),description:field('人物描述'),authorNotes:field('作者秘密'),readerKnown:field('读者已知'),characterKnown:field('角色已知'),knowledgeFromChapterId:field('知情生效章节',false,100),secretFromChapterId:field('秘密生效章节',false,100)}},
 world:{label:'整体世界设定',types:['book'],fields:{world:field('整体世界设定',true)}},
 worldRecords:{label:'分类世界设定',types:['worldRecord'],fields:{title:field('条目名称',true,120),category:field('分类',true,60),description:field('设定内容',true),certainty:field('确认状态',true,20)}},
 cheat:{label:'金手指',types:['holder','shared'],fields:{name:field('持有者',true,160),powerName:field('金手指名称',true,160),ability:field('核心能力与作用',true,30000),trigger:field('触发方式',false,30000),limits:field('限制与失效条件',false,30000),cost:field('使用代价',false,30000),growth:field('成长计划',false,30000),reveal:field('知情边界',false,30000)}}
};
export const sharedFields={ability:field('共同能力规则',false,30000),limits:field('共同限制',false,30000),cost:field('共同代价',false,30000),growth:field('共同成长计划',false,30000),reveal:field('共同知情边界',false,30000),notes:field('补充约束',false,30000)};
export function fieldsFor(target,type){return type==='shared'?sharedFields:type==='volume'?importTargets.volume.fields:importTargets[target].fields;}
export const defaultImportTarget={brainstorm:'premise',outline:'outline',detail:'chapters',opening:'body',cheat:'cheat',names:'characters',character:'characters',world:'worldRecords'};
export function sourceBlocks(source){return source.split(/\n\s*\n/).filter(text=>text.trim()).map((text,index)=>({id:'s'+(index+1),text}));}
