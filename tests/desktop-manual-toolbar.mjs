import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Real renderer and Store, always in a fresh test profile. All exports remain
// inside that profile; this script never accesses the author's library or AI.
const root = resolve("test-results/manual-toolbar");
await mkdir(root, { recursive: true });
const dataDir = await mkdtemp(resolve(root, "run-"));
const output = resolve(dataDir, "verification");
await mkdir(output, { recursive: true });
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
const skipScreenshots = process.argv.includes("--no-screenshots");
const checks = [], pageErrors = [], screenshots = [], layoutBounds = [];
let app, page, call, book, chapter;
let language = "zh-CN";
const names = {
  "zh-CN": {
    editor: "码字正文", toolbar: "码字工具栏", groups: ["文稿", "编辑", "视图", "专注"],
    alertTitle: "章节已有新修改", alertCopy: "当前码字稿仍保留，请选择一种方式继续。",
    saveAs: "另存为新章节", reload: "重新载入作品", export: "导出 TXT",
  },
  en: {
    editor: "Writing pad text", toolbar: "Writing pad toolbar", groups: ["Draft", "Edit", "View", "Focus"],
    alertTitle: "Chapter changed elsewhere", alertCopy: "Your writing draft is kept. Choose how to continue.",
    saveAs: "Save as a new chapter", reload: "Reload story version", export: "Export TXT",
  },
};
const editor = () => page.getByRole("textbox", { name: names[language].editor, exact: true });
const toolbar = () => page.getByRole("toolbar", { name: names[language].toolbar, exact: true });
const notice = () => page.locator(".mt-save-notice");

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
  await page.setViewportSize({ width: 1460, height: 900 });
  call = (action, data = {}) => page.evaluate(async ({ action, data }) => {
    const result = await window.xingmiao.invoke(action, data);
    if (!result.ok) throw Error(result.error);
    return result.data;
  }, { action, data });
  await expect(page.getByRole("button", { name: /人工码字板/ })).toBeVisible();
}

async function setLanguage(value) {
  await page.evaluate((value) => {
    localStorage.setItem("xm-language", value);
    window.dispatchEvent(new StorageEvent("storage", { key: "xm-language", newValue: value }));
  }, value);
  language = value;
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(value);
}

async function theme(value) {
  const name = language === "en"
    ? value === "light" ? "Light mode" : "Dark mode"
    : value === "light" ? "浅色模式" : "深色模式";
  const toggle = toolbar().getByRole("button", { name, exact: true });
  if (await toggle.count()) await toggle.click();
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  )).toBe(value);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.themeReveal || "")).toBe("");
  await toolbar().evaluate((element) => { element.scrollLeft = 0; });
}

async function pick(chapterTitle) {
  await page.getByRole("button", { name: "选择章节", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "选择章节", exact: true });
  await dialog.getByRole("button", { name: book.title, exact: false }).click();
  await dialog.locator(".mt-picker-chapters").getByRole("button", { name: new RegExp(chapterTitle) }).click();
  await expect(dialog).not.toBeVisible();
}

async function latestChapter() {
  return (await call("book:get", { id: book.id })).chapters.find((value) => value.id === chapter.id);
}

async function focusSync() {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

async function libraryDrafts() {
  return page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("xm-manual-library-v2")).drafts));
}

async function snapshot(file) {
  if (skipScreenshots) return;
  const toast = page.locator(".toast");
  if (await toast.isVisible()) await toast.getByRole("button", { name: "关闭提示", exact: true }).click();
  await expect(toast).not.toBeVisible();
  await page.screenshot({ path: resolve(output, file), animations: "disabled" });
  screenshots.push(file);
}

