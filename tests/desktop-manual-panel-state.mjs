import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import {mkdir,mkdtemp,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
const root=resolve("test-results/manual-panel-state"); await mkdir(root,{recursive:true});
const dataDir=await mkdtemp(resolve(root,"run-")), output=resolve(dataDir,"verification"); await mkdir(output);
const env={...process.env,XM_TEST:"1",XM_DATA_DIR:dataDir}; delete env.ELECTRON_RUN_AS_NODE; delete env.XM_DEV_URL;
const skip=process.argv.includes("--no-screenshots"), checks=[], screenshots=[], errors=[];
let app,page;
const ideas=()=>page.getByRole("complementary",{name:"灵感助手",exact:true});
const memos=()=>page.getByRole("complementary",{name:"作品备忘录",exact:true});
const control=(name)=>page.getByRole("group",{name:"视图",exact:true}).getByRole("button",{name,exact:true});
const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem("xm-manual-panel-state-v1")||"null"));
async function check(name,fn){await fn();checks.push(name);console.log(`Passed: ${name}`);}
async function launch(){app=await electron.launch({args:["."],env});assert.equal(resolve(await app.evaluate(({app})=>app.getPath("userData"))),dataDir);page=await app.firstWindow();page.setDefaultTimeout(12000);page.on("pageerror",e=>errors.push(e.message));await page.setViewportSize({width:1460,height:900});await expect(page.getByRole("button",{name:/人工码字板/})).toBeVisible();}
async function enter(){await page.getByRole("button",{name:/人工码字板/}).click();await expect(page.getByRole("textbox",{name:"码字正文",exact:true})).toBeVisible();}
async function back(){await page.getByRole("button",{name:"返回书架",exact:true}).click();await expect(page.getByRole("textbox",{name:"码字正文",exact:true})).not.toBeVisible();}
async function theme(value){const toggle=page.getByRole("button",{name:value==="light"?"浅色模式":"深色模式",exact:true});if(await toggle.count())await toggle.click();await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.theme==="light"?"light":"dark")).toBe(value);await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.themeReveal||"")).toBe("");}
async function shot(name){if(skip)return;await page.screenshot({path:resolve(output,name),animations:"disabled"});screenshots.push(name);}
try{
 await launch();await enter();
 await check("first entry leaves both panels closed and writing controls available",async()=>{
  await expect(ideas()).not.toBeVisible();await expect(memos()).not.toBeVisible();
  await expect(control("灵感助手")).toHaveAttribute("aria-pressed","false");await expect(control("备忘录")).toHaveAttribute("aria-pressed","false");
  assert.equal(await state(),null);
  for(const value of ["dark","light"]){await theme(value);await shot(`wide-${value}-default.png`);}
 });
 await check("the empty guidance area is absent and the composer receives the freed space",async()=>{
  await control("灵感助手").click();await expect(ideas()).toBeVisible();
  await expect(ideas().getByRole("log",{name:"灵感对话",exact:true})).toHaveCount(0);
  await expect(ideas().locator(".mt-idea-empty")).toHaveCount(0);
  for(const size of [{name:"wide",width:1460,height:900},{name:"compact",width:900,height:700}]){
   await page.setViewportSize({width:size.width,height:size.height});
   for(const value of ["dark","light"]){await theme(value);
    const panel=await ideas().boundingBox(),text=await ideas().getByRole("textbox",{name:"创意构思",exact:true}).boundingBox(),button=await ideas().getByRole("button",{name:"开始构思",exact:true}).boundingBox();
    assert.ok(text.height>=(size.name==="wide"?180:80));assert.ok(button.y+button.height<=panel.y+panel.height+1);
    await shot(`${size.name}-${value}-empty-composer.png`);
   }
  }
  await page.setViewportSize({width:1460,height:900});
  await ideas().getByRole("textbox",{name:"创意构思",exact:true}).fill("下次继续构思的草稿。");
 });
 await check("toolbar choices survive leaving and returning to the writing pad",async()=>{
  await control("备忘录").click();await expect(ideas()).toBeVisible();await expect(memos()).toBeVisible();
  assert.deepEqual(await state(),{version:1,ideas:true,memos:true,last:"memos"});
  await back();await enter();await expect(ideas()).toBeVisible();await expect(memos()).toBeVisible();
  await expect(ideas().getByRole("textbox",{name:"创意构思",exact:true})).toHaveValue("下次继续构思的草稿。");
 });
 await check("focus and window adaptation preserve the saved panel preferences",async()=>{
  const saved=await state();await page.keyboard.press("F11");await expect(ideas()).not.toBeVisible();await expect(memos()).not.toBeVisible();assert.deepEqual(await state(),saved);
  await page.keyboard.press("Escape");await expect(ideas()).toBeVisible();await expect(memos()).toBeVisible();
  await page.setViewportSize({width:900,height:700});await expect(ideas()).not.toBeVisible();await expect(memos()).toBeVisible();assert.deepEqual(await state(),saved);
  await page.setViewportSize({width:1460,height:900});await expect(ideas()).toBeVisible();await expect(memos()).toBeVisible();
 });
 await check("panel state survives a full isolated restart",async()=>{
  await back();await app.close();app=null;await launch();await enter();await expect(ideas()).toBeVisible();await expect(memos()).toBeVisible();
 });
 await check("narrow-window user choices and panel close buttons are remembered",async()=>{
  await page.setViewportSize({width:900,height:700});await control("灵感助手").click();await expect(ideas()).toBeVisible();await expect(memos()).not.toBeVisible();
  assert.deepEqual(await state(),{version:1,ideas:true,memos:false,last:"ideas"});
  await ideas().getByRole("button",{name:"收起灵感助手",exact:true}).click();await expect(ideas()).not.toBeVisible();await expect(memos()).not.toBeVisible();
  await page.setViewportSize({width:1460,height:900});await back();await enter();await expect(ideas()).not.toBeVisible();await expect(memos()).not.toBeVisible();
  await control("备忘录").click();await memos().getByRole("button",{name:"收起备忘录",exact:true}).click();await expect(memos()).not.toBeVisible();
  await back();await app.close();app=null;await launch();await enter();await expect(ideas()).not.toBeVisible();await expect(memos()).not.toBeVisible();
 });
 assert.deepEqual(errors,[]);checks.push("no renderer exceptions");
}finally{await writeFile(resolve(output,"report.json"),JSON.stringify({checks,screenshots,errors,dataDir},null,2));if(app)await app.close().catch(()=>{});}
console.log(`Manual panel-state regression passed. ${output}`);
