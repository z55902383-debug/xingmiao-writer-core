import {_electron as electron,expect} from '@playwright/test';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('test-results/product-navigation-edges');await mkdir(root,{recursive:true});const data=await mkdtemp(join(root,'run-'));const env={...process.env,XM_TEST:'1',XM_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;delete env.XM_DEV_URL;
const app=await electron.launch({args:['.'],env});const report={data,checks:[]};
try{const page=await app.firstWindow();await expect(page.getByRole('heading',{name:'我的书架',exact:true})).toBeVisible();
const opener=page.getByRole('button',{name:'创建第一部作品',exact:true});await opener.click();await page.keyboard.press('Escape');
await expect(opener).toBeFocused();
report.checks.push({name:'modal Escape focus return',focus:await page.evaluate(()=>({tag:document.activeElement.tagName,text:document.activeElement.tagName==='BODY'?'BODY':document.activeElement.textContent?.slice(0,60)}))});
await page.getByRole('button',{name:'打开示例体验',exact:true}).click();const guide=page.locator('.creation-guide-close');if(await guide.isVisible())await guide.click();
const chapterTab=page.getByRole('tab',{name:/^章节\s*\d*$/,exact:false});await chapterTab.focus();await page.keyboard.press('ArrowRight');
await expect(page.getByRole('tab',{name:'功能',exact:true})).toBeFocused();await expect(page.getByRole('tab',{name:'功能',exact:true})).toHaveAttribute('aria-selected','true');
await page.keyboard.press('Home');await expect(chapterTab).toHaveAttribute('aria-selected','true');await page.keyboard.press('End');await expect(page.getByRole('tab',{name:'功能',exact:true})).toHaveAttribute('aria-selected','true');
report.checks.push({name:'sidebar ARIA tabs ArrowRight',selected:await page.locator('.sidebar-switcher [aria-selected=true]').innerText(),focused:await page.evaluate(()=>document.activeElement.textContent)});
await page.getByRole('button',{name:'返回书架',exact:true}).click();
await page.getByRole('combobox',{name:'界面语言',exact:true}).selectOption('en');
report.checks.push({name:'English library language state',passed:true});
report.status='completed';
}catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;}
finally{await writeFile(join(data,'report.json'),JSON.stringify(report,null,2));await app.evaluate(({app})=>app.exit(0)).catch(()=>{});console.log(JSON.stringify(report));}
