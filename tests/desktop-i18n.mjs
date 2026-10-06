import { _electron as electron, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve("test-results");
await mkdir(output, { recursive: true });
const dataPath = resolve(output, `i18n-data-${Date.now()}`);
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: dataPath };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
let app = await electron.launch({ args: ["."], env });
const errors = [];
try {
  let page = await app.firstWindow();
  page.on("pageerror", error => errors.push(error.message));
  await expect(page.getByRole("heading", { name: "我的书架", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "界面语言", exact: true }).selectOption("en");
  await expect(page.getByRole("heading", { name: "My library", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "New story", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Start a new story" })).toBeVisible();
  await page.getByRole("textbox", { name: "Title *", exact: true }).fill("保存 · A story in two languages");
  await page.getByRole("combobox", { name: "Genre", exact: true }).selectOption("悬疑");
  await expect(page.getByRole("combobox", { name: "Genre", exact: true })).toHaveValue("悬疑");
  await page.getByRole("button", { name: "Create story", exact: true }).click();
  const body = page.getByRole("textbox", { name: "Chapter text", exact: true });
  await expect(body).toBeVisible();
  const original = "保存不是界面按钮。世界设定属于故事。\nThe last train carried a secret.";
  await body.fill(original);
  const originalTitle = await page.getByRole("textbox", { name: "Chapter title", exact: true }).inputValue();
  await page.getByRole("combobox", { name: "Interface language", exact: true }).selectOption("zh-CN");
  await expect(page.getByRole("textbox", { name: "章节正文", exact: true })).toHaveValue(original);
  await expect(page.getByRole("textbox", { name: "章节标题", exact: true })).toHaveValue(originalTitle);
  await page.getByRole("combobox", { name: "界面语言", exact: true }).selectOption("en");
  await expect(body).toHaveValue(original);
  const closeGuide = page.locator(".creation-guide-close");
  if (await closeGuide.isVisible().catch(() => false)) await closeGuide.click();
  await page.screenshot({ path: resolve(output, "i18n-editor-en.png"), animations: "disabled" });
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  for (const name of ["Story outline", "Characters", "Worldbuilding", "Relationships & memory"]) {
    await page.locator(".workspace-nav").getByRole("button", { name, exact: true }).click();
    await page.getByRole("button", { name: "Canvas", exact: true }).click();
    await expect(page.locator(".cc-toolbar")).toBeVisible();
    await page.getByRole("combobox", { name: "Interface language", exact: true }).selectOption("zh-CN");
    await expect(page.getByRole("button", { name: "自动整理", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "界面语言", exact: true }).selectOption("en");
    await expect(page.getByRole("button", { name: "Arrange", exact: true })).toBeVisible();
  }
  await page.screenshot({ path: resolve(output, "i18n-canvas-en.png"), animations: "disabled" });
  await page.locator(".workspace-nav").getByRole("button", { name: "Chapter text", exact: true }).click();
  await expect(body).toHaveValue(original);
  await page.getByRole("button", { name: "Models & settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Models & local settings" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Language", exact: true }).click();
  await settings.getByRole("combobox", { name: "Interface language", exact: true }).selectOption("zh-CN");
  await expect(page.getByRole("dialog", { name: "模型与本地设置" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "语言设置" })).toBeVisible();
  await page.getByRole("dialog", { name: "模型与本地设置" }).getByRole("combobox", { name: "界面语言", exact: true }).selectOption("en");
  await page.screenshot({ path: resolve(output, "i18n-settings-en.png"), animations: "disabled" });
  await settings.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Back to library", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open 保存 · A story in two languages", exact: true })).toBeVisible();
  for (const [width, height] of [[1460, 900], [1000, 640], [560, 800]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(output, `i18n-shelf-en-${width}.png`), animations: "disabled" });
  }
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: resolve(output, "i18n-shelf-en-light.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1460, height: 900 });
  await app.close();
  app = await electron.launch({ args: ["."], env });
  page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "My library", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Interface language", exact: true })).toHaveValue("en");
  await page.getByRole("button", { name: "Open 保存 · A story in two languages", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Chapter text", exact: true })).toHaveValue(original);
  const book = await page.evaluate(async () => {
    const list = await window.xingmiao.invoke("books:list", {});
    return (await window.xingmiao.invoke("book:get", { id: list.data[0].id })).data;
  });
  expect(book.genre).toBe("悬疑");
  expect(book.title).toBe("保存 · A story in two languages");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Bilingual UI passed: live switching, settings, three viewports, restart persistence and unchanged manuscript/genre.");
} finally {
  await app.close();
}
