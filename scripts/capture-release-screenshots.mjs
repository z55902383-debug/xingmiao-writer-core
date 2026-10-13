import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
const dir=resolve('test-results/release-0610-screenshots');await mkdir(dir,{recursive:true});const data=await mkdtemp(resolve(dir,'run-'));const assets=resolve('docs/assets');await mkdir(assets,{recursive:true});
const server=createServer(async(req,res)=>{for await(const p of req){};res.writeHead(200,{'content-type':'text/event-stream'});let count=0;const timer=setInterval(()=>{if(res.destroyed){clearInterval(timer);return;}res.write('data: '+JSON.stringify({choices:[{delta:{content:'雨水沿着窗框落下。林舟握紧钥匙，重新核对旧地址。\n'},finish_reason:null}]})+'\n\n');if(++count===24){clearInterval(timer);res.end('data: [DONE]\n\n');}},250);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const env={...process.env,XM_TEST:'1',XM_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;delete env.XM_DEV_URL;
const app=await electron.launch({args:['.'],env});const errors=[];
try{
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1460,height:900});
 const call=(action,data={})=>page.evaluate(async({action,data})=>{const r=await window.xingmiao.invoke(action,data);if(!r.ok)throw Error(r.error);return r.data;},{action,data});
 await expect(page.getByRole('heading',{name:'我的书架',exact:true})).toBeVisible();
 const book=await call('book:create',{title:'雨港的旧钥匙',genre:'悬疑',premise:'旧书店即将关闭，林舟在一封未寄出的信中发现钥匙，沿着雨港的旧地图寻找答案。',target:80000});
 await call('book:update',{id:book.id,patch:{outline:'林舟追查钥匙的主人，从旧书店走进码头。三封信串起父亲当年的选择，真相揭开后，他决定归还失物并保留书店。',world:'雨港是一座保留着旧码头和纸质档案的海边小城。',characters:[{id:'linzhou',name:'林舟',role:'旧书店的继承人',description:'细心而克制，习惯先核对证据再作出判断。'},{id:'zhoubo',name:'周伯',role:'码头管理员',description:'熟悉雨港旧路，保管一份尚未公开的航行记录。'}]}});
 await call('volume:save',{bookId:book.id,volume:{title:'第一卷 雨夜来信',outline:'在书店找到旧钥匙，查清信件来处。',detail:'开篇建立旧书店关闭的期限；钥匙与信封引出旧码头；周伯提供线索，卷末发现航行记录。'}});
 let b=await call('book:get',{id:book.id});const v=b.volumes[0];await call('chapter:save',{id:b.chapters[0].id,revision:b.chapters[0].revision,patch:{title:'第1章 未寄出的信',volumeId:v.id,summary:'林舟收拾旧书店，发现写给父亲的信和旧钥匙。',outline:'场景：雨夜旧书店。目标：清点遗物。冲突：信件与父亲的说法不符。转折：钥匙刻有码头编号。章末：前往码头。',body:'雨落下来时，林舟正在关书店的门。\n门边的纸箱受了潮。他把最上层的旧书搬开，一只没有邮票的信封从书页里滑出来。\n信封上写着父亲的名字，落款却是一个他从没听过的人。\n一把旧钥匙压在信底，齿口已经磨平。林舟拿到灯下，看到钥匙背面刻着两个数字。\n“十七码头。”\n身后的周伯没有进门，只把伞靠在台阶上。\n“你父亲最后一次回来，就是从那边走的。”'}});
 for(const [title,summary] of [['第2章 十七码头','林舟与周伯核对码头记录。'],['第3章 第二封信','旧仓库留下下一条线索。']]){const c=await call('chapter:create',{bookId:book.id,title});await call('chapter:save',{id:c.id,revision:c.revision,patch:{volumeId:v.id,summary,outline:'从线索出发，核对证据，在选择中推动关系变化。'}});}
 const style=await call('writing:save',{bookId:book.id,profile:{kind:'style',title:'克制的悬疑叙事',body:'限知视角，以动作和物件呈现人物心理。对白简短，每场保留一个具体疑问。',source:'',sourceName:''}});
 b=await call('book:get',{id:book.id});const sid=b.writingProfiles.find(p=>p.title==='克制的悬疑叙事').id;
 await call('writing:save',{bookId:book.id,profile:{kind:'requirement',title:'连贯性与章末钩子',body:'保留已确认事实，不将计划当成发生。新线索必须有证据，章末留下具体行动方向。',source:'',sourceName:''}});b=await call('book:get',{id:book.id});await call('writing:select',{bookId:book.id,selection:{styleIds:[sid],requirementIds:[b.writingProfiles.find(p=>p.kind==='requirement').id]}});
 for(const title of ['风从山谷来','末班车上的失物招领'])await call('book:create',{title,premise:'从一次意外相遇开始，写下人物自己的选择。',creationMode:'short',target:6000});
 await call('config:save',{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'演示模型',name:'演示模型',maxTokens:4096});await page.reload();
 const shot=async name=>{await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(250);await page.screenshot({path:resolve(assets,name+'.png'),animations:'disabled'});};
 await expect(page.getByRole('heading',{name:'我的书架',exact:true})).toBeVisible();await shot('library');
 const light=page.getByRole('button',{name:'切换到浅色模式',exact:true});if(await light.count())await light.click();else await page.getByRole('button',{name:'切换到浅色模式',exact:false}).first().click();await shot('library-light');
 await page.getByRole('button',{name:/切换到深色模式/}).first().click();await page.getByRole('button',{name:'打开 雨港的旧钥匙',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'章节正文',exact:true})).toBeVisible();await shot('workspace');
 await page.getByRole('button',{name:'选择风格并核对参考资料',exact:true}).click();await shot('reference-controls');
 await page.getByRole('tab',{name:'功能',exact:true}).click();await page.getByRole('button',{name:'故事大纲',exact:true}).click();await page.getByRole('tab',{name:'分卷章节',exact:true}).click();await shot('planning');
 await page.getByRole('button',{name:'风格档案',exact:true}).click();await shot('writing-profile-library');
 await page.getByRole('button',{name:'资料整理',exact:true}).click();await expect(page.getByRole('textbox',{name:'想查询或调整哪些资料？',exact:true})).toBeVisible();await shot('knowledge-assistant');
 await page.getByRole('button',{name:'写作生成',exact:true}).click();await page.getByRole('button',{name:'章节正文',exact:true}).click();await page.getByLabel('正文生成后自动分析故事变化',{exact:true}).uncheck();await page.getByRole('button',{name:'开始生成',exact:true}).click();await expect(page.getByRole('button',{name:'停止',exact:true})).toBeVisible();await page.waitForTimeout(650);await shot('generation-activity');await page.getByRole('button',{name:'停止',exact:true}).click();
 await page.getByRole('button',{name:'返回书架',exact:true}).click();await page.getByRole('button',{name:/人工码字板/}).click();await shot('manual-writing');
 await page.getByRole('button',{name:'返回书架',exact:true}).click();await page.getByRole('button',{name:'模型与设置',exact:true}).click();await shot('settings');await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
 if(errors.length)throw Error(errors.join('\n'));await writeFile(resolve(data,'report.json'),JSON.stringify({version:'0.6.10',screenshots:10,isolatedDemo:true,errors},null,2));console.log('Current screenshots captured: '+assets);
}finally{await app.close();server.closeAllConnections();server.close();}
