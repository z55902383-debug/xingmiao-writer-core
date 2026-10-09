import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("test-results/planner-hierarchy");
await mkdir(root, { recursive: true });
const dataDir = await mkdtemp(resolve(root, "run-"));
const output = resolve(dataDir, "verification");
await mkdir(output);
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
const app = await electron.launch({ args: ["."], env });
const checks = [], screenshots = [], errors = [];
let page;
async function check(name, fn) { await fn(); checks.push(name); console.log(`Passed: ${name}`); }
async function shot(name) {
  if (process.argv.includes("--no-screenshots")) return;
  await page.screenshot({ path: resolve(output, name), animations: "disabled" });
  screenshots.push(name);
}
async function theme(value) {
  if (await page.evaluate(() => document.documentElement.dataset.theme === "light" ? "light" : "dark") !== value)
    await page.getByRole("button", { name: value === "light" ? "切换到浅色模式" : "切换到深色模式", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme === "light" ? "light" : "dark")).toBe(value);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.themeReveal || "")).toBe("");
}
async function tab(name) { await page.getByRole("tab", { name, exact: true }).click(); }
async function scrollTo(selector) {
  await page.locator(selector).evaluate(el => el.scrollIntoView({ block: "start" }));
}
try {
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath("userData"))), dataDir);
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width: 1460, height: 900 });
  await expect(page.getByRole("button", { name: /人工码字板/ })).toBeVisible();
  const call = (action, data = {}) => page.evaluate(async ({ action, data }) => {
    const result = await window.xingmiao.invoke(action, data);
    if (!result.ok) throw Error(result.error);
    return result.data;
  }, { action, data });
  let book = await call("book:create", { title: "雾港回声 · 规划验证", premise: "一封旧信让调查员回到封锁的雾港。" });
  book = await call("book:update", { id: book.id, patch: { outline: "调查员追查失踪者，发现雾港封锁的真相，最终带幸存者离开。" } });
  const volumes = [
    { title: "第一卷《雾中来客》", outline: "地点：旧码头 → 临时安置区 → 灯塔\n访客带来失踪消息。调查员顺着旧船票追查，发现封锁另有原因。", detail: ("## 阶段一：寻找线索\n\n- 码头的旧船票指向失踪者。\n- 灯塔里有人留下了新信号。\n\n").repeat(30) },
    { title: "第二卷《灯塔之外》", outline: "地点：地下通道 → 废弃研究站\n沿着灯塔的信号深入封锁区，找出隐藏的实验。", detail: "" },
    { title: "第三卷《归途》", outline: "", detail: "" },
  ];
  for (const volume of volumes) book = await call("volume:save", { bookId: book.id, volume });
  const ids = book.volumes.map(v => v.id);
  const fixtures = [
    { title: "第1章 码头来信", summary: "调查员在雨夜打开一封没有署名的旧信。", outline: "场景：旧码头。冲突：来信者已经失踪。结尾：发现灯塔信号。", body: "　　雨落在旧码头。顾舟握着那封没有署名的信，向灯塔望去。\n\n　　灯光又亮了一次。", volumeId: ids[0] },
    { title: "第2章 失踪的守塔人", summary: "", outline: "", body: "", volumeId: ids[0] },
    { title: "第3章 旧地图上的另一条路", summary: "旧地图上标着通往研究站的另一条路，顾舟决定去寻找入口。", outline: "", body: "", volumeId: ids[0] },
    { title: "第4章 灯塔之外的地下通道", summary: "顾舟沿地下通道发现废弃的研究站。", outline: "场景：地下通道。冲突：入口被锁。转折：旧船票上有密码。", body: "", volumeId: ids[1] },
  ];
  const chapters = [];
  for (let i = 0; i < fixtures.length; i++) {
    const original = i === 0 ? book.chapters[0] : await call("chapter:create", { bookId: book.id });
    const { volumeId, ...patch } = fixtures[i];
    const saved = await call("chapter:save", { id: original.id, revision: original.revision, patch });
    await call("chapter:organize", { id: saved.id, volumeId });
    chapters.push(saved);
  }
  await page.reload();
  await page.getByRole("button", { name: "打开 雾港回声 · 规划验证", exact: true }).click();
  const close = page.locator(".creation-guide-close");
  if (await close.isVisible().catch(() => false)) await close.click();
  await tab("功能");
  await page.getByRole("button", { name: "故事大纲", exact: true }).click();
  await tab("分卷章节");
  const first = page.locator(`#volume-${ids[0]}`), second = page.locator(`#volume-${ids[1]}`);
  await check("volume groups keep their own chapter counts and empty-state guidance", async () => {
    await expect(first.locator(".volume-chapters-heading")).toHaveText("本卷章节3 章");
    await expect(second.locator(".volume-chapters-heading")).toHaveText("本卷章节1 章");
    await expect(page.locator(`#volume-${ids[2]} .planner-chapter-empty`)).toContainText("此分卷还没有章节");
    await expect(first.locator(".volume-chapter")).toHaveCount(3);
    await expect(second.locator(".volume-chapter")).toHaveCount(1);
  });
  await check("long volume details remain readable without filling the chapter workspace", async () => {
    const height = (await first.locator(".volume-plans").boundingBox()).height;
    assert.ok(height < 300);
    await first.getByRole("button", { name: "查看完整卷细纲", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "卷细纲", exact: true });
    await expect(modal.locator(".planning-rich-text")).toContainText("码头的旧船票");
    await modal.getByRole("button", { name: "关闭", exact: true }).last().click();
  });
  await check("chapter search and volume filtering keep matching chapters in the right group", async () => {
    await page.getByLabel("查找章节", { exact: true }).fill("另一条路");
    await expect(page.locator(".volume-block")).toHaveCount(1);
    await expect(first.locator(".volume-chapter")).toHaveCount(1);
    await expect(first.locator(".volume-chapters-heading")).toHaveText("本卷章节1 章");
    await page.getByLabel("查找章节", { exact: true }).fill("");
    await page.getByLabel("查看分卷", { exact: true }).selectOption(ids[1]);
    await expect(page.locator(".volume-block")).toHaveCount(1);
    await expect(second.locator(".volume-chapter-head > input")).toHaveValue(fixtures[3].title);
    await page.getByLabel("查看分卷", { exact: true }).selectOption("all");
  });
  for (const value of ["dark", "light"]) {
    await theme(value);
    await scrollTo(`#volume-${ids[0]}`);
    await shot(`wide-${value}-volume-chapters.png`);
    await scrollTo(`#volume-${ids[1]}`);
    await shot(`wide-${value}-volume-boundaries.png`);
  }
  await check("the four board stages show accurate counts and real parent volumes", async () => {
    await tab("章节看板");
    for (const stage of ["todo", "planning", "planned", "drafted"]) {
      const lane = page.locator(`.chapter-board-lane[data-stage="${stage}"]`);
      await expect(lane.locator("header > span")).toHaveText("1");
      await expect(lane.locator("article")).toHaveCount(1);
    }
    await expect(page.locator('.chapter-board-lane[data-stage="planned"] .chapter-board-volume')).toHaveText(volumes[1].title);
    await expect(page.locator('.chapter-board-lane[data-stage="drafted"] .chapter-board-volume')).toHaveText(volumes[0].title);
    for (const value of ["dark", "light"]) {
      await theme(value); await scrollTo(".chapter-board"); await shot(`wide-${value}-chapter-board.png`);
    }
  });
  await check("compact layouts keep chapter actions available and board scrolling inside the workspace", async () => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await tab("分卷章节");
    for (const value of ["dark", "light"]) {
      await theme(value); await scrollTo(`#plan-${chapters[0].id}`);
      await expect(first.locator(".volume-chapter").first().getByRole("button", { name: "进入正文", exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      if (value === "dark") await shot("compact-dark-volume-chapters.png");
    }
    await tab("章节看板"); await scrollTo(".chapter-board");
    const lanes = page.locator(".chapter-board-lanes");
    assert.ok(await lanes.evaluate(el => el.scrollWidth > el.clientWidth));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await lanes.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await expect(page.locator('.chapter-board-lane[data-stage="drafted"] .chapter-board-write')).toBeInViewport();
    await lanes.evaluate(el => { el.scrollLeft = 0; });
    await shot("compact-light-chapter-board.png");
  });
  await check("board navigation opens the matching plan and preserves chapter editing", async () => {
    await page.setViewportSize({ width: 1460, height: 900 });
    await page.locator('.chapter-board-lane[data-stage="planning"] .chapter-board-card-main').click();
    const row = page.locator(`#plan-${chapters[2].id}`);
    await expect(row.locator(".chapter-plan-editor")).toHaveAttribute("open", "");
    await row.getByRole("textbox", { name: fixtures[2].title + "章节概要", exact: true }).fill("沿旧地图寻找研究站，途中发现新信号。");
    await page.keyboard.press("Control+s");
    await expect.poll(async () => (await call("book:get", { id: book.id })).chapters.find(c => c.id === chapters[2].id).summary).toBe("沿旧地图寻找研究站，途中发现新信号。");
    await tab("章节看板");
    await page.locator('.chapter-board-lane[data-stage="drafted"] .chapter-board-write').click();
    await expect(page.getByRole("textbox", { name: "章节正文", exact: true })).toHaveValue(fixtures[0].body);
    const saved = await call("book:get", { id: book.id });
    assert.equal(saved.chapters.find(c => c.id === chapters[0].id).body, fixtures[0].body);
  });
  assert.deepEqual(errors, []);
  checks.push("no renderer exceptions");
} finally {
  await writeFile(resolve(output, "report.json"), JSON.stringify({ checks, screenshots, errors, dataDir }, null, 2));
  await app.close();
}
console.log(`Planner hierarchy verification passed. ${output}`);
