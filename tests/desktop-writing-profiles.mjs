import {_electron as electron,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=resolve('test-results/writing-profiles');await mkdir(output,{recursive:true});const data=await mkdtemp(resolve(output,'run-'));
const requests=[],errors=[];const server=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const input=JSON.parse(raw);requests.push(input);const prompt=input.messages.map(m=>m.content).join('\n');const content=prompt.includes('没有变化返回')?'{"changes":[]}':prompt.includes('蒸馏可执行的写作要求')?'规则蒸馏结果：对白独立成段，避免重复解释。':prompt.includes('蒸馏可复用的写作风格')?'风格蒸馏结果：限知视角，短句对白，以动作呈现心理。':'林晚推开书店的门。雨水沿着伞骨滑下来。';res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const env={...process.env,XM_TEST:'1',XM_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;delete env.XM_DEV_URL;
let app=await electron.launch({args:['.'],env});
try{
 let page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 const call=(action,data={})=>page.evaluate(async({action,data})=>{const r=await window.xingmiao.invoke(action,data);if(!r.ok)throw Error(r.error);return r.data;},{action,data});
 await expect(page.getByRole('heading',{name:'我的书架',exact:true})).toBeVisible();
 const book=await call('book:create',{title:'风格资料专项'});await call('book:update',{id:book.id,patch:{style:'兼容旧风格'}});
 await call('config:save',{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',name:'隔离模型',maxTokens:4096});await page.reload();
 await page.getByRole('button',{name:/继续.*风格资料专项/}).click();
 const close=page.locator('.creation-guide-close');if(await close.isVisible().catch(()=>false))await close.click();
 await page.getByRole('tab',{name:'功能',exact:true}).click(); await page.getByRole('button',{name:'风格档案',exact:true}).click();
 const library=()=>page.locator('.writing-library');
 async function create(kind,title,body,source=''){
  await library().getByRole('tab',{name:new RegExp(kind==='style'?'写作风格':'写作要求')}).click();
  await library().getByRole('button',{name:kind==='style'?'新建写作风格':'新建写作要求',exact:true}).click();
  const modal=page.getByRole('dialog',{name:kind==='style'?'编辑写作风格':'编辑写作要求',exact:true});
  await modal.getByRole('textbox',{name:'名称',exact:true}).fill(title);await modal.getByRole('textbox',{name:kind==='style'?'风格内容':'要求内容',exact:true}).fill(body);
  if(source){const detail=modal.locator('.writing-source-editor');if(!await detail.getAttribute('open'))await detail.locator('summary').click();await modal.getByRole('textbox',{name:'蒸馏参考原文',exact:true}).fill(source);}
  await modal.getByRole('button',{name:'保存资料',exact:true}).click();await expect(modal).toHaveCount(0);
 }
 await create('style','短句风格','选中的短句风格','风格原文私有内容');await create('style','长句风格','未选择的长句风格');await create('requirement','段落要求','选中的段落要求','要求原文：对白独立成段');
 let current=await call('book:get',{id:book.id});assert.equal(current.writingProfiles.length,3);
 const row=library().locator('.writing-profile-row').filter({has:page.getByRole('heading',{name:'段落要求',exact:true})});
 await row.getByRole('button',{name:'AI 蒸馏',exact:true}).click();await expect(page.locator('.candidate-text')).toContainText('规则蒸馏结果');
 current=await call('book:get',{id:book.id});assert.equal(current.writingProfiles[2].body,'选中的段落要求');
 await page.getByRole('button',{name:'采用结果',exact:true}).click();await expect(row).toContainText('规则蒸馏结果');assert.ok(requests.at(-1).messages.some(m=>m.content.includes('蒸馏可执行的写作要求')));
 await library().getByRole('tab',{name:/写作风格/}).click();
 const styleRow=library().locator('.writing-profile-row').filter({has:page.getByRole('heading',{name:'短句风格',exact:true})});
 await styleRow.getByRole('button',{name:'AI 蒸馏',exact:true}).click();await expect(page.locator('.candidate-text')).toContainText('风格蒸馏结果');await page.getByRole('button',{name:'采用结果',exact:true}).click();
 // Import previews content instead of silently mutating a saved profile.
 const imported=resolve(data,'imported.txt');await writeFile(imported,'导入的要求内容','utf8');await app.evaluate(({dialog},file)=>{globalThis.originalWritingDialog=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},imported);
 await library().getByRole('tab',{name:/写作要求/}).click();await library().getByRole('button',{name:'新建写作要求',exact:true}).click();let modal=page.getByRole('dialog',{name:'编辑写作要求',exact:true});
 await modal.getByRole('button',{name:'导入风格或要求文件',exact:true}).click();await expect(modal.getByRole('textbox',{name:'要求内容',exact:true})).toHaveValue('导入的要求内容');await modal.getByRole('button',{name:'取消',exact:true}).click();
 assert.equal((await call('book:get',{id:book.id})).writingProfiles.length,3);await app.evaluate(({dialog})=>{dialog.showOpenDialog=globalThis.originalWritingDialog;});
 await page.getByRole('button',{name:'章节正文',exact:true}).click();await page.getByRole('tab',{name:'创作正文',exact:true}).click();await page.getByRole('button',{name:'本次参考资料',exact:false}).click();
 const picker=page.getByRole('region',{name:'风格参考',exact:true});await picker.getByRole('checkbox',{name:'本书风格档案',exact:true}).uncheck();await picker.getByRole('checkbox',{name:'短句风格',exact:true}).check();await picker.getByRole('checkbox',{name:'段落要求',exact:true}).check();
 await expect(picker.getByRole('checkbox',{name:'长句风格',exact:true})).not.toBeChecked();await page.screenshot({path:resolve(data,'selected-references.png')});await page.getByRole('button',{name:'开始生成',exact:true}).click();await expect(page.locator('.candidate-text')).toContainText('林晚推开');
 const prose=requests.findLast(input=>input.messages.some(m=>m.content.includes('根据本章大纲创作本章正文')));const sent=prose.messages.map(m=>m.content).join('\n');assert.match(sent,/风格蒸馏结果/);assert.match(sent,/规则蒸馏结果/);assert.ok(!sent.includes('未选择的长句风格')&&!sent.includes('风格原文私有内容')&&!sent.includes('兼容旧风格'));
 // Edit and delete a selected style, then restore it without silently selecting it.
 await page.getByRole('tab',{name:'功能',exact:true}).click(); await page.getByRole('button',{name:'风格档案',exact:true}).click();await library().getByRole('tab',{name:/写作风格/}).click();await styleRow.getByRole('button',{name:'编辑',exact:true}).click();modal=page.getByRole('dialog',{name:'编辑写作风格',exact:true});await modal.getByRole('textbox',{name:'名称',exact:true}).fill('短句风格修订');await modal.getByRole('button',{name:'保存资料',exact:true}).click();
 const updated=library().locator('.writing-profile-row').filter({has:page.getByRole('heading',{name:'短句风格修订',exact:true})});await updated.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('dialog',{name:'删除写作资料？',exact:true}).getByRole('button',{name:'删除',exact:true}).click();await expect(updated).toHaveCount(0);current=await call('book:get',{id:book.id});assert.deepEqual(current.writingSelection.styleIds,[]);assert.equal(current.chapters[0].body,'');
 await library().locator('.writing-trash summary').click();await library().locator('.writing-trash').getByRole('button',{name:'恢复',exact:true}).click();await expect(updated).toBeVisible();
 for(const theme of ['dark','light']){await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;localStorage.setItem('xm-theme',theme);},theme);for(const width of [1460,1024]){await page.setViewportSize({width,height:900});await expect(updated).toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(data,`profiles-${theme}-${width}.png`)});}}
 await app.close();app=await electron.launch({args:['.'],env});page=await app.firstWindow();await expect(page.getByRole('heading',{name:'我的书架',exact:true})).toBeVisible();current=await call('book:get',{id:book.id});assert.equal(current.writingProfiles.length,3);assert.deepEqual(current.writingSelection.styleIds,[]);assert.equal(current.writingSelection.requirementIds.length,1);assert.deepEqual(errors,[]);
 await writeFile(resolve(data,'result.json'),JSON.stringify({status:'passed',checks:['CRUD and restore','style and requirement distillation','preview before adoption','import cancellation','selected-only model context','legacy deselection','retained prose','themes and widths','restart persistence'],requests:requests.length},null,2));console.log('Writing profiles desktop passed: '+data);
}finally{if(app)await app.close();server.close();}
