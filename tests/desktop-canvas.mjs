import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// Each run creates a fresh SQLite/profile directory. This script never removes
// an existing directory and never inherits the application's real data path.
const require = createRequire(import.meta.url);
const { buildContext } = require("../electron/context.cjs");
const { contextSignature } = require("../electron/timeline.cjs");
const dataRoot = resolve("test-results/canvas-integration-data");
await mkdir(dataRoot, { recursive: true });
const dataDir = await mkdtemp(resolve(dataRoot, "run-"));
const outputDir = resolve(dataDir, "verification");
await mkdir(outputDir, { recursive: true });

const checks = [];
const pageErrors = [];
const requests = [];
const visitor = "画布验收访客";
const fixtureBody = `${visitor}走进旧书店。${visitor}已经失踪。雾港封锁了外侧码头。`;
const worldInitial = "初始测试设定：雾港沿着潮汐运河建城。";
const worldRegular = "CANVAS_WORLD_REGULAR_单一资料源\n雾港实行潮汐通行制度，入城需要登记。";
const worldCanvas = "CANVAS_WORLD_CANVAS_原始资料编辑\n雾港旧码头在夜间关闭，人物只能参考已经确认的规则。";
const worldCandidate = "模型世界候选：雾港的潮汐钟每天校准一次，未核对前不改变正式资料。";
const instruction = "用动作呈现紧张感，保留原人物设定。";
let responseMode = "world";
let app;
let page;
let call;

const server = createServer(async (req, res) => {
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const data = JSON.parse(raw);
    requests.push(data);
    const analysis = data.messages?.[0]?.content.includes("核对小说正文");
    const content = analysis
      ? JSON.stringify({
          changes: [
            {
              kind: "newCharacter",
              subject: visitor,
              value: "来到旧书店的谨慎访客",
              role: "访客",
              evidence: `${visitor}走进旧书店。`,
            },
            {
              kind: "character",
              subject: visitor,
              attribute: "生存状态",
              value: "失踪",
              evidence: `${visitor}已经失踪。`,
            },
            {
              kind: "world",
              subject: "雾港",
              attribute: "通行规则",
              value: "封锁外侧码头",
              evidence: "雾港封锁了外侧码头。",
            },
          ],
        })
      : responseMode === "world"
        ? worldCandidate
        : fixtureBody;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: error.message } }));
  }
});

await new Promise((done) => server.listen(0, "127.0.0.1", done));
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;

async function check(name, run) {
  try {
    await run();
    checks.push({ name, status: "passed" });
    console.log(`Passed: ${name}`);
  } catch (error) {
    checks.push({ name, status: "failed", error: error.stack || error.message });
    throw error;
  }
}

async function launch() {
  app = await electron.launch({ args: ["."], env });
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath("userData"))), dataDir);
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1464, 960),
  );
  call = (action, data = {}) =>
    page.evaluate(async ({ action, data }) => {
      const result = await window.xingmiao.invoke(action, data);
      if (!result.ok) throw Error(result.error);
      return result.data;
    }, { action, data });
}

async function closeGuide() {
  const button = page.locator(".creation-guide-close");
  if (await button.isVisible().catch(() => false)) await button.click();
}

async function openBook(title) {
  const button = page.getByRole("button", { name: `打开 ${title}`, exact: true });
  await expect.poll(async () =>
    (await button.isVisible().catch(() => false)) ||
    (await page.locator(".workspace").isVisible().catch(() => false)),
    { timeout: 15000 },
  ).toBe(true);
  if (await button.isVisible().catch(() => false)) await button.click();
  await expect(page.locator(".workspace")).toBeVisible();
  await closeGuide();
  await page.getByRole("tab", { name: "功能", exact: true }).click();
}

async function feature(label, tab) {
  await page.locator(".workspace-sidebar").getByRole("button", {
    name: new RegExp(`^${label}`),
  }).click();
  if (tab) await page.getByRole("tab", { name: tab, exact: true }).click();
  await expect(page.getByRole("group", { name: "资料展示方式", exact: true })).toBeVisible();
}

