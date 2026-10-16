import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve('test-results/candidate-references');await mkdir(root,{recursive:true});
const data=await mkdtemp(resolve(root,'run-'));
const env={...process.env,XM_TEST:'1',XM_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;delete env.XM_DEV_URL;
const app=await electron.launch({args:['.'],env});const errors=[];
try {
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'});
  const call=(action,args={})=>page.evaluate(async({action,args})=>{const r=await window.xingmiao.invoke(action,args);if(!r.ok)throw Error(r.error);return r.data;},{action,args});
  await expect(page.getByRole('heading',{name:'我的书架',exact:true})).toBeVisible();
  let book=await call('book:create',{title:'历史参考准确性'});
  await call('imitation:save',{bookId:book.id,profile:{title:'当前对标',body:'当前故事骨架',source:'原文'}});
  await call('writing:save',{bookId:book.id,profile:{kind:'requirement',title:'段落要求',body:'短段落',source:'样本'}});
  book=await call('book:get',{id:book.id});const im=book.imitationProfiles[0],requirement=book.writingProfiles[0];
  await call('imitation:select',{bookId:book.id,selection:{ids:[im.id],weights:{[im.id]:100}}});
  await app.evaluate(({app},input)=>{
    const req=process.mainModule.require.bind(process.mainModule),{createRequire}=req('node:module'),{join}=req('node:path');
    const local=createRequire(join(input.project,'package.json')),{Store}=local('./electron/store.cjs');
    const db=new Store(join(app.getPath('userData'),'xingmiao.sqlite'));
    try {
      const base={bookId:input.book.id,chapterId:input.book.chapters[0].id,baseRevision:input.book.chapters[0].revision,kind:'style',status:'done',adopted:true,error:'',instruction:'',createdAt:new Date().toISOString(),profileName:'历史模型配置',model:'fixture-model',output:'已保存的分析条目。',writingProfileSnapshot:input.requirement};
      const minimal={warnings:[],memoryCount:0,chapterCount:0,characterCount:0};
      db.putJob({...base,id:'full',context:{...minimal,characters:12345,referenceSections:[{key:'writingStyles',group:'writing',count:1,titles:['历史风格']},{key:'imitationReferences',group:'writing',count:1,titles:['历史对标']}],imitationReferences:[{id:'historical-im',kind:'imitation',title:'历史对标',body:'历史故事骨架',weight:100,revision:1}],writingReferences:[{id:'historical-style',kind:'style',title:'历史风格',body:'历史语感',weight:100}],skills:[{id:'s1',name:'检查',version:1},{id:'s2',name:'对白',version:1}]}});
      db.putJob({...base,id:'zero',context:{...minimal,writingReferences:[],skills:[]}});
      db.putJob({...base,id:'old',context:{...minimal,characters:174847}});
    }finally{db.close();}
  },{project:resolve('.'),book,requirement});
  await page.reload();await page.getByRole('button',{name:/继续.*历史参考准确性/}).click();
  const history=page.getByRole('combobox',{name:'生成记录',exact:true}),snapshot=page.locator('.candidate-reference-snapshot'),summary=snapshot.locator(':scope > summary');
  await history.selectOption('old');await summary.click();
  await expect(summary).toContainText('仿写 未记录 · 风格 未记录 · 要求 未记录');
  await expect(snapshot).toContainText('未记录不代表未使用');await expect(snapshot).toContainText('当时输入约 174,847 字符');
  await expect(page.locator('.candidate-source').first()).toContainText('Skill 未记录');
  await expect(page.locator('.candidate-state-panel')).toContainText('已写入：写作要求 → 段落要求。');
  await expect(page.locator('.compose-reference-trigger')).toContainText('下次生成参考');
  const help=snapshot.locator('.reference-input-help');await help.locator('summary').focus();await help.locator('summary').press('Enter');await expect(help).toContainText('不是生成字数，也不是 Token 数');
  await page.setViewportSize({width:1464,height:900});await page.screenshot({path:resolve(data,'old-dark.png'),animations:'disabled'});
  await history.selectOption('zero');await expect(summary).toContainText('仿写 未记录 · 风格 0 · 要求 0');
  await expect(page.locator('.candidate-source').first()).toContainText('Skill 0');await expect(snapshot).toContainText('输入字符数未记录');await expect(snapshot).not.toContainText('NaN');
  await history.selectOption('full');await expect(summary).toContainText('仿写 1 · 风格 1 · 要求 0');await expect(snapshot).toContainText('历史对标');await expect(snapshot).toContainText('历史风格');
  await expect(page.locator('.candidate-source').first()).toContainText('Skill 2');
  await call('imitation:select',{bookId:book.id,selection:{ids:[],weights:{}}});await page.reload();await page.getByRole('button',{name:/继续.*历史参考准确性/}).click();await history.selectOption('full');
  await expect(summary).toContainText('仿写 1 · 风格 1 · 要求 0');await expect(page.locator('.compose-reference-trigger')).toContainText('仿写 0');
  if(!(await snapshot.evaluate(el=>el.open)))await summary.click();
  for(const [width,theme] of [[1464,'light'],[1024,'dark']]){
    await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const open=page.getByRole('button',{name:'打开写作助手',exact:true});if(await open.isVisible().catch(()=>false))await open.click();
    await summary.scrollIntoViewIfNeeded();const bounds=await summary.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
    assert.ok(await summary.evaluate(el=>el.scrollWidth<=el.clientWidth));
    await page.screenshot({path:resolve(data,`full-${theme}-${width}.png`),animations:'disabled'});
  }
  assert.deepEqual(errors,[]);await writeFile(resolve(data,'report.json'),JSON.stringify({status:'passed',checks:['historical unknown vs explicit zero','character units and missing count','actual adoption target','snapshot independent of current selection','dark/light and narrow summary layout'],errors},null,2));
  console.log('Candidate references passed: '+data);
}finally{await app.close();}
