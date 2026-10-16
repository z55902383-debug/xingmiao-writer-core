import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve('test-results/writing-requirements');await mkdir(root,{recursive:true});const data=await mkdtemp(resolve(root,'run-'));
const requests=[],errors=[];
const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'林晚收好信封，走出邮局。'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const env={...process.env,XM_TEST:'1',XM_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;delete env.XM_DEV_URL;
const app=await electron.launch({args:['.'],env});
try {
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'});
  const call=(action,args={})=>page.evaluate(async({action,args})=>{const r=await window.xingmiao.invoke(action,args);if(!r.ok)throw Error(r.error);return r.data;},{action,args});
  await expect(page.getByRole('heading',{name:'我的书架',exact:true})).toBeVisible();
  let book=await call('book:create',{title:'要求选择同步',premise:'林晚寻找信件'});
  book=await call('book:update',{id:book.id,patch:{style:'VOICE-KEEP 原有风格',outline:'寻找信件'}});
  for(const profile of [{kind:'requirement',title:'对白独立成段',body:'REQ-A 对白独立成段'},{kind:'requirement',title:'保留原有事件与人物知情边界，避免重复解释和提前揭示',body:'REQ-B 保留事件与知情边界'},{kind:'requirement',title:'待蒸馏要求',body:'',source:'PRIVATE-PENDING'}])await call('writing:save',{bookId:book.id,profile});
  book=await call('book:get',{id:book.id});const [a,b]=book.writingProfiles;
  await call('config:save',{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture'});
  await page.reload();await page.getByRole('button',{name:/继续.*要求选择同步/}).click();await page.getByRole('tab',{name:'功能',exact:true}).click();await page.getByRole('button',{name:'风格档案',exact:true}).click();
  const library=page.getByRole('region',{name:'写作资料库',exact:true});await library.getByRole('tab',{name:/写作要求/}).click();
  const tags=library.getByRole('group',{name:'快速选择写作要求',exact:true});
  await expect(tags.getByRole('button',{name:'待蒸馏要求',exact:true})).toBeDisabled();await expect(library.getByRole('checkbox',{name:'待蒸馏要求',exact:true})).toBeDisabled();
  const tagA=tags.getByRole('button',{name:a.title,exact:true}),tagB=tags.getByRole('button',{name:b.title,exact:true});
  await tagA.focus();await tagA.press('Space');await expect(tagA).toHaveAttribute('aria-pressed','true');await expect(library.getByRole('checkbox',{name:a.title,exact:true})).toBeChecked();
  await library.getByRole('checkbox',{name:b.title,exact:true}).check();await expect(tagB).toHaveAttribute('aria-pressed','true');
  await expect.poll(async()=>(await call('book:get',{id:book.id})).writingSelection.requirementIds).toEqual([a.id,b.id]);
  const originalStyles=(await call('book:get',{id:book.id})).writingSelection;
  await page.locator('.compose-reference-trigger').click();const picker=page.getByRole('region',{name:'风格参考',exact:true});await picker.getByRole('tab',{name:/写作要求/}).click();
  await expect(picker.getByRole('checkbox',{name:a.title,exact:true})).toBeChecked();await expect(picker.getByRole('checkbox',{name:b.title,exact:true})).toBeChecked();
  await picker.getByRole('checkbox',{name:a.title,exact:true}).uncheck();await expect(tagA).toHaveAttribute('aria-pressed','false');await expect(library.getByRole('checkbox',{name:a.title,exact:true})).not.toBeChecked();
  let selected=(await call('book:get',{id:book.id})).writingSelection;assert.deepEqual(selected.requirementIds,[b.id]);assert.deepEqual(selected.styleIds,originalStyles.styleIds);assert.deepEqual(selected.styleWeights,originalStyles.styleWeights);
  // Reject one save to verify that all three controls return to the persisted choice.
  await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('xm:invoke');let fail=true;ipcMain.removeHandler('xm:invoke');ipcMain.handle('xm:invoke',async(...args)=>{if(fail&&args[1]==='writing:select'){fail=false;return{ok:false,error:'测试保存失败，保留原选择'};}return original(...args);});});
  await tagB.click();await expect(tagB).toHaveAttribute('aria-pressed','true');await expect(library.getByRole('checkbox',{name:b.title,exact:true})).toBeChecked();await expect(library.getByRole('alert')).toContainText('测试保存失败');
  const job=await call('ai:generate',{bookId:book.id,chapterId:book.chapters[0].id,kind:'write',skillIds:[],analyzeChanges:false});
  await expect.poll(async()=>(await call('book:get',{id:book.id})).candidates.find(r=>r.id===job.id)?.status).toBe('done');
  const payload=JSON.parse(requests[0].messages.find(r=>r.role==='user').content.split('以下 JSON 为资料数据：\n')[1]);
  assert.deepEqual(payload.references.writingReferences.filter(r=>r.kind==='requirement').map(r=>r.id),[b.id]);assert.equal(payload.references.writingReferences.find(r=>r.id===b.id).weight,undefined);assert.match(JSON.stringify(requests),/VOICE-KEEP/);assert.doesNotMatch(JSON.stringify(requests),/REQ-A|PRIVATE-PENDING/);
  for(const [width,theme] of [[1464,'dark'],[1464,'light'],[1024,'dark']]){
    await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    if(width===1024){const close=page.locator('.assistant-panel').getByRole('button',{name:'关闭写作助手',exact:true});if(await close.first().isVisible().catch(()=>false))await close.first().click();}
    await tags.scrollIntoViewIfNeeded();assert.ok(await tags.evaluate(el=>el.scrollWidth<=el.clientWidth));
    await page.screenshot({path:resolve(data,`requirements-${theme}-${width}.png`),animations:'disabled'});
  }
  await page.reload();await page.getByRole('button',{name:/继续.*要求选择同步/}).click();await page.getByRole('tab',{name:'功能',exact:true}).click();await page.getByRole('button',{name:'风格档案',exact:true}).click();await library.getByRole('tab',{name:/写作要求/}).click();await expect(tagB).toHaveAttribute('aria-pressed','true');await expect(tagA).toHaveAttribute('aria-pressed','false');
  assert.deepEqual(errors,[]);await writeFile(resolve(data,'report.json'),JSON.stringify({status:'passed',checks:['tag and checkbox selection','assistant bidirectional sync','disabled pending content','independent style weights','save failure rollback','actual request contains only chosen requirement','reload persistence','dark/light and narrow layout'],errors},null,2));
  console.log('Writing requirements passed: '+data);
}finally{await app.close();await new Promise(r=>server.close(r));}
