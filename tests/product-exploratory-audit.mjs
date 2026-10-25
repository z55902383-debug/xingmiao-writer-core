import {_electron as electron,expect} from '@playwright/test';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const root=resolve('test-results/product-exploratory-audit');await mkdir(root,{recursive:true});
const data=await mkdtemp(join(root,'run-'));const env={...process.env,XM_TEST:'1',XM_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;delete env.XM_DEV_URL;
const app=await electron.launch({args:['.'],env});const report={data,views:[],checks:[],errors:[]};
let page;
try {
  page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));
  const call=(action,args={})=>page.evaluate(async({action,args})=>{const r=await window.xingmiao.invoke(action,args);if(!r.ok)throw Error(r.error);return r.data;},{action,args});
  await expect(page.getByRole('heading',{name:'我的书架',exact:true})).toBeVisible();
  const axeSource=await readFile(require.resolve('axe-core/axe.min.js'),'utf8');
  await page.evaluate(axeSource);
  async function scan(name,shot=true){
    await page.waitForTimeout(750);
    const item=await page.evaluate(async name=>{
      const axe=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});
      const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
      const tiny=[...document.querySelectorAll('button,input:not([type=hidden]),select,summary,[role=tab]')].filter(visible).map(el=>{const r=el.getBoundingClientRect();return {name:el.getAttribute('aria-label')||el.innerText?.slice(0,60)||el.title||el.id,width:Math.round(r.width),height:Math.round(r.height)}}).filter(r=>r.width<24||r.height<24);
      return {name,width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme,overflow:document.documentElement.scrollWidth-innerWidth,tinyTargets:tiny,violations:axe.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,helpUrl:v.helpUrl,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary,html:n.html.slice(0,400)}))}))};
    },name);
    if(shot){item.screenshot=join(data,name+'.png');await page.screenshot({path:item.screenshot,animations:'disabled'});}
    report.views.push(item);await writeFile(join(data,'report.json'),JSON.stringify(report,null,2));
    console.log(`${name}: ${item.violations.length} axe rules, overflow ${item.overflow}px`);
  }
  await page.setViewportSize({width:1464,height:900});await scan('01-empty-shelf-dark');
  await page.getByRole('button',{name:'创建第一部作品',exact:true}).click();await scan('02-new-book-dialog');
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'创建第一部作品',exact:true})).toBeFocused();report.checks.push({name:'new book Escape returns focus',passed:true});
  const title='全链路压力测试：很长的作品名称与中文标点《雨夜归还》';
  let book=await call('book:create',{title,genre:'都市校园',premise:'核对旧伞内的字条',target:10000});
  await call('book:update',{id:book.id,patch:{world:'普通现实世界。'.repeat(180),outline:'目标、冲突与结局。'.repeat(150)}});
  for(let i=0;i<11;i++)await call('chapter:create',{bookId:book.id});
  const other=await call('book:create',{title:'隔离验证作品乙',premise:'不得出现甲书内容'});
  await page.reload();await expect(page.getByRole('button',{name:'打开 '+title,exact:true})).toBeVisible();
  await page.evaluate(axeSource);
  await scan('03-populated-shelf-dark');
  await page.getByRole('button',{name:'打开 '+title,exact:true}).click();
  const closeGuide=page.locator('.creation-guide-close');if(await closeGuide.isVisible())await closeGuide.click();
  const editor=page.getByRole('textbox',{name:'章节正文',exact:true});await expect(editor).toBeVisible();
  await editor.fill('甲书快速输入后立刻切换页面，内容必须保存。');
  await page.getByRole('tab',{name:'功能',exact:true}).click();await page.locator('.workspace-nav').getByRole('button',{name:'世界设定',exact:true}).click();
  await page.locator('.workspace-nav').getByRole('button',{name:'章节正文',exact:true}).click();
  await expect(editor).toHaveValue('甲书快速输入后立刻切换页面，内容必须保存。');
  await page.getByRole('button',{name:'返回书架',exact:true}).click();
  book=await call('book:get',{id:book.id});assert.equal(book.chapters[0].body,'甲书快速输入后立刻切换页面，内容必须保存。');
  assert.equal((await call('book:get',{id:other.id})).chapters[0].body,'');
  report.checks.push({name:'rapid navigation autosave and book isolation',passed:true});
  await page.getByRole('button',{name:'打开 '+title,exact:true}).click();
  await app.evaluate(({ipcMain})=>{
    const original=ipcMain._invokeHandlers.get('xm:invoke');ipcMain.removeHandler('xm:invoke');
    let rejectOnce=true;
    ipcMain.handle('xm:invoke',(...args)=>{if(args[1]==='chapter:save'&&rejectOnce){rejectOnce=false;return {ok:false,error:'测试：模拟磁盘写入失败'}}return original(...args)});
  });
  await editor.fill('保存失败后仍须保留的手写正文。');
  await page.getByRole('button',{name:'返回书架',exact:true}).click();
  await expect(editor).toHaveValue('保存失败后仍须保留的手写正文。');
  await page.keyboard.press('Control+s');
  await expect.poll(async()=>(await call('book:get',{id:book.id})).chapters[0].body).toBe('保存失败后仍须保留的手写正文。');
  report.checks.push({name:'failed save blocks leaving and supports retry without lost prose',passed:true});
  await page.getByRole('tab',{name:'功能',exact:true}).click();
  for(const [key,label] of [['editor','章节正文'],['outline','故事大纲'],['characters','人物档案'],['world','世界设定'],['atlas','知识蓝图'],['cheat','金手指'],['memory','关系与记忆'],['notes','备忘录'],['style','风格档案'],['imitation','仿写对标']]){
    await page.locator('.workspace-nav').getByRole('button',{name:label,exact:true}).click();
    await page.setViewportSize({width:1464,height:900});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await scan('04-'+key+'-dark');
    await page.setViewportSize({width:1024,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');await scan('05-'+key+'-compact-light');
  }
  await page.setViewportSize({width:1464,height:900});
  await page.getByRole('button',{name:'模型与设置',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'模型与本地设置',exact:true});
  const tabs=await settings.locator('.settings-nav button').allTextContents();
  for(let i=0;i<tabs.length;i++){await settings.locator('.settings-nav button').nth(i).click();await scan('06-settings-'+i);}
  await settings.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  await page.getByRole('button',{name:'返回书架',exact:true}).click();
  await page.getByRole('button',{name:'新建作品',exact:true}).click();
  await page.getByLabel('书名 *',{exact:true}).fill('尚未提交的新书构思');
  await page.getByLabel('故事灵感',{exact:true}).fill('误按Escape之前写下的长篇构思。');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'新建作品',exact:true}).click();
  report.checks.push({name:'new book draft after Escape and reopening',title:await page.getByLabel('书名 *',{exact:true}).inputValue(),premise:await page.getByLabel('故事灵感',{exact:true}).inputValue()});
  await expect(page.getByLabel('书名 *',{exact:true})).toHaveValue('尚未提交的新书构思');
  await expect(page.getByLabel('故事灵感',{exact:true})).toHaveValue('误按Escape之前写下的长篇构思。');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:/人工码字板/}).click();await scan('07-manual-writing');
  await page.setViewportSize({width:1024,height:600});await scan('08-manual-low-height');
  assert.ok(report.views.every(view=>view.violations.length===0), '可访问性检查仍有未解决问题，参见report.json');
  report.status='completed';
}catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;if(page)await page.screenshot({path:join(data,'failure.png')}).catch(()=>{});}
finally{await writeFile(join(data,'report.json'),JSON.stringify(report,null,2));await app.evaluate(({app})=>app.exit(0)).catch(()=>{});console.log('Exploratory report: '+join(data,'report.json'));}
