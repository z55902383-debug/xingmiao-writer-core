import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const folder=resolve('test-results/reference-controls');await mkdir(folder,{recursive:true});const data=await mkdtemp(resolve(folder,'run-'));
const requests=[],errors=[];
const server=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const input=JSON.parse(raw);requests.push(input);const prompt=input.messages.map(m=>m.content).join('\n');const content=prompt.includes('没有变化返回')?' {"changes":[]}':prompt.includes('蒸馏可复用')?'蒸馏后的风格内容。':'林晚收起雨伞，把钥匙放在柜台上。';res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const env={...process.env,XM_TEST:'1',XM_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;delete env.XM_DEV_URL;const app=await electron.launch({args:['.'],env});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
 const call=(action,data={})=>page.evaluate(async({action,data})=>{const r=await window.xingmiao.invoke(action,data);if(!r.ok)throw Error(r.error);return r.data;},{action,data});
 await expect(page.getByRole('heading',{name:'我的书架',exact:true})).toBeVisible();
 let book=await call('book:create',{title:'参考选择专项'});await call('book:update',{id:book.id,patch:{premise:'书店重逢',outline:'全文规划',world:'这座城市常下雨',style:'本书旧风格'}});
 await call('chapter:save',{id:book.chapters[0].id,revision:book.chapters[0].revision,patch:{body:'已经发生的前章内容。'}});book=await call('book:get',{id:book.id});await call('chapter:finalize',{id:book.chapters[0].id,revision:book.chapters[0].revision});await call('chapter:create',{bookId:book.id});
 const styles=[],requirements=[];
 for(let i=0;i<34;i++){book=await call('writing:save',{bookId:book.id,profile:{kind:'style',title:`风格${i} · 限知视角与对白节奏的长名称参考`,body:`STYLE-${i}：用动作推进故事。`,source:`PRIVATE-SOURCE-${i}`,sourceName:`style-${i}.txt`}});styles.push(book.writingProfiles.at(-1).id);}
 for(let i=0;i<25;i++){book=await call('writing:save',{bookId:book.id,profile:{kind:'requirement',title:`要求${i} · 对白与段落`,body:`REQ-${i}：对白另起一段。`,source:'',sourceName:''}});requirements.push(book.writingProfiles.at(-1).id);}
 book=await call('writing:save',{bookId:book.id,profile:{kind:'style',title:'等待蒸馏的原文',body:'',source:'只供蒸馏的原文',sourceName:'pending.txt'}});const pending=book.writingProfiles.at(-1).id;
 await call('writing:select',{bookId:book.id,selection:{styleIds:['legacy-book-style',styles[0]],requirementIds:[requirements[0]]}});
 await call('config:save',{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',name:'隔离模型'});await page.evaluate(()=>localStorage.setItem('xm-workspace-panes',JSON.stringify({side:230,assistant:320,outline:0,compose:170})));await page.reload();
 await page.getByRole('button',{name:/继续.*参考选择专项/}).click();const close=page.locator('.creation-guide-close');if(await close.isVisible().catch(()=>false))await close.click();
 await page.getByRole('tab',{name:/章节/}).click();await page.getByRole('button',{name:/第2章/}).first().click();
 const entry=page.getByRole('button',{name:'选择风格并核对参考资料',exact:true}),picker=page.getByRole('region',{name:'风格参考',exact:true});
 await expect(entry).toBeVisible();await expect(entry).toContainText('风格 2 · 要求 1');await entry.click();
 await page.screenshot({path:resolve(data,'initial-discovery.png')});
 await expect(picker.getByRole('searchbox',{name:'搜索风格或要求名称',exact:true})).toBeVisible();
 assert.ok(await picker.locator('.writing-choice-list').first().evaluate(el=>el.scrollHeight>el.clientHeight&&el.clientHeight<=262));
 assert.equal(await picker.locator('.writing-choice').first().getByRole('checkbox').getAttribute('aria-label'),'本书风格档案');
 const search=picker.getByRole('searchbox',{name:'搜索风格或要求名称',exact:true});
 await search.fill('style-29.txt');const style29=picker.getByRole('checkbox',{name:'风格29 · 限知视角与对白节奏的长名称参考',exact:true});await expect(style29).toBeVisible();await style29.check();await expect(entry).toContainText('风格 3 · 要求 1');
 await search.fill('');await picker.getByRole('checkbox',{name:'只看已选',exact:true}).check();await expect(picker.locator('.writing-choice')).toHaveCount(3);await picker.getByRole('tab',{name:/写作要求/}).click();await expect(picker.locator('.writing-choice')).toHaveCount(1);await picker.getByRole('tab',{name:/写作风格/}).click();await picker.getByRole('checkbox',{name:'只看已选',exact:true}).uncheck();await expect(picker.getByRole('checkbox',{name:'等待蒸馏的原文',exact:true})).toBeDisabled();
 await search.fill('不存在的名称');await expect(picker).toContainText('没有匹配的条目');await search.fill('');
 await picker.getByRole('button',{name:'清空风格',exact:true}).click();await expect(entry).toContainText('风格 0 · 要求 1');await search.fill('style-29.txt');await style29.check();await search.fill('');
 // Rejected saves roll the optimistic choice back without losing the other category.
 await expect.poll(async()=>(await call('book:get',{id:book.id})).writingSelection).toEqual({styleIds:[styles[29]],requirementIds:[requirements[0]]});
 await app.evaluate(({ipcMain},failId)=>{const original=ipcMain._invokeHandlers.get('xm:invoke');ipcMain.removeHandler('xm:invoke');ipcMain.handle('xm:invoke',async(...args)=>{if(args[1]==='writing:select'&&args[2]?.selection?.styleIds.includes(failId))return{ok:false,error:'测试保存失败，原选择保留'};return original(...args);});},styles[3]);
 await search.fill('style-3.txt');await picker.getByRole('checkbox',{name:'风格3 · 限知视角与对白节奏的长名称参考',exact:true}).click();await expect(picker.getByRole('checkbox',{name:'风格3 · 限知视角与对白节奏的长名称参考',exact:true})).not.toBeChecked();await expect(entry).toContainText('风格 1 · 要求 1');assert.deepEqual((await call('book:get',{id:book.id})).writingSelection,{styleIds:[styles[29]],requirementIds:[requirements[0]]});await search.fill('');
 await expect(page.locator('#assistant-context-detail')).toContainText('已定稿前文');await expect(page.locator('#assistant-context-detail')).toContainText('世界设定');
 for(const theme of ['dark','light']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);for(const width of [1460,1024]){await page.setViewportSize({width,height:900});const openAssistant=page.getByRole('button',{name:'打开写作助手',exact:true});if(width<1200&&await openAssistant.isVisible().catch(()=>false))await openAssistant.click();await expect.poll(async()=>{const r=await entry.boundingBox();return r.x+r.width<=width+1;}).toBe(true);await expect(entry).toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(data,`references-${theme}-${width}.png`)});}}
 await page.setViewportSize({width:1460,height:680});await expect(entry).toBeVisible();await expect(page.getByRole('button',{name:'开始生成',exact:true})).toBeVisible();await page.screenshot({path:resolve(data,'references-low-height.png')});await page.setViewportSize({width:1460,height:900});
 await page.getByRole('button',{name:'开始生成',exact:true}).click();await expect(page.locator('.candidate-text')).toContainText('林晚收起');await expect(page.locator('.generation-activity')).toHaveAttribute('data-active','false');
 const prose=requests.find(r=>r.messages.some(m=>m.content.includes('根据本章大纲创作本章正文')));const sent=prose.messages.map(m=>m.content).join('\n');assert.match(sent,/STYLE-29/);assert.match(sent,/REQ-0/);assert.ok(!sent.includes('PRIVATE-SOURCE-29')&&!sent.includes('STYLE-0：'));
 const snapshot=page.locator('.candidate-reference-snapshot');await snapshot.locator('summary').first().click();await expect(snapshot).toContainText('风格29');await expect(snapshot).toContainText('第1章');
 await entry.click();await picker.getByRole('button',{name:'清空风格',exact:true}).click();await expect(entry).toContainText('风格 0 · 要求 1');await expect(snapshot).toContainText('风格29');
 // The manager closes the drawer at narrow widths and provides search/status filters.
 await page.setViewportSize({width:1024,height:900});await picker.getByRole('button',{name:'管理风格与要求',exact:true}).click();await expect(page.getByRole('heading',{name:'管理写作风格与要求',exact:true})).toBeVisible();
 const library=page.locator('.writing-library');await library.getByRole('searchbox',{name:'搜索此类资料',exact:true}).fill('等待蒸馏');await expect(library.locator('.writing-profile-row')).toHaveCount(1);
 await library.getByRole('combobox',{name:'资料状态',exact:true}).selectOption('selected');await expect(library).toContainText('没有匹配的资料');await library.getByRole('button',{name:'清除筛选',exact:true}).click();await expect(library.locator('.writing-profile-row')).toHaveCount(35);
 await library.getByRole('searchbox',{name:'搜索此类资料',exact:true}).fill('等待蒸馏');await library.getByRole('button',{name:'AI 蒸馏',exact:true}).click();await expect(page.locator('.candidate-text')).toContainText('蒸馏后的');await entry.click();await expect(page.locator('#assistant-context-detail')).toContainText('分析参考原文');await expect(page.locator('#assistant-context-detail')).not.toContainText('世界设定');
 assert.equal((await call('book:get',{id:book.id})).chapters[1].body,'');assert.deepEqual(errors,[]);
 await writeFile(resolve(data,'result.json'),JSON.stringify({status:'passed',profiles:60,checks:['always visible entry','many entries with bounded lists','selected-first groups','search by title/source','selected-only filter','clear each category','empty entries disabled','save failure rollback','actual request references','immutable candidate snapshot','library search/status','narrow drawer manage','low height and themes','distillation-only references']},null,2));console.log('Reference controls desktop passed: '+data);
}finally{await app.close();server.closeAllConnections();server.close();}