async function assertLayout(label, conflict = false) {
  const measured = await page.evaluate(() => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const ribbon = document.querySelector(".mt-ribbon");
    const controls = [...ribbon.querySelectorAll("button")].map((button) => ({
      name: button.getAttribute("aria-label") || button.innerText,
      text: button.innerText.trim(), fontSize: Number.parseFloat(getComputedStyle(button).fontSize),
      iconSize: box(button.querySelector("svg")).width,
      zoom: getComputedStyle(button).zoom, transform: getComputedStyle(button).transform,
      ...box(button),
    }));
    const warning = document.querySelector(".mt-save-notice");
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      header: box(document.querySelector(".mt-header")),
      toolbar: { ...box(ribbon), scrollWidth: ribbon.scrollWidth, clientWidth: ribbon.clientWidth },
      groups: [...ribbon.querySelectorAll(".mt-tool-group")].map((group) => ({
        name: group.getAttribute("aria-label"), flexGrow: Number(getComputedStyle(group).flexGrow), ...box(group),
      })),
      scaledContainers: [document.documentElement, document.body, document.querySelector(".mt-root"), ribbon].map((element) => ({
        zoom: getComputedStyle(element).zoom, transform: getComputedStyle(element).transform,
      })),
      controls, editor: box(document.querySelector(".mt-textarea")),
      notice: warning ? box(warning) : null,
      actions: warning ? [...warning.querySelectorAll("button")].map((button) => ({ name: button.innerText, ...box(button) })) : [],
    };
  });
  layoutBounds.push({ label, ...measured });
  assert.ok(measured.documentWidth <= measured.viewport.width + 1, `${label}: the page must not overflow horizontally`);
  assert.ok(measured.editor.width >= 300 && measured.editor.height >= 180, `${label}: a usable manuscript area must remain`);
  assert.ok(measured.header.height <= 56, `${label}: the title bar should occupy at most 56px`);
  // Native Windows scrollbars add 10px when narrow/long-label rows overflow.
  // The fitted ribbon must stay compact without hiding that reachable overflow.
  const horizontalScroll = measured.toolbar.scrollWidth > measured.toolbar.clientWidth + 1;
  assert.ok(measured.toolbar.height <= (horizontalScroll ? 72 : 62), `${label}: the command ribbon should stay compact`);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()), 1,
    `${label}: the browser must not zoom the interface`);
  for (const style of [...measured.scaledContainers, ...measured.controls]) {
    assert.ok(style.zoom === "1" || style.zoom === "normal", `${label}: CSS zoom must not shrink commands`);
    // Existing hover transitions translate buttons by a fraction of a pixel.
    // Translation is harmless; a scale/rotation matrix would resize the UI.
    assert.ok(style.transform === "none" || /^matrix\(1, 0, 0, 1, [^,]+, [^)]+\)$/.test(style.transform),
      `${label}: CSS transforms must not scale the interface (${style.transform})`);
  }
  for (const control of measured.controls) {
    assert.ok(control.text, `${label}: ${control.name} requires a visible command label`);
    assert.ok(control.width >= 39.9 && control.height >= 39.9, `${label}: ${control.name} requires a usable hit target`);
    assert.ok(control.fontSize >= 12 && control.fontSize <= 13.1, `${label}: command labels must remain readable without excessive enlargement`);
    assert.ok(control.iconSize >= 15.9 && control.iconSize <= 18.1, `${label}: icons must retain their readable size`);
    assert.ok(control.y >= measured.toolbar.y && control.y + control.height <= measured.toolbar.y + measured.toolbar.height + 1,
      `${label}: ${control.name} must remain inside the toolbar`);
  }
  for (let index = 1; index < measured.controls.length; index++) {
    const left = measured.controls[index - 1], right = measured.controls[index];
    assert.ok(left.x + left.width <= right.x + 1, `${label}: adjacent command hit targets must not overlap`);
  }
  for (const name of names[language].groups) {
    const group = toolbar().getByRole("group", { name, exact: true });
    await expect(group).toHaveCount(1);
    await group.scrollIntoViewIfNeeded();
    const control = group.getByRole("button").last();
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport();
  }
  if (conflict) {
    await expect(notice()).toContainText(names[language].alertTitle);
    await expect(notice()).toContainText(names[language].alertCopy);
    if (language === "zh-CN") assert.ok(measured.notice.height <= 46, `${label}: the Chinese conflict notice should occupy at most 46px`);
    assert.equal(measured.actions.length, 3, `${label}: all three recovery choices must be present`);
    for (const action of measured.actions) {
      assert.ok(action.x >= -1 && action.x + action.width <= measured.viewport.width + 1,
        `${label}: recovery actions must remain inside the page`);
      assert.ok(action.y >= measured.notice.y && action.y + action.height <= measured.notice.y + measured.notice.height + 1,
        `${label}: recovery actions must remain inside their notice`);
    }
    await expect(notice().getByRole("button", { name: names[language].saveAs, exact: true })).toHaveClass(/primary-soft/);
    for (const name of [names[language].saveAs, names[language].reload, names[language].export]) {
      await expect(notice().getByRole("button", { name, exact: true })).toBeEnabled();
    }
  }
  await toolbar().evaluate((element) => { element.scrollLeft = 0; });
  return measured;
}