async function mode(label) {
  const group = page.getByRole("group", { name: "资料展示方式", exact: true });
  await group.getByRole("button", { name: label, exact: true }).click();
  await expect(group.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
  if (label === "画布") {
    await expect(stage()).toBeVisible();
    await expect(page.locator(".creative-canvas")).toHaveAttribute("data-layout-ready", "true");
  }
  else await expect(stage()).toBeHidden();
}

const stage = () => page.getByTestId("creative-canvas-stage");
const node = (ref) => stage().locator(`article[data-node-id="${ref}"]`);
const selection = () => page.getByTestId("creative-canvas-selection");
const position = async (ref) => node(ref).evaluate((element) => ({
  x: Number(element.getAttribute("data-node-x")),
  y: Number(element.getAttribute("data-node-y")),
}));
const layout = (bookId, view) => call("canvas:get", { bookId, view });

async function dragNode(ref, dx = 42, dy = 26) {
  const before = await position(ref);
  const box = await node(ref).boundingBox();
  assert.ok(box, `The node ${ref} must have a visible drag surface`);
  // The header avoids text fields, ports, and footer actions.
  await page.mouse.move(box.x + Math.min(85, box.width / 2), box.y + 22);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(85, box.width / 2) + dx, box.y + 22 + dy, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => JSON.stringify(await position(ref))).not.toBe(JSON.stringify(before));
  return position(ref);
}

async function waitPosition(bookId, view, ref, expected) {
  await expect.poll(async () => {
    const saved = await layout(bookId, view);
    const point = saved?.nodes?.[ref];
    return point ? { x: point.x, y: point.y } : null;
  }).toEqual(expected);
}

async function editSelectedSource() {
  await selection().getByRole("button", { name: "编辑原始资料", exact: true }).click();
}

async function editVisibleRelation(value, expected) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const simple = dialog.getByLabel("他们是什么关系？", { exact: true });
  if (await simple.isVisible().catch(() => false)) {
    if (expected !== undefined) await expect(simple).toHaveValue(expected);
    await simple.fill(value);
    await dialog.getByRole("button", { name: "保存关系", exact: true }).click();
  } else {
    const field = dialog.getByLabel("变化后的状态", { exact: true });
    if (expected !== undefined) await expect(field).toHaveValue(expected);
    await field.fill(value);
    await dialog.getByRole("button", { name: "保存变化", exact: true }).click();
  }
}

function contextFor(book, chapterId) {
  return buildContext(book, book.chapters.find((chapter) => chapter.id === chapterId), "write", instruction).messages;
}

function payloadFrom(messages) {
  const marker = "以下 JSON 为资料数据：\n";
  const content = messages.find((message) => message.role === "user")?.content;
  assert.ok(content?.includes(marker), "The real context must expose its ordinary source-data payload");
  return JSON.parse(content.split(marker)[1]);
}

