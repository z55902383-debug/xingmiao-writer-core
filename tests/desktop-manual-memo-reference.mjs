import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { splitMemoSections } from "../electron/memo-sections.mjs";

const root = resolve("test-results/manual-memo-reference");
await mkdir(root, { recursive: true });
const dataDir = await mkdtemp(resolve(root, "run-"));
const output = resolve(dataDir, "verification");
await mkdir(output, { recursive: true });
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
const screenshots = [], checks = [], requests = [], errors = [];
const skipScreenshots = process.argv.includes("--no-screenshots");
let app, page, call, book, chapter, secondaryBook;
const content = "# 雨夜构思\r\n第一条：雨伞😀在书店消失。\r\n\r\n第二条：未选秘密藏在阁楼。\r\n\r\n第三条：寻找失物的人来自月球。";
const duplicate = "# 角色甲\n身份：医生\n\n# 角色乙\n身份：医生";
const longContent = "# 灵感资料\n\n" + Array.from({length: 60}, (_, i) => `- 想法${i + 1}：雨夜的书店里，每一封信都通往一个不同的故事。`).join("\n");
const server = createServer(async (req, res) => {
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    res.writeHead(200, {"content-type": "text/event-stream"});
    res.end(`data: ${JSON.stringify({choices:[{delta:{content:"可选方向：先寻找这个决定背后的动机，再比较两种可能。"},finish_reason:"stop"}]})}\n\ndata: [DONE]\n\n`);
  } catch (error) { res.writeHead(500).end(String(error)); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const memoPanel = () => page.getByRole("complementary", {name:"作品备忘录", exact:true});
const ideaPanel = () => page.getByRole("complementary", {name:"灵感助手", exact:true});
const memoArea = () => memoPanel().getByRole("textbox", {name:"备忘录内容", exact:true});
const picker = () => page.getByRole("dialog", {name:"选择备忘录参考内容", exact:true});
async function check(name, fn) {
  await fn(); checks.push(name); console.log(`Passed: ${name}`);
}
async function launch() {
  app = await electron.launch({args:["."], env});
  assert.equal(resolve(await app.evaluate(({app}) => app.getPath("userData"))), dataDir);
  page = await app.firstWindow(); page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({width:1460, height:900});
  call = (action, data={}) => page.evaluate(async ({action,data}) => {
    const result = await window.xingmiao.invoke(action,data);
    if (!result.ok) throw Error(result.error);
    return result.data;
  }, {action,data});
  await expect(page.getByRole("button", {name:/人工码字板/})).toBeVisible();
}
async function openManual() {
  await page.getByRole("button", {name:/人工码字板/}).click();
  await page.getByRole("button", {name:"选择章节",exact:true}).click();
  const dialog = page.getByRole("dialog", {name:"选择章节",exact:true});
  await dialog.getByRole("button", {name:new RegExp(book.title)}).click();
  await dialog.locator(".mt-picker-chapters").getByRole("button", {name:new RegExp(chapter.title)}).click();
  await expect(dialog).not.toBeVisible();
  await showIdeas();
  await showMemos();
}
async function showIdeas() {
  if (!await ideaPanel().isVisible()) await page.getByRole("button", {name:"灵感助手",exact:true}).click();
  await expect(ideaPanel()).toBeVisible();
}
async function showMemos() {
  if (!await memoPanel().isVisible()) await page.getByRole("button", {name:"备忘录",exact:true}).click();
  await expect(memoPanel()).toBeVisible();
}
async function selectNote(id) {
  await showMemos(); await memoPanel().locator(`[data-memo-id="${id}"]`).click();
}
async function openPicker() {
  const toast=page.locator(".toast");
  if(await toast.isVisible()) await toast.getByRole("button",{name:"关闭提示",exact:true}).click();
  await showIdeas(); await ideaPanel().getByRole("button", {name:"选择参考内容",exact:true}).click();
  await expect(picker()).toBeVisible();
}
async function parts(clear=true) {
  await openPicker(); await picker().getByRole("radio", {name:"指定内容",exact:true}).check();
  if (clear) await picker().getByRole("button", {name:"清空选择",exact:true}).click();
}
async function block(id) { await picker().locator(`[data-reference-block="${id}"]`).check(); }
async function confirm() { await picker().getByRole("button", {name:"确定",exact:true}).click(); await expect(picker()).not.toBeVisible(); }
function source(request) {
  const line = request.messages.flatMap((message) => message.content.split("\n")).find((line) => line.startsWith("{") && line.endsWith("}"));
  assert.ok(line); return JSON.parse(line);
}
async function brainstorm(idea) {
  const before = requests.length;
  await ideaPanel().getByRole("textbox", {name:"创意构思",exact:true}).fill(idea);
  await ideaPanel().getByRole("button", {name:"开始构思",exact:true}).click();
  await expect.poll(() => requests.length).toBe(before+1);
  await expect(ideaPanel().getByRole("button", {name:"开始构思",exact:true})).toBeEnabled();
  return requests.at(-1);
}
async function snapshot(file) {
  if (skipScreenshots) return;
  const toast=page.locator(".toast");
  if (await toast.isVisible() && !await page.locator("dialog[open]").count())
    await toast.getByRole("button",{name:"关闭提示",exact:true}).click();
  await expect(toast).not.toBeVisible();
  await page.screenshot({path:resolve(output,file),animations:"disabled"}); screenshots.push(file);
}
async function theme(value) {
  const button=page.getByRole("button", {name:value==="light"?"浅色模式":"深色模式",exact:true});
  if (await button.count()) await button.click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme==="light"?"light":"dark")).toBe(value);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.themeReveal||"")).toBe("");
}
try {
  await launch();
  book=await call("book:create", {title:"参考范围验证",genre:"悬疑"});
  const now=new Date().toISOString();
  book=await call("book:update", {id:book.id,patch:{memos:[
    {id:"memo-main",title:"三条构思",content,createdAt:now,updatedAt:now},
    {id:"memo-duplicate",title:"重复身份",content:duplicate,createdAt:now,updatedAt:now},
    {id:"memo-long",title:"一条供写作时完整对照的长篇备忘录".repeat(6),content:longContent,createdAt:now,updatedAt:now},
  ]}});
  chapter=await call("chapter:save", {id:book.chapters[0].id,revision:book.chapters[0].revision,patch:{title:"第1章 书店",body:"　　正文保持不变。"}});
  secondaryBook=await call("book:create",{title:"参考范围乙书",genre:"科幻"});
  secondaryBook=await call("book:update",{id:secondaryBook.id,patch:{memos:[
    {id:"memo-secondary",title:"乙书想法",content:"身份：老师\n\n任务：寻找钟表。",createdAt:now,updatedAt:now}
  ]}});
  await call("config:save", {provider:"api",model:"reference-fixture",baseUrl,apiKey:"local-fixture-only",maxTokens:4096,temperature:0.8});
  await page.reload(); await openManual();
  const originalChapter=(await call("book:get",{id:book.id})).chapters[0];
  const blocks=splitMemoSections(content);
  await check("whole-note mode remains compatible, and empty partial selection cannot be confirmed", async () => {
    const request=await brainstorm("整篇旧讨论标记");
    assert.equal(source(request).memos[0].content,content);
    await parts(); await expect(picker().getByRole("button",{name:"确定",exact:true})).toBeDisabled();
    await block(blocks[1].id); await confirm();
  });
  await check("single and multiple references transmit only the selected source, with isolated conversation history", async () => {
    const request=await brainstorm("讨论第一条");
    assert.equal(source(request).memos[0].content,content.slice(blocks[1].start,blocks[1].end));
    assert.ok(!JSON.stringify(request).includes("整篇旧讨论标记"));
    assert.ok(!JSON.stringify(request).includes("未选秘密"));
    await parts(); await block(blocks[1].id); await block(blocks[3].id); await confirm();
    const multi=await brainstorm("讨论两条");
    assert.equal(source(multi).memos[0].content,[blocks[1],blocks[3]].map((block)=>content.slice(block.start,block.end)).join("\n\n"));
    assert.ok(!JSON.stringify(multi).includes("未选秘密"));
    await openPicker(); await picker().getByRole("radio",{name:"整篇备忘录",exact:true}).check();
    await picker().getByRole("button",{name:"取消",exact:true}).click();
    assert.equal(source(await brainstorm("取消不改变选择")).memos[0].ranges.length,2);
  });
  await check("manual snippets preserve CRLF offsets and complete emoji, and can be accumulated", async () => {
    await parts(); await picker().getByText("从原文选取",{exact:true}).click();
    const area=picker().getByRole("textbox",{name:"备忘录原文",exact:true});
    for (const text of ["构思\n第一条：雨伞😀", "失物的人来自月球"]) {
      await area.evaluate((field,text)=>{const start=field.value.indexOf(text); if(start<0) throw Error(text);field.focus();field.setSelectionRange(start,start+text.length);},text);
      await picker().getByRole("button",{name:"添加选中文字",exact:true}).click();
    }
    await expect(picker().locator(".mt-reference-fragments > div")).toHaveCount(2); await confirm();
    assert.equal(source(await brainstorm("手选部分")).memos[0].content,"构思\r\n第一条：雨伞😀\n\n失物的人来自月球");
  });
  await check("title selection stages another idea before its paragraph choices, while cancel retains the original reference", async () => {
    await openPicker();
    const titles=picker().getByRole("combobox",{name:"选择参考脑洞或备忘录",exact:true});
    await expect(titles.locator("option")).toHaveCount(3);
    await titles.selectOption("memo-duplicate");
    await expect(picker().getByRole("radio",{name:"整篇备忘录",exact:true})).toBeChecked();
    await expect(ideaPanel().getByRole("combobox",{name:"选择脑洞或备忘录",exact:true})).toHaveValue("memo-main");
    await picker().getByRole("radio",{name:"指定内容",exact:true}).check();
    await block(splitMemoSections(duplicate)[1].id);
    await titles.selectOption("memo-main");
    await expect(picker().locator(".mt-reference-fragments > div")).toHaveCount(2);
    await titles.selectOption("memo-duplicate");
    await expect(picker().locator(`[data-reference-block="${splitMemoSections(duplicate)[1].id}"]`)).toBeChecked();
    await picker().getByRole("button",{name:"取消",exact:true}).click();
    await expect(ideaPanel().getByRole("combobox",{name:"选择脑洞或备忘录",exact:true})).toHaveValue("memo-main");
    await expect(memoArea()).toHaveValue(content.replace(/\r\n/g,"\n"));
    await openPicker(); await titles.selectOption("memo-duplicate");
    await expect(picker().getByRole("radio",{name:"整篇备忘录",exact:true})).toBeChecked();
    await picker().getByRole("radio",{name:"指定内容",exact:true}).check();
    await block(splitMemoSections(duplicate)[1].id); await confirm();
    await expect(ideaPanel().getByRole("combobox",{name:"选择脑洞或备忘录",exact:true})).toHaveValue("memo-duplicate");
    await expect(memoArea()).toHaveValue(duplicate);
    const request=await brainstorm("按所选脑洞的单条信息构思");
    assert.equal(source(request).memos[0].id,"memo-duplicate");
    assert.equal(source(request).memos[0].content,"身份：医生");
    assert.ok(!JSON.stringify(request).includes("手选部分"));
    await ideaPanel().getByRole("combobox",{name:"选择脑洞或备忘录",exact:true}).selectOption("memo-main");
    await expect(memoArea()).toHaveValue(content.replace(/\r\n/g,"\n"));
    await openPicker(); await expect(picker().locator(".mt-reference-fragments > div")).toHaveCount(2);
    await picker().getByRole("button",{name:"取消",exact:true}).click();
  });
  await check("changing an idea from the assistant saves pending memo edits before switching", async () => {
    await memoArea().fill(content+"\r\n当前编辑必须保留。");
    await ideaPanel().getByRole("combobox",{name:"选择脑洞或备忘录",exact:true}).selectOption("memo-long");
    await expect(memoArea()).toHaveValue(longContent);
    assert.ok((await call("book:get",{id:book.id})).memos.find(note=>note.id==="memo-main").content.includes("当前编辑必须保留"));
    await ideaPanel().getByRole("combobox",{name:"选择脑洞或备忘录",exact:true}).selectOption("memo-main");
    await memoArea().fill(content);
    await memoPanel().getByRole("button",{name:"保存备忘录",exact:true}).click();
    await expect.poll(async()=> (await call("book:get",{id:book.id})).memos.find(note=>note.id==="memo-main").content).toBe(content.replace(/\r\n/g,"\n"));
    // Restore the original raw CRLF snapshot through the model, then refresh.
    const saved=(await call("book:get",{id:book.id})).memos.find(note=>note.id==="memo-main");
    await call("memo:save",{bookId:book.id,id:saved.id,title:saved.title,content,baseUpdatedAt:saved.updatedAt});
    await memoPanel().getByRole("button",{name:"刷新备忘录",exact:true}).click();
    await expect(memoArea()).toHaveValue(content.replace(/\r\n/g,"\n"));
  });
  await check("failed memo saves keep both the selected title and staged reference dialog available for recovery", async () => {
    const saved=(await call("book:get",{id:book.id})).memos.find(note=>note.id==="memo-main");
    await memoArea().fill(content+"\n保留本机修改。");
    await call("memo:save",{bookId:book.id,id:saved.id,title:saved.title,content:"外部新修改仍需保留。",baseUpdatedAt:saved.updatedAt});
    await openPicker();
    await picker().getByRole("combobox",{name:"选择参考脑洞或备忘录",exact:true}).selectOption("memo-long");
    await picker().getByRole("button",{name:"确定",exact:true}).click();
    await expect(picker()).toBeVisible();
    await expect(picker().getByRole("alert")).toContainText("已在其他地方修改");
    await expect(picker().getByRole("button",{name:"取消",exact:true})).toBeEnabled();
    await expect(ideaPanel().getByRole("combobox",{name:"选择脑洞或备忘录",exact:true})).toHaveValue("memo-main");
    await picker().getByRole("button",{name:"取消",exact:true}).click();
    await expect(memoArea()).toHaveValue(/保留本机修改/);
    await memoPanel().getByRole("button",{name:"另存为新备忘录",exact:true}).click();
    await expect.poll(async()=> (await call("book:get",{id:book.id})).memos.filter(note=>note.content.includes("保留本机修改")).length).toBe(1);
    const external=(await call("book:get",{id:book.id})).memos.find(note=>note.id==="memo-main");
    assert.equal(external.content,"外部新修改仍需保留。");
    await call("memo:save",{bookId:book.id,id:external.id,title:external.title,content,baseUpdatedAt:external.updatedAt});
    await memoPanel().getByRole("button",{name:"刷新备忘录",exact:true}).click();
    await selectNote("memo-main");
    await expect(memoArea()).toHaveValue(content.replace(/\r\n/g,"\n"));
    const titleOptions=await ideaPanel().getByRole("combobox",{name:"选择脑洞或备忘录",exact:true}).locator("option").allTextContents();
    const sameTitles=titleOptions.filter(label=>label.startsWith("三条构思"));
    assert.equal(sameTitles.length,2); assert.notEqual(sameTitles[0],sameTitles[1]);
  });
  await check("identical text at different locations has separate history, and edited references fail closed", async () => {
    await selectNote("memo-duplicate");
    const same=splitMemoSections(duplicate);
    await parts(); await block(same[1].id); await confirm(); await brainstorm("只讨论甲的标记");
    await parts(); await block(same[3].id); await confirm();
    const other=await brainstorm("只讨论乙"); assert.ok(!JSON.stringify(other).includes("只讨论甲的标记"));
    await parts(); await block(same[1].id); await confirm();
    await showMemos(); await memoArea().fill(duplicate.replace("身份：医生","身份：老师"));
    await memoPanel().getByRole("button",{name:"保存备忘录",exact:true}).click();
    await expect.poll(async()=> (await call("book:get",{id:book.id})).memos.find(n=>n.id==="memo-duplicate").content).toContain("身份：老师");
    await showIdeas(); const before=requests.length;
    await ideaPanel().getByRole("button",{name:"开始构思",exact:true}).click();
    await expect(picker()).toBeVisible(); await expect(picker().getByRole("button",{name:"确定",exact:true})).toBeDisabled();
    assert.equal(requests.length,before);
    await picker().getByRole("button",{name:"清除失效选择",exact:true}).click();
    await expect(picker().getByRole("button",{name:"确定",exact:true})).toBeDisabled();
    await picker().getByRole("button",{name:"取消",exact:true}).click();
  });
  await check("expanded memo uses the same editor, retains selection and scroll, and saves without touching prose", async () => {
    await selectNote("memo-long");
    const before=await memoArea().boundingBox();
    await memoArea().evaluate((field)=>{window.__referenceArea=field;field.focus();field.setSelectionRange(120,130);field.scrollTop=50;window.__normalScroll=field.scrollTop;});
    await memoPanel().getByRole("button",{name:"放大备忘录内容",exact:true}).click();
    const after=await memoArea().boundingBox(); assert.ok(after.height>before.height+150);
    assert.equal(await memoArea().evaluate(field=>field===window.__referenceArea&&field.selectionStart===120&&field.selectionEnd===130),true);
    await memoPanel().getByRole("button",{name:"删除备忘录",exact:true}).click();
    await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(memoPanel().getByRole("button",{name:"缩小备忘录内容",exact:true})).toBeVisible();
    await memoPanel().getByRole("button",{name:"缩小备忘录内容",exact:true}).click();
    assert.equal(await memoArea().evaluate(field=>field===window.__referenceArea&&field.scrollTop===window.__normalScroll),true);
    await memoPanel().getByRole("button",{name:"放大备忘录内容",exact:true}).click();
    await memoArea().fill(longContent+"\n新增构思保持同步。");
    await expect.poll(async()=> (await call("book:get",{id:book.id})).memos.find(n=>n.id==="memo-long").content).toContain("新增构思保持同步");
    await page.keyboard.press("Escape"); await expect(memoPanel().getByRole("button",{name:"放大备忘录内容",exact:true})).toBeVisible();
    const current=(await call("book:get",{id:book.id})).chapters[0]; assert.equal(current.body,originalChapter.body); assert.equal(current.revision,originalChapter.revision);
  });
  await check("each memo keeps its selection after an isolated restart", async () => {
    await selectNote("memo-main"); await openPicker();
    await expect(picker().locator(".mt-reference-fragments > div")).toHaveCount(2);
    await picker().getByRole("button",{name:"取消",exact:true}).click();
    await page.getByRole("button",{name:"返回书架",exact:true}).click(); await app.close(); app=null;
    await launch(); await openManual(); await selectNote("memo-main"); await openPicker();
    await expect(picker().getByRole("radio",{name:"指定内容",exact:true})).toBeChecked();
    await expect(picker().locator(".mt-reference-fragments > div")).toHaveCount(2);
    await picker().getByRole("button",{name:"取消",exact:true}).click();
  });
  await check("choices stay isolated across stories, and a reference-only storage failure prevents losing them on exit", async () => {
    await showMemos(); await memoPanel().getByRole("combobox",{name:"选择作品",exact:true}).selectOption(secondaryBook.id);
    await expect(memoArea()).toHaveValue(secondaryBook.memos[0].content);
    await openPicker(); await expect(picker().getByRole("radio",{name:"整篇备忘录",exact:true})).toBeChecked();
    await picker().getByRole("radio",{name:"指定内容",exact:true}).check();
    await block(splitMemoSections(secondaryBook.memos[0].content)[0].id);
    await page.evaluate((key)=>{
      window.__referenceSetItem=Storage.prototype.setItem;
      Storage.prototype.setItem=function(name,value){if(name===key)throw Error("fixture storage failure");return window.__referenceSetItem.call(this,name,value);};
    },`xm-manual-ideas-v1:book:${secondaryBook.id}`);
    await confirm();
    await page.getByRole("button",{name:"返回书架",exact:true}).click();
    await expect(page.getByRole("textbox",{name:"码字正文",exact:true})).toBeVisible();
    await expect(page.locator(".toast")).toContainText("对话草稿保留失败");
    await page.evaluate(()=>{Storage.prototype.setItem=window.__referenceSetItem;delete window.__referenceSetItem;});
    await page.getByRole("button",{name:"返回书架",exact:true}).click();
    const session=await page.evaluate((key)=>JSON.parse(localStorage.getItem(key)),`xm-manual-ideas-v1:book:${secondaryBook.id}`);
    assert.equal(session.messages.length,0); assert.equal(session.idea,"");
    assert.equal(session.memoChoices["memo-secondary"].blockIds.length,1);
    await openManual(); await selectNote("memo-main"); await openPicker();
    await expect(picker().locator(".mt-reference-fragments > div")).toHaveCount(2);
    await picker().getByRole("button",{name:"取消",exact:true}).click();
  });
  await check("reference dialog and expanded editor fit both themes at wide and compact sizes", async () => {
    await selectNote("memo-long"); await parts(); const items=picker().locator("[data-reference-block]");
    await items.nth(1).check(); await items.nth(2).check(); await confirm();
    for (const size of [{name:"wide",width:1460,height:900},{name:"compact",width:900,height:700}]) {
      await page.setViewportSize({width:size.width,height:size.height});
      for (const value of ["dark","light"]) {
        await theme(value); await openPicker();
        const dialog=await picker().boundingBox(), footer=await picker().locator(".mt-reference-footer").boundingBox();
        assert.ok((await picker().locator(".mt-reference-list").boundingBox()).height>=150,"Multiple reference rows should be visible without excessive scrolling");
        assert.ok(dialog.x>=0&&dialog.y>=0&&dialog.x+dialog.width<=size.width+1&&dialog.y+dialog.height<=size.height+1);
        assert.ok(footer.y+footer.height<=dialog.y+dialog.height+1);
        await snapshot(`${size.name}-${value}-reference.png`);
        await picker().getByRole("button",{name:"取消",exact:true}).click(); await showMemos();
        await memoPanel().getByRole("button",{name:"放大备忘录内容",exact:true}).click();
        const panel=await memoPanel().boundingBox(), save=await memoPanel().getByRole("button",{name:"保存备忘录",exact:true}).boundingBox();
        assert.ok(save.y+save.height<=panel.y+panel.height+1);
        await snapshot(`${size.name}-${value}-expanded.png`);
        await memoPanel().getByRole("button",{name:"缩小备忘录内容",exact:true}).click();
      }
    }
  });
  assert.deepEqual(errors,[]); checks.push("no renderer exceptions");
} finally {
  await writeFile(resolve(output,"report.json"),JSON.stringify({checks,screenshots,errors,dataDir},null,2));
  if(app) await app.close().catch(()=>{}); await new Promise(done=>server.close(done));
}
console.log(`Manual memo reference regression passed. ${output}`);
