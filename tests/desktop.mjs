import { _electron as electron, expect } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve("test-results");
await mkdir(output, { recursive: true });
const dataPath = resolve("test-results", "desktop-data");
// Only reset this fixed test directory, never the author's real library.
await rm(dataPath, { recursive: true, force: true });
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: dataPath };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.getByText("你的第一部作品，等你落笔")).toBeVisible();
  await page.screenshot({ path: resolve(output, "01-bookshelf.png") });
  await expect(page.getByRole("button", { name: /创意工具箱|创作广场|飞书登录/ })).toHaveCount(0);
  await page.getByRole("button", { name: "打开示例体验" }).click();
  const guideClose = page.locator(".creation-guide-close");
  if (await guideClose.isVisible().catch(() => false)) await guideClose.click();
  await page.getByRole("tab", { name: "功能" }).click();
  await page.getByRole("button", { name: "备忘录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "把灵感先收好" }),
  ).toBeVisible();
  await page
    .locator(".module-page-head")
    .getByRole("button", { name: "新建备忘录" })
    .click();
  await page.getByRole("textbox", { name: "备忘录标题" }).fill("测试灵感");
  await page
    .getByRole("textbox", { name: "备忘录内容" })
    .fill("从工具箱复制来的故事点子。");
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(output, "02-book-memos.png") });
  await page.getByRole("button", { name: "返回书架" }).click();
  await page
    .locator(".recent-project")
    .getByRole("button", { name: /继续写作/ })
    .click();
  await page.getByRole("tab", { name: "功能" }).click();
  await page.getByRole("button", { name: "备忘录", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "备忘录内容" })).toHaveValue(
    "从工具箱复制来的故事点子。",
  );
  await page.getByRole("button", { name: "章节正文", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "章节正文" })).toContainText(
    "",
  );
  await expect(page.getByRole("textbox", { name: "章节正文" })).toHaveValue(
    /雨落了一整个下午/,
  );
  await page.screenshot({ path: resolve(output, "02-editor.png") });
  await page.setViewportSize({ width: 1200, height: 900 });
  const assistantTrigger = page.getByRole("button", { name: "打开写作助手" });
  await expect(assistantTrigger).toBeVisible();
  const assistantPanel = page.locator(".assistant-panel");
  await page.waitForTimeout(220);
  const closedPanel = await assistantPanel.boundingBox();
  expect(closedPanel.x).toBeGreaterThanOrEqual(1200);
  await assistantTrigger.click();
  await expect(
    assistantPanel.getByRole("button", { name: "关闭写作助手" }),
  ).toBeVisible();
  await page.waitForTimeout(220);
  const openPanel = await assistantPanel.boundingBox();
  expect(openPanel.x).toBeLessThan(1200);
  await page.screenshot({
    path: resolve(output, "02-editor-assistant-drawer.png"),
  });
  const compose = assistantPanel.locator(".assistant-compose");
  const advancedSummary = compose.locator(".compose-advanced > summary");
  await advancedSummary.click();
  const popover = compose.locator(".compose-advanced-popover");
  await expect(popover).toBeVisible();
  const popoverBox = await popover.boundingBox();
  const summaryBox = await advancedSummary.boundingBox();
  expect(popoverBox.y + popoverBox.height).toBeLessThan(summaryBox.y);
  const generateButton = assistantPanel.getByRole("button", {
    name: "开始生成",
    exact: true,
  });
  const buttonBeforeScroll = await generateButton.boundingBox();
  await assistantPanel.locator(".assistant-body").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const buttonAfterScroll = await generateButton.boundingBox();
  expect(Math.abs(buttonAfterScroll.y - buttonBeforeScroll.y)).toBeLessThan(1);
  await page.screenshot({
    path: resolve(output, "02-editor-assistant-compose-popover.png"),
  });
  await advancedSummary.click();
  await assistantPanel.getByRole("button", { name: "关闭写作助手" }).click();
  await page.waitForTimeout(220);
  expect((await assistantPanel.boundingBox()).x).toBeGreaterThanOrEqual(1200);
  await expect(assistantPanel).toHaveClass(/assistant-panel/);
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.getByRole("button", { name: "收起侧栏" }).click();
  await page.waitForTimeout(240);
  expect(
    Math.round((await page.locator(".workspace-sidebar").boundingBox()).width),
  ).toBe(72);
  expect(Math.round((await page.locator(".work-area").boundingBox()).x)).toBe(
    72,
  );
  await page.screenshot({
    path: resolve(output, "02-editor-sidebar-rail.png"),
  });
  await page.getByRole("tab", { name: "功能" }).click();
  await page.getByRole("button", { name: "展开侧栏" }).click();
  await page.waitForTimeout(240);
  expect(
    Math.round((await page.locator(".workspace-sidebar").boundingBox()).width),
  ).toBeGreaterThan(100);
  await page.getByRole("tab", { name: "功能" }).click();
  await page.getByRole("button", { name: "关系与记忆" }).click();
  await expect(
    page.getByText("陈默将铜钥匙交给林晚保管。", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: resolve(output, "03-memory.png") });
  await page.getByRole("button", { name: "章节正文", exact: true }).click();
  await page.getByRole("tab", { name: "章节" }).click();
  const editor = page.getByRole("textbox", { name: "章节正文" });
  const body = await editor.inputValue();
  await editor.fill(body + "\n\n保存测试：雨停了。");
  await page.getByRole("button", { name: "添加新章节" }).click();
  await expect(page.getByRole("textbox", { name: "章节正文" })).toHaveValue("");
  await page.getByRole("textbox", { name: "章节标题" }).fill("第二章 夜航");
  await page
    .getByRole("textbox", { name: "章节正文" })
    .fill("林晚把钥匙放在桌上。");
  await page.getByRole("button", { name: /01.*第一章/ }).click();
  await expect(editor).toHaveValue(/保存测试：雨停了。/);
  await page.getByRole("button", { name: "返回书架" }).click();
  await expect(
    page.getByRole("button", { name: "打开 雾港来信" }),
  ).toBeVisible();
  await expect(page.locator(".recent-project")).toContainText("第二章 夜航");
  await page.screenshot({
    path: resolve(output, "04-bookshelf-with-book.png"),
  });
  await page
    .locator(".recent-project")
    .getByRole("button", { name: /继续写作/ })
    .click();
  await expect(editor).toHaveValue(/林晚把钥匙放在桌上。/);
  await page.getByRole("tab", { name: "功能" }).click();
  await page.getByRole("button", { name: "故事大纲", exact: true }).click();
  const chapterBoardTab = page.getByRole("tab", { name: "章节看板" });
  await chapterBoardTab.click();
  await expect(chapterBoardTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".chapter-board")).toContainText("第二章 夜航");
  await page.screenshot({ path: resolve(output, "06-chapter-board.png") });
  await page.locator(".chapter-board-write").last().click();
  await expect(page.getByRole("textbox", { name: "章节标题" })).toHaveValue(
    "第二章 夜航",
  );
  await page.setViewportSize({ width: 900, height: 900 });
  const chapterDrawerTrigger = page.getByRole("button", {
    name: "打开章节目录",
  });
  await expect(chapterDrawerTrigger).toBeVisible();
  await chapterDrawerTrigger.click();
  const chapterSidebar = page.locator(".workspace-sidebar");
  await page.waitForTimeout(220);
  expect((await chapterSidebar.boundingBox()).x).toBe(0);
  await chapterSidebar.getByRole("button", { name: "关闭章节目录" }).click();
  await page.waitForTimeout(220);
  expect((await chapterSidebar.boundingBox()).x).toBeLessThan(0);
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.getByRole("tab", { name: "功能" }).click();
  await page.getByRole("button", { name: "关系与记忆" }).click();
  await expect(page.getByText("来源变化，等待复核")).toBeVisible();
  await page.getByRole("button", { name: "人物档案", exact: true }).click();
  await page.getByRole("button", { name: "新建人物" }).click();
  await page.getByLabel("人物姓名 *", { exact: true }).fill("顾舟");
  await page.getByLabel("身份与定位", { exact: true }).fill("配角 · 船长");
  await page.getByRole("button", { name: "保存人物" }).click();
  await expect(
    page.getByRole("heading", { name: "顾舟", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "模型与设置", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "模型与本地设置" }),
  ).toBeVisible();
  await page.screenshot({ path: resolve(output, "05-settings.png") });
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Desktop smoke checks passed: bookshelf, demo, editing, chapter switching, persistence, stale memory, characters, settings.",
  );
} finally {
  await app.close();
}
