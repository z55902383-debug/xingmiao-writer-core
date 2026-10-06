import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve("test-results"),
  dataPath = resolve(output, "v02-data");
await mkdir(output, { recursive: true });
await rm(dataPath, { recursive: true, force: true });
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: dataPath };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
const app = await electron.launch({ args: ["."], env });
const previousClipboard = await app.evaluate(
  async ({ clipboard }) => await clipboard.readText(),
);
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = (action, data = {}) =>
    page.evaluate(
      async ({ action, data }) => {
        const r = await window.xingmiao.invoke(action, data);
        if (!r.ok) throw Error(r.error);
        return r.data;
      },
      { action, data },
    );
  const settings = async () =>
    page.getByRole("button", { name: "模型与设置", exact: true }).click();
  const close = async () =>
    page
      .getByRole("dialog", { name: "模型与本地设置", exact: true })
      .getByRole("button", { name: "关闭弹窗", exact: true })
      .click();
  await page.getByRole("button", { name: "打开示例体验" }).click();
  const guideClose = page.locator(".creation-guide-close");
  if (await guideClose.isVisible().catch(() => false)) await guideClose.click();
  await expect(page.locator(".brand-mark img")).toBeVisible();
  const avatar = await page
    .locator(".brand-mark img")
    .evaluate((el) => el.naturalWidth);
  assert.ok(avatar > 0);
  await page.getByLabel("更多", { exact: true }).click();
  await page.getByRole("button", { name: "复制整章正文", exact: true }).click();
  await expect(page.getByText("正文已复制", { exact: true })).toBeVisible();
  assert.equal(
    await app.evaluate(async ({ clipboard }) =>
      (await clipboard.readText()).includes("雨落了一整个下午"),
    ),
    true,
  );
  await page.getByRole("button", { name: "查找", exact: true }).click();
  await page.getByLabel("查找正文").fill("铜钥匙");
  await page.getByRole("button", { name: "下一个", exact: true }).click();
  assert.equal(
    await page
      .getByLabel("章节正文", { exact: true })
      .evaluate((e) => e.value.slice(e.selectionStart, e.selectionEnd)),
    "铜钥匙",
  );
  await page.getByLabel("更多", { exact: true }).click();
  await page.getByRole("button", { name: "复制选中文字", exact: true }).click();
  await expect(page.getByText("选中文字已复制", { exact: true })).toBeVisible();
  assert.equal(
    await app.evaluate(
      async ({ clipboard }) => (await clipboard.readText()) === "铜钥匙",
    ),
    true,
  );
  await page.getByLabel("更多", { exact: true }).click();
  await page.getByRole("button", { name: "创建章节副本", exact: true }).click();
  await expect(page.getByLabel("章节标题", { exact: true })).toHaveValue(
    /副本/,
  );
  await page.getByLabel("更多", { exact: true }).click();
  await page.getByRole("button", { name: "删除本章", exact: true }).click();
  await page
    .getByRole("dialog", { name: "删除本章？" })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page.getByLabel("章节标题", { exact: true })).not.toHaveValue(
    /副本/,
  );
  await settings();
  await page.getByRole("button", { name: "写作 Skill", exact: true }).click();
  await page.getByRole("button", { name: "新建 Skill", exact: true }).click();
  await page.getByLabel("Skill 名称", { exact: true }).fill("悬念控制");
  await page.getByLabel("说明", { exact: true }).fill("把悬念放在具体动作里");
  await page
    .getByLabel("指令内容", { exact: true })
    .fill("用一个尚未完成的动作结束场景。");
  await page.getByRole("button", { name: "保存 Skill", exact: true }).click();
  await page.getByLabel("启用 悬念控制", { exact: true }).click();
  await expect(page.getByLabel("启用 悬念控制", { exact: true })).toBeChecked();
  const books = await call("books:list"),
    book = await call("book:get", { id: books[0].id });
  const ctx = await call("context:preview", {
    bookId: book.id,
    chapterId: book.chapters[0].id,
    kind: "write",
  });
  assert.ok(ctx.skills.some((s) => s.name === "悬念控制"));
  await page.locator(".settings-content").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: resolve(output, "v02-skills.png") });
  const skillFile = resolve(output, "import-skill.md");
  await writeFile(
    skillFile,
    "---\nname: 导入的写法\ndescription: 测试导入\n---\n保持清楚的空间关系。",
    "utf8",
  );
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, skillFile);
  await page.getByRole("button", { name: "导入文件", exact: true }).click();
  await expect(
    page.getByLabel("启用 导入的写法", { exact: true }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "删除 导入的写法", exact: true })
    .click();
  await page
    .getByRole("button", { name: "确认删除 Skill", exact: true })
    .click();
  await page.getByRole("button", { name: "模型连接", exact: true }).click();
  await page.getByRole("button", { name: "添加模型", exact: true }).click();
  await page.getByLabel("配置名称", { exact: true }).fill("本机 Codex");
  await page.getByLabel("连接方式", { exact: true }).selectOption("codex");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByText("模型配置已保存", { exact: true })).toBeVisible();
  const config = await call("config:get");
  assert.equal(config.profiles.length, 2);
  assert.equal(config.provider, "codex");
  assert.equal(config.hasKey, false);
  assert.equal(config.model, "");
  await page.locator(".settings-content").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: resolve(output, "v02-codex.png") });
  await page.getByRole("button", { name: "数据与回收站", exact: true }).click();
  await expect(page.locator(".trash-row")).toHaveCount(1);
  await page
    .locator(".trash-row")
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  await expect(page.locator(".trash-row")).toHaveCount(0);
  await close();
  await page.getByLabel("切换写作模型").click();
  await page.getByLabel("选择模型", { exact: true }).selectOption("default");
  await expect
    .poll(async () => (await call("config:get")).profileId)
    .toBe("default");
  await page.getByLabel("选择模型", { exact: true }).selectOption(
    config.profileId,
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "开始生成", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: resolve(output, "v02-workspace.png") });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1040, 760),
  );
  await settings();
  await page.getByRole("button", { name: "写作 Skill", exact: true }).click();
  assert.equal(
    await page
      .locator(".settings-content")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
  );
  await page.screenshot({ path: resolve(output, "v02-compact.png") });
  await close();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1480, 940),
  );
  // Verify backup round-trip retains soft-deleted chapters and remaps the recycle entry.
  await call("chapter:delete", { id: book.chapters[0].id });
  await call("book:delete", { id: book.id });
  const backupPath = resolve(output, "v02-backup.json");
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, backupPath);
  await call("backup:save");
  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  assert.ok(backup.books[0].deletedAt);
  assert.ok(backup.skills.length >= 4);
  assert.equal(JSON.stringify(backup).includes("encryptedKey"), false);
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, backupPath);
  assert.equal(await call("backup:restore"), 1);
  assert.equal((await call("books:list")).length, 0);
  let trash = await call("trash:list");
  const restoredBook = trash.find(
    (t) => t.type === "book" && t.bookId !== book.id,
  );
  assert.ok(restoredBook);
  const restoredChapter = trash.find(
    (t) => t.type === "chapter" && t.bookId === restoredBook.bookId,
  );
  assert.ok(restoredChapter);
  assert.notEqual(restoredChapter.item.id, book.chapters[0].id);
  await call("trash:restore", { id: restoredBook.id });
  await call("trash:restore", { id: restoredChapter.id });
  const rb = await call("book:get", { id: restoredBook.bookId });
  assert.equal(rb.chapters.length, 2);
  assert.ok(
    rb.memories.every(
      (m) =>
        !m.sourceChapterId ||
        rb.chapters.some((c) => c.id === m.sourceChapterId),
    ),
  );
  assert.ok(
    (await call("versions:list", { id: restoredChapter.item.id })).length,
  );
  // Confirm shelf deletion is explicit and recoverable.
  await page.getByRole("button", { name: "返回书架", exact: true }).click();
  await page
    .locator(".book-card")
    .getByLabel(/^更多操作/, { exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "删除作品", exact: true }).click();
  await page.getByRole("button", { name: "移入回收站", exact: true }).click();
  await expect(page.getByText("你的第一部作品，等你落笔")).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    "v0.2 desktop passed: cat avatar, clipboard, selection/find, duplicate/delete/restore, Skill create/toggle/import/delete/context, multi-model/Codex config/switch, backup recycle remapping, shelf deletion.",
  );
} finally {
  await app.evaluate(async ({ clipboard }, previous) => {
    const current = await clipboard.readText();
    if (current === "铜钥匙" || current.startsWith("雨落了一整个下午"))
      await clipboard.writeText(previous);
  }, previousClipboard);
  await app.close();
}