async function writingState() {
  return {
    prose: await editor().inputValue(),
    counts: await page.locator(".mt-footer-center").innerText(),
    saveStatus: await page.locator(".mt-footer .mt-save-status").innerText(),
    chapter: await latestChapter(),
  };
}

try {
  await launch();
  book = await call("book:create", { title: "顶部工具栏隔离回归", genre: "悬疑" });
  const body = "　　林晚关上书店的门。\n\n　　街角的路灯亮了起来。\n\n　　一封没有署名的信压在门缝下面。";
  chapter = await call("chapter:save", {
    id: book.chapters[0].id, revision: book.chapters[0].revision,
    patch: { title: "第1章 雨夜书店", body },
  });
  await page.reload();
  await page.getByRole("button", { name: /人工码字板/ }).click();
  await pick(chapter.title);
  // Match the user's focused editing view while keeping the panel toggles usable.
  for (const name of ["灵感助手", "备忘录"]) {
    const button = toolbar().getByRole("button", { name, exact: true });
    if (await button.getAttribute("aria-pressed") === "true") await button.click();
  }
  await check("all four command groups expose visible text with their icons", async () => {
    const groups = [
      ["文稿", ["选择章节", "新建临时稿", "临时稿管理", "稿件与历史", "导出 TXT"]],
      ["编辑", ["查找替换", "一键排版", "正文排版"]],
      ["视图", ["灵感助手", "备忘录", "显示设置", "浅色模式"]],
      ["专注", ["开始计时", "重置计时", "目标与设置", "开启音效", "专注模式 (F11)"]],
    ];
    await theme("dark");
    for (const [name, controls] of groups) {
      const group = toolbar().getByRole("group", { name, exact: true });
      for (const label of controls) {
        const control = group.getByRole("button", { name: label, exact: true });
        await expect(control).toHaveCount(1);
        assert.ok((await control.innerText()).trim(), `${label} needs a visible label`);
        await expect(control.locator("svg")).toHaveCount(1);
      }
    }
    await toolbar().getByRole("button", { name: "显示设置", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "显示设置", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
    await toolbar().getByRole("button", { name: "查找替换", exact: true }).click();
    await expect(page.getByRole("search", { name: "本章查找替换", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "关闭查找替换", exact: true }).click();
  });
  await check("normal toolbar layouts work in both themes and narrow windows", async () => {
    for (const value of ["dark", "light"]) {
      await theme(value);
      await page.setViewportSize({ width: 1460, height: 900 });
      await assertLayout(`normal-${value}-1460`);
      await snapshot(`manual-toolbar-normal-${value}-1460.png`);
      await page.setViewportSize({ width: 900, height: 700 });
      await assertLayout(`normal-${value}-900`);
    }
    await page.setViewportSize({ width: 1460, height: 900 });
  });
  await check("resizing to 2000px proportionally fills the ribbon without altering writing state", async () => {
    await expect(page.locator(".mt-footer .mt-save-status")).toHaveText("已保存到作品");
    for (const value of ["dark", "light"]) {
      await theme(value);
      await page.setViewportSize({ width: 1460, height: 900 });
      const before = await assertLayout(`fluid-${value}-1460`);
      const state = await writingState();
      await page.setViewportSize({ width: 2000, height: 900 });
      const after = await assertLayout(`fluid-${value}-2000`);
      for (let index = 0; index < after.groups.length; index++) {
        assert.ok(after.groups[index].width > before.groups[index].width + 20,
          `${value}: ${after.groups[index].name} must grow to use the wider window`);
        assert.ok(after.groups[index].flexGrow > 0, `${value}: all command groups must share remaining width`);
      }
      const last = after.groups.at(-1);
      assert.ok(after.viewport.width - (last.x + last.width) <= 32,
        `${value}: the final command group must extend close to the right edge`);
      const lastControl = after.controls.at(-1);
      assert.ok(after.viewport.width - (lastControl.x + lastControl.width) <= 48,
        `${value}: the last command itself must extend close to the right edge`);
      assert.ok(after.toolbar.scrollWidth <= after.toolbar.clientWidth + 1,
        `${value}: Chinese commands should fit the 2000px window without horizontal scrolling`);
      assert.deepEqual(await writingState(), state, "Resizing must preserve prose, word count, save state, and the stored chapter");
      await snapshot(`manual-toolbar-normal-${value}-2000.png`);
    }
    await page.setViewportSize({ width: 1460, height: 900 });
  });
  const localBody = body + "\n\n　　作者还没保存的构思：信封里藏着一把旧钥匙。";
  const remoteBody = "　　另一窗口的新正文：门缝里只剩一张空白纸。\n\n　　雨声掩住了脚步声。";
  await check("external updates raise an explicit conflict while preserving both texts", async () => {
    await editor().fill(localBody);
    chapter = await call("chapter:save", { id: chapter.id, revision: chapter.revision, patch: { body: remoteBody } });
    await focusSync();
    await expect(notice()).toContainText("章节已有新修改");
    await expect(notice()).toContainText("当前码字稿仍保留，请选择一种方式继续。");
    await expect(editor()).toHaveValue(localBody);
    assert.equal((await latestChapter()).body, remoteBody);
    await page.getByRole("button", { name: "保存章节", exact: true }).click();
    await expect(notice()).toContainText("章节已有新修改");
    assert.equal((await latestChapter()).body, remoteBody, "Saving a stale draft must not overwrite newer work");
  });
  await check("conflict actions remain readable and usable in both themes and widths", async () => {
    for (const value of ["dark", "light"]) {
      await theme(value);
      for (const [width, height] of [[2000, 900], [900, 700]]) {
        await page.setViewportSize({ width, height });
        await assertLayout(`conflict-${value}-${width}`, true);
        await snapshot(`manual-toolbar-conflict-${value}-${width}.png`);
      }
    }
    await page.setViewportSize({ width: 1460, height: 900 });
  });
  await check("English command labels and conflict recovery choices stay within the page", async () => {
    await setLanguage("en");
    await focusSync();
    for (const [width, height] of [[2000, 900], [1460, 900], [900, 700]]) {
      await page.setViewportSize({ width, height });
      await assertLayout(`english-conflict-${width}`, true);
    }
    await expect(editor()).toHaveValue(localBody);
    await setLanguage("zh-CN");
    await focusSync();
    await page.setViewportSize({ width: 1460, height: 900 });
  });
  await check("export rescues the current draft without overwriting the changed chapter", async () => {
    const file = resolve(output, "conflict-draft.txt");
    await app.evaluate(({ dialog }, file) => {
      globalThis.__toolbarOriginalSaveDialog = dialog.showSaveDialog;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, file);
    try {
      await notice().getByRole("button", { name: "导出 TXT", exact: true }).click();
      await expect(page.locator(".toast")).toContainText("TXT 已保存");
      assert.equal(await readFile(file, "utf8"), `${chapter.title}\n\n${localBody}`);
      assert.equal((await latestChapter()).body, remoteBody);
      await expect(editor()).toHaveValue(localBody);
    } finally {
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = globalThis.__toolbarOriginalSaveDialog;
        delete globalThis.__toolbarOriginalSaveDialog;
      });
    }
  });
  await check("reload cancellation preserves the draft and confirmation creates a recoverable copy", async () => {
    const before = await libraryDrafts();
    await notice().getByRole("button", { name: "重新载入作品", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "重新载入作品？", exact: true });
    await expect(dialog).toContainText("当前内容会保留为一份临时文稿");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(editor()).toHaveValue(localBody);
    assert.equal((await latestChapter()).body, remoteBody);
    assert.equal((await libraryDrafts()).length, before.length, "Cancellation must not create or replace a draft");
    await notice().getByRole("button", { name: "重新载入作品", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "重新载入作品？", exact: true });
    await dialog.getByRole("button", { name: "保留副本并载入", exact: true }).click();
    await expect(editor()).toHaveValue(remoteBody);
    await expect(notice()).not.toBeVisible();
    const backup = (await libraryDrafts()).find((draft) => !draft.bookId && draft.text === localBody);
    assert.ok(backup, "The original dirty text must remain in a separate scratch draft");
    await toolbar().getByRole("button", { name: "临时稿管理", exact: true }).click();
    const manager = page.getByRole("dialog", { name: "临时稿管理", exact: true });
    await manager.locator(".mt-draft-row").filter({ hasText: chapter.title })
      .getByRole("button", { name: chapter.title, exact: true }).click();
    await expect(editor()).toHaveValue(localBody);
    assert.equal((await latestChapter()).body, remoteBody);
    await pick(chapter.title);
    await expect(editor()).toHaveValue(remoteBody);
  });
  await check("saving a conflict as a new chapter preserves the external chapter and local prose", async () => {
    const secondLocal = remoteBody + "\n\n　　另一条构思：窗边出现了与钥匙相同的刻痕。";
    const secondRemote = "　　作品中再次修改的版本：她走出门，没有回头。";
    await editor().fill(secondLocal);
    chapter = await latestChapter();
    chapter = await call("chapter:save", { id: chapter.id, revision: chapter.revision, patch: { body: secondRemote } });
    await focusSync();
    await expect(notice()).toContainText("章节已有新修改");
    await notice().getByRole("button", { name: "另存为新章节", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "存入作品", exact: true });
    await dialog.getByRole("textbox", { name: "章节标题", exact: true }).fill("第2章 另存的构思");
    await dialog.getByRole("button", { name: "新建章节并保存", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const current = await call("book:get", { id: book.id });
    assert.equal(current.chapters.find((value) => value.id === chapter.id).body, secondRemote);
    assert.equal(current.chapters.find((value) => value.title === "第2章 另存的构思").body, secondLocal);
    await expect(editor()).toHaveValue(secondLocal);
  });
  await check("a missing chapter uses the save-failure notice and retains current text", async () => {
    let doomed = await call("chapter:create", { bookId: book.id });
    doomed = await call("chapter:save", {
      id: doomed.id, revision: doomed.revision,
      patch: { title: "第3章 保存失败检查", body: "　　这一稿用于保存失败检查。" },
    });
    await page.getByRole("button", { name: "返回书架", exact: true }).click();
    await page.getByRole("button", { name: /人工码字板/ }).click();
    await pick(doomed.title);
    const dirty = doomed.body + "\n\n　　即使作品章节消失，这段内容也要保留。";
    await editor().fill(dirty);
    await call("chapter:delete", { id: doomed.id });
    await page.getByRole("button", { name: "保存章节", exact: true }).click();
    await expect(notice()).toContainText("暂时无法保存章节");
    await expect(notice()).toContainText("章节不存在，草稿仍保留");
    await expect(editor()).toHaveValue(dirty);
    await expect(notice().getByRole("button", { name: "另存为新章节", exact: true })).toBeEnabled();
  });
  await check("local retention failure has a distinct title and keeps the unsaved text in memory", async () => {
    await toolbar().getByRole("button", { name: "新建临时稿", exact: true }).click();
    await page.evaluate(() => {
      window.__toolbarStorageSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "xm-manual-library-v2") throw new DOMException("Fixture quota", "QuotaExceededError");
        return window.__toolbarStorageSetItem.call(this, key, value);
      };
    });
    const text = "　　临时稿保存失败时，内容仍然留在当前编辑器。";
    try {
      await editor().fill(text);
      await expect(notice()).toContainText("草稿未能保留");
      await expect(notice()).toContainText("草稿保留失败，请保存到作品或导出 TXT 后再离开。");
      await expect(editor()).toHaveValue(text);
      await expect(notice().getByRole("button", { name: "另存为新章节", exact: true })).toBeEnabled();
      await expect(notice().getByRole("button", { name: "导出 TXT", exact: true })).toBeEnabled();
      await expect(notice().getByRole("button", { name: "重新载入作品", exact: true })).toHaveCount(0);
    } finally {
      await page.evaluate(() => {
        Storage.prototype.setItem = window.__toolbarStorageSetItem;
        delete window.__toolbarStorageSetItem;
      });
      await editor().fill(text + "\n\n　　存储恢复后，可以继续保留草稿。");
      await expect(notice()).not.toBeVisible();
    }
  });
  await check("all toolbar and recovery flows produce no renderer exceptions", async () => assert.deepEqual(pageErrors, []));
  console.log(`Manual toolbar regression passed. ${output}`);
} finally {
  await writeFile(resolve(output, "report.json"), JSON.stringify({
    passed: checks.length > 0 && checks.every((value) => value.status === "passed"),
    dataDir, checks, errors: pageErrors, screenshots, layoutBounds,
  }, null, 2));
  if (app) await app.close();
}