let bookId;
let title;
let chapterId;
let personRef;
let persistedWorldPosition;
let persistedPersonPosition;
let persistedAnnotation;
let memoryId;
let volumeId;
let addedChapterId;
let foreshadowId;
let addedWorldId;
try {
  await launch();
  await check("isolated fixture and local model service", async () => {
    await page.getByRole("button", { name: "打开示例体验", exact: true }).click();
    await closeGuide();
    const books = await call("books:list");
    assert.equal(books.length, 1);
    const initial = await call("book:get", { id: books[0].id });
    bookId = initial.id;
    title = initial.title;
    chapterId = initial.chapters[0].id;
    assert.ok(initial.characters.length >= 2);
    assert.ok(!initial.characters.some((character) => character.name === visitor));
    personRef = `character:${initial.characters[0].id}`;
    await call("book:update", { id: bookId, patch: { world: worldInitial } });
    await call("timeline:save", {
      bookId,
      event: {
        kind: "relation", title: "画布验收正式关系", entity: "",
        characterId: initial.characters[0].id, targetId: initial.characters[1].id,
        attribute: "相处关系", value: "互相理解", chapterId: "", phase: "confirmed",
        sequence: 1, storyTime: "", evidence: "",
      },
    });
    await call("config:save", {
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      model: "canvas-fixture", maxTokens: 4096, temperature: null,
    });
    await page.reload();
    await openBook(title);
  });

  await check("all four existing feature pages and their subpages retain regular/canvas switching", async () => {
    const modules = [
      ["故事大纲", ["故事总纲", "剧情时间线", "分卷章节", "章节看板"]],
      ["人物档案", ["人物档案", "关系与变化"]],
      ["世界设定", ["世界初始设定", "世界变化"]],
      ["关系与记忆", ["事实记忆", "变化时间线", "伏笔台账"]],
    ];
    for (const [label, tabs] of modules) {
      await feature(label);
      await mode("常规");
      for (const tab of tabs) {
        const button = page.getByRole("tab", { name: tab, exact: true });
        await expect(button).toBeVisible();
        await button.click();
        await expect(button).toHaveAttribute("aria-selected", "true");
        await mode("画布");
        await expect(button).toHaveAttribute("aria-selected", "true");
        await mode("常规");
      }
    }
    await expect(page.locator(".workspace-sidebar").getByRole("button", { name: "创作画布", exact: true })).toHaveCount(0);
  });

  await check("mode switching preserves the same writing assistant, task, instructions and candidate", async () => {
    await feature("世界设定", "世界初始设定");
    responseMode = "world";
    const job = await call("ai:generate", { bookId, chapterId, kind: "worldBuild", instruction });
    await expect.poll(async () => (await call("book:get", { id: bookId })).candidates.find((item) => item.id === job.id)?.status).toBe("done");
    await expect(page.locator(".assistant-panel")).toContainText(worldCandidate);
    await page.locator(".assistant-panel").getByRole("tab", { name: "作品顾问", exact: true }).click();
    await page.locator(".assistant-panel .action-grid").getByRole("button", { name: "生成世界设定", exact: true }).click();
    await page.getByLabel("补充创作要求", { exact: true }).fill(instruction);
    await expect(page.locator(".context-toggle")).not.toContainText("待准备");
    const panel = await page.locator(".assistant-panel").elementHandle();
    const html = await panel.evaluate((element) => element.innerHTML);
    await mode("画布");
    assert.equal(await panel.evaluate((element) => element === document.querySelector(".assistant-panel")), true);
    await expect.poll(() => page.locator(".assistant-panel").innerHTML()).toBe(html);
    await expect(page.getByLabel("补充创作要求", { exact: true })).toHaveValue(instruction);
    await expect(page.locator(".assistant-panel .action-grid").getByRole("button", { name: "生成世界设定", exact: true })).toHaveAttribute("aria-pressed", "true");
    await mode("常规");
    await expect.poll(() => page.locator(".assistant-panel").innerHTML()).toBe(html);
    await panel.dispose();
  });

  await check("the complete world field edits both views through the existing source form", async () => {
    await page.getByLabel("世界观与固定规则", { exact: true }).fill(worldRegular);
    await expect.poll(async () => (await call("book:get", { id: bookId })).world).toBe(worldRegular);
    await mode("画布");
    await expect(node("world:base")).toContainText("CANVAS_WORLD_REGULAR");
    await node("world:base").click();
    await editSelectedSource();
    const sourceEditor = page.getByTestId("canvas-source-editor");
    await expect(sourceEditor).toBeVisible();
    const input = sourceEditor.getByLabel("世界观与固定规则", { exact: true });
    await expect(input).toHaveValue(worldRegular);
    await input.fill(worldCanvas);
    await sourceEditor.getByRole("button", { name: "保存资料", exact: true }).click();
    await expect.poll(async () => (await call("book:get", { id: bookId })).world).toBe(worldCanvas);
    await page.keyboard.press("Escape");
    await mode("常规");
    await expect(page.getByLabel("世界观与固定规则", { exact: true })).toHaveValue(worldCanvas);
    await mode("画布");
    await expect(node("world:base")).toContainText("CANVAS_WORLD_CANVAS");
    await page.screenshot({ path: resolve(outputDir, "world-canvas.png") });
  });

  await check("dragging changes only the SQLite canvas layout and preserves the actual context", async () => {
    const before = await call("book:get", { id: bookId });
    const context = contextFor(before, chapterId);
    const signature = contextSignature(before, before.chapters.find((chapter) => chapter.id === chapterId));
    persistedWorldPosition = await dragNode("world:base");
    await waitPosition(bookId, "world:setting", "world:base", persistedWorldPosition);
    const after = await call("book:get", { id: bookId });
    assert.deepEqual(contextFor(after, chapterId), context);
    assert.equal(contextSignature(after, after.chapters.find((chapter) => chapter.id === chapterId)), signature);
    assert.equal(after.world, worldCanvas);
  });

  await check("character nodes reuse the original person editor in both directions", async () => {
    await feature("人物档案", "人物档案");
    await mode("常规");
    const initial = (await call("book:get", { id: bookId })).characters.find((person) => `character:${person.id}` === personRef);
    await page.getByRole("button", { name: `编辑${initial.name}`, exact: true }).click();
    await page.getByRole("dialog").getByLabel("性格、动机与背景", { exact: true }).fill("CANVAS_PERSON_REGULAR_谨慎行动，先核实消息。");
    await page.getByRole("button", { name: "保存人物", exact: true }).click();
    await expect.poll(async () => (await call("book:get", { id: bookId })).characters.find((person) => person.id === initial.id)?.description).toContain("CANVAS_PERSON_REGULAR");
    await mode("画布");
    await expect(node(personRef)).toContainText("CANVAS_PERSON_REGULAR");
    await node(personRef).click();
    await editSelectedSource();
    await expect(page.getByRole("heading", { name: "编辑人物", exact: true })).toBeVisible();
    await page.getByRole("dialog").getByLabel("性格、动机与背景", { exact: true }).fill("CANVAS_PERSON_CANVAS_通过节点编辑同一人物资料。");
    await page.getByRole("button", { name: "保存人物", exact: true }).click();
    await expect.poll(async () => (await call("book:get", { id: bookId })).characters.find((person) => person.id === initial.id)?.description).toContain("CANVAS_PERSON_CANVAS");
    await mode("常规");
    await expect(page.locator(".character-card").filter({ hasText: initial.name })).toContainText("CANVAS_PERSON_CANVAS");
  });

  await check("official canvas edges edit the same real timeline relation", async () => {
    await feature("人物档案", "关系与变化");
    await mode("常规");
    const row = page.locator(".event-row").filter({ hasText: "画布验收正式关系" });
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    await editVisibleRelation("CANVAS_RELATION_REGULAR_互相支持", "互相理解");
    await expect.poll(async () => (await call("book:get", { id: bookId })).timeline.find((event) => event.title === "画布验收正式关系")?.value).toBe("CANVAS_RELATION_REGULAR_互相支持");
    await mode("画布");
    const relation = (await call("book:get", { id: bookId })).timeline.find((event) => event.title === "画布验收正式关系");
    const edge = stage().locator(`g[data-edge-id="relation:${relation.id}"]`);
    await expect(edge).toHaveCount(1);
    await edge.locator("text").click();
    await editSelectedSource();
    await editVisibleRelation("CANVAS_RELATION_CANVAS_共同调查", "CANVAS_RELATION_REGULAR_互相支持");
    await expect.poll(async () => (await call("book:get", { id: bookId })).timeline.find((event) => event.title === "画布验收正式关系")?.value).toBe("CANVAS_RELATION_CANVAS_共同调查");
    await mode("常规");
    await expect(page.locator(".event-row").filter({ hasText: "画布验收正式关系" })).toContainText("CANVAS_RELATION_CANVAS_共同调查");
    await mode("画布");
  });

  await check("port-created author annotations never change real facts or generation input", async () => {
    const before = await call("book:get", { id: bookId });
    const context = contextFor(before, chapterId);
    const signature = contextSignature(before, before.chapters.find((chapter) => chapter.id === chapterId));
    const targetRef = `character:${before.characters.find((person) => `character:${person.id}` !== personRef).id}`;
    await node(personRef).locator('button[data-port="out"]').click();
    await node(targetRef).locator('button[data-port="in"]').click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "编辑作者标注", exact: true })).toBeVisible();
    const label = dialog.getByLabel("关联名称", { exact: true });
    await expect(label).toBeVisible();
    await label.fill("CANVAS_AUTHOR_NOTE_作者设想");
    await dialog.getByLabel("备注", { exact: true }).fill("仅用于整理思路，不是正式剧情事实。");
    await dialog.getByLabel("方向", { exact: true }).selectOption("both");
    await dialog.getByLabel("线条样式", { exact: true }).selectOption("true");
    await dialog.getByRole("button", { name: "保存标注", exact: true }).click();
    await expect.poll(async () => (await layout(bookId, "characters:relations"))?.annotations?.some((edge) => edge.label === "CANVAS_AUTHOR_NOTE_作者设想") || false).toBe(true);
    persistedAnnotation = (await layout(bookId, "characters:relations")).annotations.find((edge) => edge.label === "CANVAS_AUTHOR_NOTE_作者设想");
    assert.equal(persistedAnnotation.source, personRef);
    assert.equal(persistedAnnotation.target, targetRef);
    assert.equal(persistedAnnotation.direction, "both");
    assert.equal(persistedAnnotation.dashed, true);
    const annotationEdge = stage().locator(`g[data-edge-id="${persistedAnnotation.id}"]`);
    await annotationEdge.locator("text").click();
    const reopened = page.getByRole("dialog");
    await expect(reopened.getByRole("heading", { name: "编辑作者标注", exact: true })).toBeVisible();
    await expect(reopened.getByLabel("关联名称", { exact: true })).toHaveValue("CANVAS_AUTHOR_NOTE_作者设想");
    await expect(reopened.getByLabel("方向", { exact: true })).toHaveValue("both");
    await reopened.getByRole("button", { name: "取消", exact: true }).click();
    const formalId = before.timeline.find((event) => event.title === "画布验收正式关系").id;
    await stage().locator(`g[data-edge-id="relation:${formalId}"]`).locator("text").click();
    await expect(selection().getByRole("button", { name: "编辑原始资料", exact: true })).toBeVisible();
    await selection().getByRole("button", { name: "关闭节点详情", exact: true }).click();
    const after = await call("book:get", { id: bookId });
    assert.deepEqual(after.timeline, before.timeline);
    assert.deepEqual(contextFor(after, chapterId), context);
    assert.equal(contextSignature(after, after.chapters.find((chapter) => chapter.id === chapterId)), signature);
    assert.ok(!JSON.stringify(context).includes("CANVAS_AUTHOR_NOTE"));
    await page.screenshot({ path: resolve(outputDir, "parallel-relations.png") });
    await page.keyboard.press("Escape");
  });

  await check("real generation reads the edited shared field once and still requires adoption", async () => {
    await feature("人物档案", "人物档案");
    await mode("画布");
    const before = await call("book:get", { id: bookId });
    responseMode = "write";
    const requestStart = requests.length;
    const job = await call("ai:generate", { bookId, chapterId, kind: "write", instruction });
    await expect.poll(async () => (await call("book:get", { id: bookId })).candidates.find((candidate) => candidate.id === job.id)?.review?.status, { timeout: 30000 }).toBe("ready");
    const writing = requests.slice(requestStart).find((request) => !request.messages[0].content.includes("核对小说正文"));
    assert.ok(writing, "Generation must issue an actual request to the isolated local fixture");
    assert.equal(payloadFrom(writing.messages).book.world, worldCanvas);
    assert.equal(JSON.stringify(writing.messages).split("CANVAS_WORLD_CANVAS_").length - 1, 1);
    assert.ok(!JSON.stringify(writing.messages).includes("CANVAS_AUTHOR_NOTE"));
    assert.ok(!JSON.stringify(writing.messages).includes("\"viewport\""));
    assert.equal((await call("book:get", { id: bookId })).characters.length, before.characters.length);
    await page.getByRole("button", { name: "查阅变化清单", exact: true }).click();
    await expect(page.getByRole("button", { name: "确认同步并定稿", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "暂不同步", exact: true }).click();
    await page.locator(".assistant-panel").getByRole("button", { name: "采用结果", exact: true }).click();
    await expect.poll(async () => (await call("book:get", { id: bookId })).candidates.find((candidate) => candidate.id === job.id)?.adopted).toBe(true);
    // Move after adoption: presentation changes must not invalidate review.
    persistedPersonPosition = await dragNode(personRef, 35, 18);
    await waitPosition(bookId, "characters:archive", personRef, persistedPersonPosition);
    await page.getByRole("button", { name: "查阅变化清单", exact: true }).click();
    await page.getByLabel("人物描述", { exact: true }).fill("CANVAS_SYNC_NEW_PERSON_谨慎的访客");
    await page.getByRole("button", { name: "确认同步并定稿", exact: true }).click();
    await expect(page.getByText("本章变化已确认同步", { exact: true })).toBeVisible();
    const after = await call("book:get", { id: bookId });
    const newPerson = after.characters.find((person) => person.name === visitor);
    assert.ok(newPerson);
    assert.equal(newPerson.description, "CANVAS_SYNC_NEW_PERSON_谨慎的访客");
    assert.equal(after.chapters.find((chapter) => chapter.id === chapterId).status, "final");
    assert.ok(after.timeline.some((event) => event.kind === "world" && event.value === "封锁外侧码头"));
    await expect(node(`character:${newPerson.id}`)).toBeVisible();
    assert.deepEqual(await position(personRef), persistedPersonPosition);
    await waitPosition(bookId, "characters:archive", personRef, persistedPersonPosition);
    await page.screenshot({ path: resolve(outputDir, "synced-characters.png") });
  });

  await check("world changes remain in their original subpage and both views", async () => {
    await feature("世界设定", "世界变化");
    await mode("常规");
    await expect(page.locator(".event-row").filter({ hasText: "封锁外侧码头" })).toBeVisible();
    await mode("画布");
    await expect(stage()).toContainText("封锁外侧码头");
    await feature("世界设定", "世界初始设定");
    await mode("画布");
    assert.deepEqual(await position("world:base"), persistedWorldPosition);
    await waitPosition(bookId, "world:setting", "world:base", persistedWorldPosition);
    const saved = await layout(bookId, "world:setting");
    assert.ok(!JSON.stringify(saved).includes("CANVAS_WORLD_CANVAS"));
    assert.ok(!Object.hasOwn(saved, "records"));
    assert.ok(!Object.hasOwn(saved, "body"));
  });

  await check("a just-created regular world card can immediately enter the canvas and save a dragged position", async () => {
    await feature("世界设定", "世界初始设定");
    await mode("常规");
    await page.getByRole("button", { name: "新增资料卡", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("名称 *", { exact: true }).fill("画布即时世界卡");
    await dialog.getByLabel("设定内容", { exact: true }).fill("CANVAS_WORLD_CARD_保存后立即切换画布并移动。");
    await dialog.getByRole("button", { name: "保存资料卡", exact: true }).click();
    // Deliberately do not wait for the normal source autosave before switching.
    await mode("画布");
    const added = stage().locator("article[data-node-id]").filter({ hasText: "画布即时世界卡" });
    const ref = await added.getAttribute("data-node-id");
    assert.ok(ref?.startsWith("world:"));
    addedWorldId = ref.slice("world:".length);
    const savedPosition = await dragNode(ref, 22, 15);
    await waitPosition(bookId, "world:setting", ref, savedPosition);
    await expect.poll(async () => (await call("book:get", { id: bookId })).worldRecords?.find((item) => item.id === addedWorldId)?.description).toBe("CANVAS_WORLD_CARD_保存后立即切换画布并移动。");
    await expect(page.locator(".workspace")).not.toContainText("画布布局保存失败");
    assert.deepEqual(await position("world:base"), persistedWorldPosition);
  });

  await check("fact memory keeps its stable id through regular and canvas source editing", async () => {
    await feature("关系与记忆", "事实记忆");
    await mode("常规");
    await page.getByRole("button", { name: "添加记忆", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("主体 *", { exact: true }).fill("画布记忆验收");
    await dialog.getByLabel("关系或状态 *", { exact: true }).fill("遵守");
    await dialog.getByLabel("对象或事实内容 *", { exact: true }).fill("CANVAS_MEMORY_INITIAL_作者确认的初始规则");
    await dialog.getByRole("button", { name: "保存记忆", exact: true }).click();
    await expect.poll(async () => (await call("book:get", { id: bookId })).memories.some((item) => item.subject === "画布记忆验收")).toBe(true);
    memoryId = (await call("book:get", { id: bookId })).memories.find((item) => item.subject === "画布记忆验收").id;
    let row = page.locator(".memory-item").filter({ hasText: "画布记忆验收" });
    await row.getByRole("button", { name: "编辑记忆", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("对象或事实内容 *", { exact: true }).fill("CANVAS_MEMORY_REGULAR_在原表单编辑事实");
    await dialog.getByRole("button", { name: "保存记忆", exact: true }).click();
    await expect.poll(async () => (await call("book:get", { id: bookId })).memories.find((item) => item.id === memoryId)?.object).toBe("CANVAS_MEMORY_REGULAR_在原表单编辑事实");
    await mode("画布");
    await expect(node(`memory:${memoryId}`)).toContainText("CANVAS_MEMORY_REGULAR");
    await node(`memory:${memoryId}`).click();
    await editSelectedSource();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "编辑事实记忆", exact: true })).toBeVisible();
    await expect(dialog.getByLabel("对象或事实内容 *", { exact: true })).toHaveValue("CANVAS_MEMORY_REGULAR_在原表单编辑事实");
    await dialog.getByLabel("对象或事实内容 *", { exact: true }).fill("CANVAS_MEMORY_CANVAS_同一事实通过节点编辑");
    await dialog.getByRole("button", { name: "保存记忆", exact: true }).click();
    await expect.poll(async () => (await call("book:get", { id: bookId })).memories.find((item) => item.id === memoryId)?.object).toBe("CANVAS_MEMORY_CANVAS_同一事实通过节点编辑");
    assert.equal((await call("book:get", { id: bookId })).memories.filter((item) => item.subject === "画布记忆验收").length, 1);
    await mode("常规");
    row = page.locator(".memory-item").filter({ hasText: "画布记忆验收" });
    await expect(row).toContainText("CANVAS_MEMORY_CANVAS_同一事实通过节点编辑");
  });

  await check("canvas-created chapter planning persists its selected volume and original regular fields", async () => {
    await feature("故事大纲", "分卷章节");
    await mode("画布");
    await page.getByRole("button", { name: "添加资料", exact: true }).click();
    let editor = page.getByTestId("canvas-source-editor");
    await editor.getByLabel("资料类型", { exact: true }).selectOption("volume");
    await editor.getByLabel("分卷名称", { exact: true }).fill("画布验收分卷");
    await editor.getByLabel("卷大纲", { exact: true }).fill("CANVAS_VOLUME_PLAN_安排后续调查");
    await editor.getByRole("button", { name: "保存资料", exact: true }).click();
    await expect.poll(async () => (await call("book:get", { id: bookId })).volumes.some((item) => item.title === "画布验收分卷")).toBe(true);
    volumeId = (await call("book:get", { id: bookId })).volumes.find((item) => item.title === "画布验收分卷").id;
    await page.getByRole("button", { name: "添加资料", exact: true }).click();
    editor = page.getByTestId("canvas-source-editor");
    await editor.getByLabel("资料类型", { exact: true }).selectOption("chapter");
    await editor.getByLabel("章节名称", { exact: true }).fill("画布验收新增章");
    await editor.getByLabel("所属分卷", { exact: true }).selectOption(volumeId);
    await editor.getByLabel("章节概要", { exact: true }).fill("CANVAS_CHAPTER_SUMMARY_只是后续章节计划");
    await editor.getByLabel("章节细纲", { exact: true }).fill("CANVAS_CHAPTER_PLAN_先核实线索再进入码头");
    await editor.getByRole("button", { name: "保存资料", exact: true }).click();
    await expect.poll(async () => (await call("book:get", { id: bookId })).chapters.find((item) => item.title === "画布验收新增章")?.volumeId).toBe(volumeId);
    addedChapterId = (await call("book:get", { id: bookId })).chapters.find((item) => item.title === "画布验收新增章").id;
    await page.getByRole("button", { name: "适应画布", exact: true }).click();
    await node(`chapter:${addedChapterId}`).click();
    await editSelectedSource();
    editor = page.getByTestId("canvas-source-editor");
    await expect(editor.getByLabel("所属分卷", { exact: true })).toHaveValue(volumeId);
    await expect(editor.getByLabel("章节概要", { exact: true })).toHaveValue("CANVAS_CHAPTER_SUMMARY_只是后续章节计划");
    await expect(editor.getByLabel("章节细纲", { exact: true })).toHaveValue("CANVAS_CHAPTER_PLAN_先核实线索再进入码头");
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await mode("常规");
    const chapterRow = page.locator(`#volume-${volumeId} #plan-${addedChapterId}`);
    await expect(chapterRow.getByLabel("画布验收新增章所属分卷", { exact: true })).toHaveValue(volumeId);
    await expect(chapterRow.getByLabel("画布验收新增章章节概要", { exact: true })).toHaveValue("CANVAS_CHAPTER_SUMMARY_只是后续章节计划");
  });

  await check("foreshadow title and note use the same source editor and stable record", async () => {
    await feature("关系与记忆", "伏笔台账");
    await mode("常规");
    await page.getByLabel("伏笔内容", { exact: true }).fill("画布验收初始伏笔");
    await page.getByRole("button", { name: "记下伏笔", exact: true }).click();
    await expect.poll(async () => ((await call("book:get", { id: bookId })).foreshadows || []).some((item) => item.title === "画布验收初始伏笔")).toBe(true);
    foreshadowId = (await call("book:get", { id: bookId })).foreshadows.find((item) => item.title === "画布验收初始伏笔").id;
    await page.locator(".foreshadow-card").filter({ hasText: "画布验收初始伏笔" }).getByRole("button", { name: "编辑", exact: true }).click();
    let editor = page.getByTestId("canvas-source-editor");
    await editor.getByLabel("伏笔内容", { exact: true }).fill("CANVAS_FORESHADOW_REGULAR_潮汐钟上的缺口");
    await editor.getByLabel("备注", { exact: true }).fill("CANVAS_FORESHADOW_NOTE_REGULAR_暂未回收");
    await editor.getByRole("button", { name: "保存资料", exact: true }).click();
    await mode("画布");
    await expect(node(`foreshadow:${foreshadowId}`)).toContainText("CANVAS_FORESHADOW_REGULAR");
    await expect(node(`foreshadow:${foreshadowId}`)).toContainText("CANVAS_FORESHADOW_NOTE_REGULAR");
    await node(`foreshadow:${foreshadowId}`).click();
    await editSelectedSource();
    editor = page.getByTestId("canvas-source-editor");
    await expect(editor.getByLabel("备注", { exact: true })).toHaveValue("CANVAS_FORESHADOW_NOTE_REGULAR_暂未回收");
    await editor.getByLabel("伏笔内容", { exact: true }).fill("CANVAS_FORESHADOW_CANVAS_同一线索等待回收");
    await editor.getByLabel("备注", { exact: true }).fill("CANVAS_FORESHADOW_NOTE_CANVAS_回看第一个章节");
    await editor.getByRole("button", { name: "保存资料", exact: true }).click();
    await expect.poll(async () => (await call("book:get", { id: bookId })).foreshadows.find((item) => item.id === foreshadowId)?.note).toBe("CANVAS_FORESHADOW_NOTE_CANVAS_回看第一个章节");
    await mode("常规");
    await page.locator(".foreshadow-card").filter({ hasText: "CANVAS_FORESHADOW_CANVAS" }).getByRole("button", { name: "编辑", exact: true }).click();
    editor = page.getByTestId("canvas-source-editor");
    await expect(editor.getByLabel("备注", { exact: true })).toHaveValue("CANVAS_FORESHADOW_NOTE_CANVAS_回看第一个章节");
    await editor.getByRole("button", { name: "取消", exact: true }).click();
  });

  await check("deleting a person through the canvas source modal leaves the remaining layout writable", async () => {
    await feature("人物档案", "人物档案");
    await mode("画布");
    await page.getByRole("button", { name: "添加资料", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("人物姓名 *", { exact: true }).fill("画布待删除人物");
    await dialog.getByLabel("性格、动机与背景", { exact: true }).fill("此人物专用于删除后布局仍可保存的验收。");
    await dialog.getByRole("button", { name: "保存人物", exact: true }).click();
    await expect.poll(async () => (await call("book:get", { id: bookId })).characters.some((item) => item.name === "画布待删除人物")).toBe(true);
    const deletedId = (await call("book:get", { id: bookId })).characters.find((item) => item.name === "画布待删除人物").id;
    const deletedRef = `character:${deletedId}`;
    await page.getByRole("button", { name: "适应画布", exact: true }).click();
    const deletedPosition = await dragNode(deletedRef, 24, 14);
    await waitPosition(bookId, "characters:archive", deletedRef, deletedPosition);
    await editSelectedSource();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "删除人物", exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "删除人物资料？", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect.poll(async () => (await call("book:get", { id: bookId })).characters.some((item) => item.id === deletedId)).toBe(false);
    await expect(node(deletedRef)).toHaveCount(0);
    persistedPersonPosition = await dragNode(personRef, 26, 18);
    await waitPosition(bookId, "characters:archive", personRef, persistedPersonPosition);
    assert.ok(!Object.hasOwn((await layout(bookId, "characters:archive")).nodes, deletedRef));
    await expect(page.locator(".cc-statusbar")).not.toContainText("保存失败");
    await page.screenshot({ path: resolve(outputDir, "deleted-person-layout.png") });
  });

  await check("a full Electron restart restores source content, positions and annotations", async () => {
    await app.close();
    app = undefined;
    await launch();
    await openBook(title);
    await feature("世界设定", "世界初始设定");
    await mode("常规");
    await expect(page.getByLabel("世界观与固定规则", { exact: true })).toHaveValue(worldCanvas);
    await mode("画布");
    await expect.poll(() => position("world:base")).toEqual(persistedWorldPosition);
    await feature("人物档案", "人物档案");
    await mode("画布");
    await expect.poll(() => position(personRef)).toEqual(persistedPersonPosition);
    await feature("人物档案", "关系与变化");
    await mode("画布");
    const stored = await layout(bookId, "characters:relations");
    assert.deepEqual(stored.annotations.find((edge) => edge.id === persistedAnnotation.id), persistedAnnotation);
    await expect(stage()).toContainText("CANVAS_AUTHOR_NOTE_作者设想");
    await page.screenshot({ path: resolve(outputDir, "restored-relations.png") });
    const restored = await call("book:get", { id: bookId });
    assert.equal(restored.memories.find((item) => item.id === memoryId)?.object, "CANVAS_MEMORY_CANVAS_同一事实通过节点编辑");
    assert.equal(restored.chapters.find((item) => item.id === addedChapterId)?.volumeId, volumeId);
    assert.equal(restored.foreshadows.find((item) => item.id === foreshadowId)?.note, "CANVAS_FORESHADOW_NOTE_CANVAS_回看第一个章节");
    assert.equal(restored.worldRecords.find((item) => item.id === addedWorldId)?.description, "CANVAS_WORLD_CARD_保存后立即切换画布并移动。");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 800));
    await expect(stage()).toBeVisible();
    // Wait for the existing responsive drawer transition before capturing it.
    await expect.poll(() => page.locator(".assistant-panel").evaluate((element) => element.getBoundingClientRect().left >= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(outputDir, "compact-relations.png") });
  });

  await check("the integration produces no renderer errors", async () => assert.deepEqual(pageErrors, []));
  console.log(`Canvas desktop passed. Isolated data and evidence retained at ${dataDir}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(outputDir, "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(resolve(outputDir, "desktop-canvas-report.json"), JSON.stringify({
    dataDir, checks, errors: pageErrors,
    requestCount: requests.length,
    passed: checks.length > 0 && checks.every((item) => item.status === "passed") && pageErrors.length === 0,
  }, null, 2));
  if (app) await app.close().catch(() => {});
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
