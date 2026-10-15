import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const output=resolve('test-results/release-homepage');await mkdir(output,{recursive:true});
const data=await mkdtemp(resolve(output,'run-'));
const env={...process.env,XM_TEST:'1',XM_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;delete env.XM_DEV_URL;
const app=await electron.launch({args:['.'],env});
try{
 const page=await app.firstWindow();await page.setViewportSize({width:1460,height:900});
 const call=(action,data={})=>page.evaluate(async({action,data})=>{const result=await window.xingmiao.invoke(action,data);if(!result.ok)throw Error(result.error);return result.data;},{action,data});
 await expect(page.getByRole('heading',{name:'我的书架',exact:true})).toBeVisible();
 for(const [title,genre,premise] of [['风从山谷来','现实','一封迟到的信，让返乡的旅人重新认识这座小城。'],['末班车上的失物招领','短篇','司机在末班车里发现一把钥匙，决定找到它的主人。'],['雨港的旧钥匙','悬疑','旧书店即将关闭，林舟沿着三封未寄出的信追查父亲的往事。']]){
  const book=await call('book:create',{title,genre,premise,creationMode:genre==='短篇'?'short':'long',target:genre==='短篇'?6000:80000});
  await call('chapter:save',{id:book.chapters[0].id,revision:book.chapters[0].revision,patch:{body:'雨落下来时，林舟正在关书店的门。\n他把纸箱挪到灯下，一封没有邮票的信从书页间滑落。\n信封上写着父亲的名字。落款却是一个他从未听过的人。'}});
 }
 await page.reload();await expect(page.getByRole('button',{name:'打开 雨港的旧钥匙',exact:true})).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(250);
 await mkdir(resolve('docs/assets'),{recursive:true});await page.screenshot({path:resolve('docs/assets/library.png'),animations:'disabled'});
 await writeFile(resolve(data,'report.json'),JSON.stringify({singleScreenshot:true,isolatedDemo:true,path:'docs/assets/library.png'},null,2));
 console.log('One current homepage screenshot saved: '+resolve('docs/assets/library.png'));
}finally{await app.close();}
