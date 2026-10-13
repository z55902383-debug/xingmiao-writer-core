import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const parent=resolve('test-results/onboarding');await mkdir(parent,{recursive:true});const output=await mkdtemp(resolve(parent,'run-'));
const requests=[],errors=[];let emptyAnalysis=false;
const server=createServer(async(req,res)=>{
 let raw='';for await(const part of req)raw+=part;const value=JSON.parse(raw),prompt=value.messages.at(-1).content;requests.push(value);
 let result='连接成功',delay=30;
 if(prompt.includes('以下 JSON 为资料数据：\n')){
  const data=JSON.parse(prompt.split('以下 JSON 为资料数据：\n')[1]),v=data.targetVolume;
  if(prompt.includes('完整全书总纲'))result={title:data.book.title,outline:'寻找失物，发现安排，归还钥匙，人物作出选择。'};
  else if(prompt.includes('根据故事简纲规划短篇章节'))result={chapters:[{id:data.shortStory.chapters[0].id,title:'第1章 失物',summary:'寻找钥匙'},{title:'第2章 旧门',summary:'找到旧门'},{title:'第3章 归还',summary:'归还失物'}]};
  else if(prompt.includes('根据故事简纲补全已有章节细纲'))result={chapters:data.shortStory.chapters.map(c=>({id:c.id,title:c.title,outline:'目标：还钥匙。选择：核对失主。结果：作出归还决定。'}))};
  else if(prompt.includes('指定目标卷生成卷大纲')){result={id:v.id,title:v.title,outline:'卷纲候选：保留现有设定，找到钥匙并作出选择。\n'.repeat(140)};delay=900;}
  else if(prompt.includes('创作本章正文'))result=data.chapter.title+'\n总站准备拆除。钥匙属于路人。\n'+('她核对地址，决定归还钥匙。\n'.repeat(120));
  else throw Error('Unexpected task '+prompt.slice(0,120));
 } else if(prompt.includes('分析章节中的新人'))result={changes:[{kind:'world',subject:'总站',attribute:'拆除状态',value:'准备拆除',evidence:'总站准备拆除。'},{kind:'relation',subject:'钥匙',target:'',attribute:'归属',value:'路人',evidence:'钥匙属于路人。'}]};
 if(emptyAnalysis && prompt.includes('分析章节中的新人'))result={changes:[]};
 const text=typeof result==='string'?result:JSON.stringify(result);
 res.writeHead(200,{'content-type':'text/event-stream'});
 setTimeout(()=>res.end('data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'),delay);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const env={...process.env,XM_TEST:'1',XM_DATA_DIR:resolve(output,'data')};delete env.ELECTRON_RUN_AS_NODE;delete env.XM_DEV_URL;let app;
try{
 app=await electron.launch({args:['.'],env});const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1460,height:900});
 await expect(page.getByRole('button',{name:'模型与设置',exact:true})).toBeVisible();
 const call=(action,data={})=>page.evaluate(async({action,data})=>{const r=await window.xingmiao.invoke(action,data);if(!r.ok)throw Error(r.error);return r.data;},{action,data});
 await call('config:save',{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture-model',maxTokens:12000,temperature:null});await page.reload();
 await page.getByRole('button',{name:'创建第一部作品',exact:true}).click();
 await page.getByLabel('创作路径',{exact:true}).selectOption('short');
 await page.getByLabel('书名 *',{exact:true}).fill('短篇体验回归');await page.getByLabel('故事灵感',{exact:true}).fill('还钥匙时发现过去的安排。');
 await page.getByRole('button',{name:'创建作品',exact:true}).click();
 await expect(page.locator('.workflow-strip')).toContainText('生成全文大纲');
 await page.getByRole('button',{name:'前往下一步',exact:true}).click();
 const start=page.getByRole('button',{name:'开始生成',exact:true});
 async function generateAndAdopt(){await start.click();const adopt=page.locator('.assistant-candidate-toolbar').getByRole('button',{name:'采用结果',exact:true});await expect(adopt).toBeEnabled();await expect(adopt).toBeInViewport();await adopt.click();await expect(page.locator('.assistant-candidate-toolbar')).toContainText('已采用');}
 await generateAndAdopt();
 await page.getByRole('button',{name:'继续下一步 · 生成短篇章节规划',exact:true}).click();await expect(page.locator('.generation-destination').first()).toContainText('生成短篇章节规划');await generateAndAdopt();
 await page.getByRole('button',{name:'继续下一步 · 补全短篇章节细纲',exact:true}).click();await generateAndAdopt();
 await page.getByRole('button',{name:/新手创作步骤/}).click();await page.getByRole('button',{name:'查看 拆出短篇章节',exact:true}).click();
 await expect(page.getByRole('tab',{name:'分卷章节',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.getByRole('textbox',{name:'章节正文',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'进入正文',exact:true}).first().click();await page.getByRole('button',{name:'前往下一步',exact:true}).click();await expect(page.getByRole('textbox',{name:'章节正文',exact:true})).toBeVisible();
 await page.getByLabel('正文生成后自动分析故事变化',{exact:true}).uncheck();const before=requests.length;await generateAndAdopt();assert.equal(requests.length-before,1);
 let short=(await call('books:list')).find(b=>b.title==='短篇体验回归');let b=await call('book:get',{id:short.id});assert.equal(b.creationMode,'short');assert.equal(b.volumes.length,0);assert.equal(b.chapters.length,3);assert.equal(b.candidates[0].review,undefined);
 await page.getByRole('button',{name:'重新分析已采用正文',exact:true}).click();await page.getByRole('button',{name:'查阅变化清单',exact:true}).click();
 const review=page.getByRole('dialog',{name:'核对本章变化',exact:true});await expect(review.getByRole('checkbox').first()).not.toBeChecked();await expect(review).toContainText('关系对象为空');
 await review.getByLabel('记录类型',{exact:true}).nth(1).selectOption('world');await review.getByRole('checkbox').first().check();await review.getByRole('checkbox').nth(1).check();await review.getByRole('button',{name:'确认同步并定稿',exact:true}).click();await expect(review).toHaveCount(0);
 b=await call('book:get',{id:short.id});assert.equal(b.chapters[0].status,'final');assert.ok(b.timeline.some(e=>e.value==='准备拆除'));
 const body=page.getByRole('textbox',{name:'章节正文',exact:true});await body.fill((await body.inputValue())+'\n总站已经拆除。');
 await expect(page.locator('.sync-review')).toContainText('历史分析状态');await page.getByRole('button',{name:'重新分析已采用正文',exact:true}).click();await expect(page.getByRole('button',{name:'查阅变化清单',exact:true})).toBeVisible();
 emptyAnalysis=true;await page.getByRole('button',{name:'重新分析已采用正文',exact:true}).click();await expect(page.locator('.sync-review')).toContainText('上次分析未发现新变化');
 await body.fill((await body.inputValue())+'\n新的城门打开。');await expect(page.locator('.sync-review')).toContainText('历史分析状态');emptyAnalysis=false;
 await page.getByRole('button',{name:'重新分析已采用正文',exact:true}).click();await expect(page.getByRole('button',{name:'查阅变化清单',exact:true})).toBeVisible();
 b=await call('book:get',{id:short.id});await call('chapter:finalize',{id:b.chapters[0].id,revision:b.chapters[0].revision});

 // Remaining chapters are prepared via isolated fixtures; completion and resume are exercised through the UI.
 for(const c of b.chapters.slice(1)){const saved=await call('chapter:save',{id:c.id,patch:{body:c.title+'\n'+('收尾正文。'.repeat(220))},revision:c.revision});await call('chapter:finalize',{id:c.id,revision:saved.revision});}
 await page.getByRole('button',{name:'返回书架',exact:true}).click();await page.getByRole('button',{name:'打开 短篇体验回归',exact:true}).click();
 await page.locator('.workspace-sidebar .chapter-item').last().click();await expect(page.getByRole('textbox',{name:'章节正文'})).toHaveValue(/第3章/);
 await expect(page.locator('.creation-island-progress')).toContainText('4/5');await page.getByRole('button',{name:'确认作品完结',exact:true}).click();await expect(page.locator('.creation-island-progress')).toContainText('5/5');
 const completedBody=page.getByRole('textbox',{name:'章节正文',exact:true});await completedBody.fill((await completedBody.inputValue())+'\n作者修订。');
 await expect(page.locator('.creation-island-progress')).toContainText('4/5');await expect(page.locator('.completion-actions')).toHaveCount(0);
 await expect.poll(async()=>!!(await call('book:get',{id:short.id})).completedAt).toBe(false);
 await expect(page.locator('.creation-island-progress')).toContainText('4/5');
 b=await call('book:get',{id:short.id});const edited=b.chapters.at(-1);await call('chapter:finalize',{id:edited.id,revision:edited.revision});await page.getByRole('button',{name:'返回书架',exact:true}).click();await page.getByRole('button',{name:'打开 短篇体验回归',exact:true}).click();await page.getByRole('button',{name:'确认作品完结',exact:true}).click();await expect(page.locator('.creation-island-progress')).toContainText('5/5');await page.locator('.workspace-sidebar .chapter-item').last().click();
 await expect(page.locator('.workflow-strip')).toContainText('尚未导出');await expect(page.locator('.workflow-strip')).toContainText('尚未备份');
 await page.getByRole('textbox',{name:'章节正文'}).evaluate(el=>{el.focus();el.setSelectionRange(5,5);});await page.getByRole('button',{name:'返回书架',exact:true}).click();
 await expect(page.locator('.book-card').filter({hasText:'短篇体验回归'})).toContainText('已完结');await page.getByRole('button',{name:'继续写作：短篇体验回归',exact:true}).click();await expect(page.getByRole('textbox',{name:'章节正文'})).toHaveValue(/第3章/);assert.equal(await page.getByRole('textbox',{name:'章节正文'}).evaluate(el=>el.selectionStart),5);
 const exportFile=resolve(output,'story.md'),backupFile=resolve(output,'backup.json');
 await app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true});});await page.getByRole('button',{name:'导出作品',exact:true}).click();await expect(page.locator('.workflow-strip')).toContainText('尚未导出');
 await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},exportFile);await page.getByRole('button',{name:'导出作品',exact:true}).click();await expect(page.locator('.workflow-strip')).not.toContainText('尚未导出');assert.match(await readFile(exportFile,'utf8'),/第3章/);
 await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},backupFile);await page.getByRole('button',{name:'备份整个作品库',exact:true}).click();await expect(page.locator('.workflow-strip')).not.toContainText('尚未备份');assert.ok(JSON.parse(await readFile(backupFile,'utf8')).books.find(v=>v.id===short.id).completedAt);
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},backupFile);assert.equal(await call('backup:restore'),1);
 const restoredSummary=(await call('books:list')).find(v=>v.title==='短篇体验回归（恢复）');assert.ok(restoredSummary);const restored=await call('book:get',{id:restoredSummary.id});assert.equal(restored.creationMode,'short');assert.ok(restored.completedAt);assert.ok(restored.chapters.every(c=>c.status==='final'));assert.notEqual(restored.id,short.id);
 await page.getByRole('button',{name:'返回书架',exact:true}).click();
 const long=await call('book:create',{title:'冲突回归',premise:'寻找钥匙'});await call('book:update',{id:long.id,patch:{outline:'已有全纲'}});await call('volume:save',{bookId:long.id,volume:{title:'第一卷',outline:'当前卷纲',detail:'保留细纲'}});await page.reload();await page.getByRole('button',{name:'打开 冲突回归',exact:true}).click();
 await page.getByRole('tab',{name:'功能',exact:true}).click();await page.getByRole('button',{name:'故事大纲',exact:true}).click();await page.getByRole('tab',{name:'分卷章节',exact:true}).click();await page.locator('.volume-block').first().getByRole('button',{name:'生成卷大纲',exact:true}).click();
 await expect(page.getByRole('button',{name:'停止',exact:true})).toBeVisible();await call('book:update',{id:long.id,patch:{characters:[{id:'new-person',name:'新增林舟',role:'主角',description:'当前人物'}]}});
 await expect(page.locator('.candidate-recovery')).toContainText('人物档案');await expect(page.locator('.assistant-candidate-toolbar').getByRole('button',{name:'采用结果',exact:true})).toBeInViewport();
 await page.getByRole('button',{name:'核对并手动合并',exact:true}).click();const merge=page.getByRole('dialog',{name:'核对并手动合并',exact:true});await merge.getByLabel('合并后的内容',{exact:true}).fill('保留新增林舟，合并后的卷纲。');await merge.getByRole('button',{name:'保存手动合并',exact:true}).click();await expect(merge).toHaveCount(0);
 const merged=await call('book:get',{id:long.id});assert.equal(merged.characters[0].name,'新增林舟');assert.equal(merged.volumes[0].detail,'保留细纲');assert.equal(merged.volumes[0].outline,'保留新增林舟，合并后的卷纲。');
 await page.getByRole('button',{name:/新手创作步骤/}).click();await page.getByRole('button',{name:'查看 完善卷大纲与细纲',exact:true}).click();await expect(page.getByRole('tab',{name:'分卷章节',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('button',{name:'返回书架',exact:true}).click();const recoveryBook=await call('book:create',{title:'生成后编辑想法',premise:'寻找钥匙',creationMode:'short'});await page.reload();await page.getByRole('button',{name:'打开 生成后编辑想法',exact:true}).click();await page.getByRole('button',{name:'前往下一步',exact:true}).click();await start.click();
 const accept=page.locator('.assistant-candidate-toolbar').getByRole('button',{name:'采用结果',exact:true});await expect(accept).toBeEnabled();await expect(page.locator('.candidate-recovery')).toHaveCount(0);
 await page.getByLabel('故事简介',{exact:true}).fill('寻找钥匙，但失主已经离开。');await expect(page.getByRole('button',{name:'核对并手动合并',exact:true})).toBeVisible();await accept.click();await expect(page.getByRole('button',{name:'核对并手动合并',exact:true})).toBeVisible();
 const rejected=await call('book:get',{id:recoveryBook.id});assert.equal(rejected.outline,'');assert.equal(rejected.candidates[0].adopted,false);
 await page.getByRole('button',{name:'核对并手动合并',exact:true}).click();const recoveryDialog=page.getByRole('dialog',{name:'核对并手动合并',exact:true});await expect(recoveryDialog.getByLabel('合并后的内容',{exact:true})).toHaveValue('寻找失物，发现安排，归还钥匙，人物作出选择。');await recoveryDialog.getByRole('button',{name:'取消',exact:true}).click();
 for(const theme of ['dark','light']){await page.setViewportSize({width:1460,height:768});if(theme==='light')await page.getByRole('button',{name:'切换到浅色模式',exact:true}).click();await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.themeReveal||'')).toBe('');for(const width of [1460,1024]){await page.setViewportSize({width,height:768});const drawer=page.getByRole('button',{name:'打开写作助手',exact:true});if(width<1200&&await drawer.isVisible())await drawer.click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(output,`workflow-${theme}-${width}.png`),animations:'disabled'});}}
 assert.deepEqual(errors,[]);await writeFile(resolve(output,'report.json'),JSON.stringify({passed:true,requests:requests.length,shortFlow:true,optionalAnalysis:true,manualRecovery:true,postGenerationEditRecovery:true,staleReviewRetry:true,emptyReviewRetry:true,completedEditRevocation:true,guideStepDestinations:true,completionSeparate:true,resumeCursor:true,exportCancel:true,backup:true,rendererErrors:errors},null,2));console.log('Onboarding desktop checks passed: '+output);
}finally{if(app)await app.close().catch(()=>{});server.closeAllConnections();await new Promise(done=>server.close(done));}
