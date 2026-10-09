import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Every run uses a new profile and SQLite database. Never inherit or delete an
// author's real library; screenshots and the report live beside the fixtures.
const root = resolve("test-results/manual-typing");
await mkdir(root, { recursive: true });
const dataDir = await mkdtemp(resolve(root, "run-"));
const output = resolve(dataDir, "verification");
await mkdir(output, { recursive: true });
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;

const checks = [];
const pageErrors = [];
const screenshots = [];
const skipScreenshots = process.argv.includes("--no-screenshots");
let app;
let page;
let call;
const words = (body) => body.replace(/\s/g, "").length;

async function check(name, run) {
  try {
    await run();
    checks.push({ name, status: "passed" });
    console.log(`Passed: ${name}`);
  } catch (error) {
    checks.push({
      name,
      status: "failed",
      error: error.stack || error.message,
    });
    throw error;
  }
}

async function launch() {
  app = await electron.launch({ args: ["."], env });
  assert.equal(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
    dataDir,
  );
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  call = (action, data = {}) =>
    page.evaluate(
      async ({ action, data }) => {
        const result = await window.xingmiao.invoke(action, data);
        if (!result.ok) throw Error(result.error);
        return result.data;
      },
      { action, data },
    );
  await expect(page.getByRole("button", { name: /人工码字板/ })).toBeVisible();
}

const editor = () =>
  page.getByRole("textbox", { name: "码字正文", exact: true });
async function openManual() {
  await page.getByRole("button", { name: /人工码字板/ }).click();
  await expect(
    page.getByRole("heading", { name: "人工码字板", level: 1 }),
  ).toBeVisible();
  await expect(editor()).toBeVisible();
}
async function pick(bookTitle, chapterTitle) {
  await page.getByRole("button", { name: "选择章节", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "选择章节", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: new RegExp(bookTitle) }).click();
  await dialog
    .locator(".mt-picker-chapters")
    .getByRole("button", { name: new RegExp(chapterTitle) })
    .click();
  await expect(dialog).not.toBeVisible();
}
async function pickScratch(title) {
  await page.getByRole("button", { name: "选择章节", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "选择章节", exact: true });
  await dialog
    .locator(".mt-picker-books")
    .getByRole("button", { name: new RegExp(title) })
    .click();
  await expect(dialog).not.toBeVisible();
}
async function back() {
  await page.getByRole("button", { name: "返回书架", exact: true }).click();
  await expect(editor()).not.toBeVisible();
  await expect(page.getByRole("button", { name: /人工码字板/ })).toBeVisible();
}
async function readDailyWords() {
  const text = await page.locator(".mt-root").innerText();
  const match = text.match(/今日净增\s*\+?(-?[\d,]+)/);
  assert.ok(match, "The editor must expose its daily net word count");
  return Number(match[1].replaceAll(",", ""));
}

try {
  await launch();
  const firstBody = "雨落在书店门前。\n\n林晚把钥匙放在桌上。";
  const secondBody = "陈默推开旧仓库的门。";
  const firstBook = await call("book:create", {
    title: "码字回归甲书",
    genre: "悬疑",
  });
  let firstChapter = await call("chapter:save", {
    id: firstBook.chapters[0].id,
    revision: firstBook.chapters[0].revision,
    patch: { title: "第1章 雨夜书店", body: firstBody },
  });
  let secondChapter = await call("chapter:create", { bookId: firstBook.id });
  secondChapter = await call("chapter:save", {
    id: secondChapter.id,
    revision: secondChapter.revision,
    patch: { title: "第2章 旧仓库", body: secondBody },
  });
  let doomed = await call("chapter:create", { bookId: firstBook.id });
  doomed = await call("chapter:save", {
    id: doomed.id,
    revision: doomed.revision,
    patch: { title: "第3章 待删除章节", body: "这一章用于验证保存失败。" },
  });
  const otherBook = await call("book:create", {
    title: "码字回归乙书",
    genre: "科幻",
  });
  const otherBody = "星舰停靠在外环港口。";
  await call("chapter:save", {
    id: otherBook.chapters[0].id,
    revision: otherBook.chapters[0].revision,
    patch: { title: "第1章 外环港", body: otherBody },
  });
  await page.reload();

  await check(
    "selecting a chapter loads its real body and starts session growth at zero",
    async () => {
      await openManual();
      await pick(firstBook.title, firstChapter.title);
      await expect(editor()).toHaveValue(firstBody);
      await expect(page.locator(".mt-root")).toContainText(/本次净增\s*\+?0/);
    },
  );

  const firstDraft = firstBody + "\n\n林晚听见门外有人敲了三下。";
  await check(
    "returning immediately after typing retains an unsaved draft without updating the work",
    async () => {
      await editor().fill(firstDraft);
      // Exit inside the debounce window: retaining the draft must be synchronous.
      await back();
      assert.equal(
        (await call("book:get", { id: firstBook.id })).chapters[0].body,
        firstBody,
      );
      await openManual();
      await expect(editor()).toHaveValue(firstDraft);
      await expect(page.locator(".mt-root")).toContainText("草稿已保留在本机");
    },
  );

  const secondDraft = secondBody + "\n地面留着一串新鲜的脚印。";
  await check(
    "switching chapters and works keeps independent drafts instead of transplanting the text",
    async () => {
      await pick(firstBook.title, secondChapter.title);
      await expect(editor()).toHaveValue(secondBody);
      await editor().fill(secondDraft);
      await pick(otherBook.title, "第1章 外环港");
      await expect(editor()).toHaveValue(otherBody);
      await pick(firstBook.title, firstChapter.title);
      await expect(editor()).toHaveValue(firstDraft);
      await pick(firstBook.title, secondChapter.title);
      await expect(editor()).toHaveValue(secondDraft);
      await pick(firstBook.title, firstChapter.title);
      await expect(editor()).toHaveValue(firstDraft);
    },
  );

  await check(
    "Ctrl+S saves the selected chapter with its revision and refreshes the bookshelf totals",
    async () => {
      await editor().focus();
      await page.keyboard.press("Control+s");
      await expect(page.locator(".mt-root")).toContainText("已保存到作品");
      await expect
        .poll(
          async () =>
            (await call("book:get", { id: firstBook.id })).chapters[0].body,
        )
        .toBe(firstDraft);
      const stored = (await call("book:get", { id: firstBook.id })).chapters;
      assert.equal(
        stored[1].body,
        secondBody,
        "Saving one chapter must not save another chapter's draft",
      );
      const sum = stored.reduce(
        (total, chapter) => total + words(chapter.body),
        0,
      );
      await back();
      const card = page
        .locator(".book-card")
        .filter({ has: page.getByRole("heading", { name: firstBook.title }) });
      await expect(card.locator(".book-meta")).toContainText(
        `${sum.toLocaleString()} 字 · 3 章`,
      );
      await openManual();
      await expect(editor()).toHaveValue(firstDraft);
    },
  );

  await check(
    "reopening a clean chapter picks up external edits without treating them as new typing",
    async () => {
      await pick(otherBook.title, "第1章 外环港");
      await expect(editor()).toHaveValue(otherBody);
      await back();
      const latest = (await call("book:get", { id: otherBook.id })).chapters[0];
      const refreshedBody = otherBody + "\n飞行员在另一窗口更新了航行计划。";
      await call("chapter:save", {
        id: latest.id,
        revision: latest.revision,
        patch: { body: refreshedBody },
      });
      await openManual();
      await expect(editor()).toHaveValue(refreshedBody);
      await expect(page.locator(".mt-root")).toContainText(/本次净增\s*\+?0/);
    },
  );

  const externalBody = "另一窗口已把仓库章节改成最新正文。";
  await check(
    "a concurrent chapter revision rejects the save and preserves both versions",
    async () => {
      await pick(firstBook.title, secondChapter.title);
      await expect(editor()).toHaveValue(secondDraft);
      const latest = (
        await call("book:get", { id: firstBook.id })
      ).chapters.find((chapter) => chapter.id === secondChapter.id);
      await call("chapter:save", {
        id: latest.id,
        revision: latest.revision,
        patch: { body: externalBody },
      });
      await page.getByRole("button", { name: "保存章节", exact: true }).click();
      await expect(page.locator(".toast")).toContainText(
        /发生变化|被修改|冲突|更新/,
      );
      await expect(editor()).toHaveValue(secondDraft);
      assert.equal(
        (await call("book:get", { id: firstBook.id })).chapters.find(
          (chapter) => chapter.id === latest.id,
        ).body,
        externalBody,
      );
      await back();
      await openManual();
      await expect(editor()).toHaveValue(secondDraft);
    },
  );

  await check(
    "reloading a conflict retains the original draft as a recoverable scratch copy",
    async () => {
      await page
        .getByRole("button", { name: "重新载入作品", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "重新载入作品？",
        exact: true,
      });
      await dialog
        .getByRole("button", { name: "保留副本并载入", exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await expect(editor()).toHaveValue(externalBody);
      await pickScratch(secondChapter.title);
      await expect(editor()).toHaveValue(secondDraft);
      await pick(firstBook.title, secondChapter.title);
      await expect(editor()).toHaveValue(externalBody);
    },
  );

  const failedDraft = "章节删除以后，作者刚刚输入的正文仍然必须保留。";
  await check(
    "a real backend save failure keeps the editor open and the draft recoverable",
    async () => {
      await pick(firstBook.title, doomed.title);
      await editor().fill(failedDraft);
      await call("chapter:delete", { id: doomed.id });
      await page.getByRole("button", { name: "保存章节", exact: true }).click();
      await expect(page.locator(".toast")).toContainText(
        /删除|恢复|不存在|找不到/,
      );
      await expect(editor()).toHaveValue(failedDraft);
      assert.equal(
        (await call("book:get", { id: firstBook.id })).chapters.some(
          (chapter) => chapter.id === doomed.id,
        ),
        false,
      );
      await back();
      await openManual();
      await expect(editor()).toHaveValue(failedDraft);
      await pick(firstBook.title, firstChapter.title);
      await pickScratch(doomed.title);
      await expect(editor()).toHaveValue(failedDraft);
    },
  );

  const scratchBody =
    "这是一份独立临时稿。\n\n天亮以前，船长还要作出最后的决定。";
  await check(
    "a temporary draft is saved as a new chapter and never overwrites an existing chapter",
    async () => {
      await pick(firstBook.title, firstChapter.title);
      const preservedChapterDraft = firstDraft + "\n这一句留在原章草稿中。";
      await editor().fill(preservedChapterDraft);
      await page
        .getByRole("button", { name: "新建临时稿", exact: true })
        .click();
      await expect(editor()).toHaveValue("");
      await page
        .getByRole("textbox", { name: "文稿标题", exact: true })
        .fill("第4章 黎明前的决定");
      await editor().fill(scratchBody);
      await pick(firstBook.title, firstChapter.title);
      await expect(editor()).toHaveValue(preservedChapterDraft);
      await pickScratch("第4章 黎明前的决定");
      await expect(editor()).toHaveValue(scratchBody);
      const before = await call("book:get", { id: firstBook.id });
      await page.getByRole("button", { name: "存入作品", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: "存入作品",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await dialog
        .getByLabel("保存到作品", { exact: true })
        .selectOption(firstBook.id);
      await dialog
        .getByRole("textbox", { name: "章节标题", exact: true })
        .fill("第4章 黎明之门");
      await dialog
        .getByRole("button", { name: "新建章节并保存", exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await expect(page.locator(".mt-root")).toContainText("已保存到作品");
      const after = await call("book:get", { id: firstBook.id });
      assert.equal(after.chapters.length, before.chapters.length + 1);
      for (const chapter of before.chapters)
        assert.equal(
          after.chapters.find((item) => item.id === chapter.id).body,
          chapter.body,
        );
      const appended = after.chapters.find(
        (chapter) => !before.chapters.some((item) => item.id === chapter.id),
      );
      assert.equal(appended.body, scratchBody);
      assert.equal(appended.title, "第4章 黎明之门");
      await expect(
        page.getByRole("textbox", { name: "文稿标题", exact: true }),
      ).toHaveValue(appended.title);
      await pick(firstBook.title, firstChapter.title);
      await expect(editor()).toHaveValue(preservedChapterDraft);
    },
  );

  let dailyAfter;
  await check(
    "daily progress survives leaving and reopening instead of resetting with the session",
    async () => {
      await page
        .getByRole("button", { name: "目标与设置", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "码字设置",
        exact: true,
      });
      await dialog
        .getByRole("radio", { name: "今日目标", exact: true })
        .check();
      await dialog.getByRole("button", { name: "完成", exact: true }).click();
      const dailyBefore = await readDailyWords();
      await editor().fill(
        (await editor().inputValue()) + "\n今天继续写下新的故事。",
      );
      await expect
        .poll(readDailyWords)
        .toBe(dailyBefore + words("今天继续写下新的故事。"));
      dailyAfter = await readDailyWords();
      await back();
      await openManual();
      assert.equal(await readDailyWords(), dailyAfter);
    },
  );

  await check(
    "focus mode can always be left with Escape and keeps the draft",
    async () => {
      const before = await editor().inputValue();
      await page
        .getByRole("button", { name: "专注模式 (F11)", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "退出专注模式 (Esc)", exact: true }),
      ).toBeVisible();
      await editor().focus();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "专注模式 (F11)", exact: true }),
      ).toBeVisible();
      await expect(editor()).toHaveValue(before);
    },
  );

  await check(
    "the focus timer starts, pauses and resets through the visible controls",
    async () => {
      await expect(page.locator(".mt-pomo-label")).toHaveText("25:00");
      await page.getByRole("button", { name: "开始计时", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "暂停计时", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".mt-pomo-label")).not.toHaveText("25:00");
      await page.getByRole("button", { name: "暂停计时", exact: true }).click();
      await expect(page.locator(".mt-pomo-phase")).toHaveText("已暂停");
      await page.getByRole("button", { name: "重置计时", exact: true }).click();
      await expect(page.locator(".mt-pomo-label")).toHaveText("25:00");
      await expect(page.locator(".mt-pomo-phase")).toHaveText("待开始");
    },
  );

  if (process.env.XM_MANUAL_SKIP_SCREENSHOTS !== "1")
    await check(
      "light and dark editors remain usable at full, compact and narrow widths",
      async () => {
        await expect(page.locator(".toast")).not.toBeVisible({
          timeout: 10000,
        });
        for (const theme of ["dark", "light"]) {
          await page.evaluate((theme) => {
            localStorage.setItem("xm-theme", theme);
            if (theme === "light")
              document.documentElement.dataset.theme = "light";
            else delete document.documentElement.dataset.theme;
          }, theme);
          await page.waitForTimeout(240);
          for (const [width, height] of [
            [1460, 900],
            [900, 700],
            [420, 760],
          ]) {
            await page.setViewportSize({ width, height });
            await expect(editor()).toBeVisible();
            assert.equal(
              await page.evaluate(
                () =>
                  document.documentElement.scrollWidth > window.innerWidth + 1,
              ),
              false,
              `${theme} / ${width}px must not scroll horizontally`,
            );
            const bounds = await editor().boundingBox();
            assert.ok(
              bounds.width >= 200 && bounds.height >= 180,
              `${theme} / ${width}px must retain a useful writing area`,
            );
            const file = `manual-${theme}-${width}.png`;
            if (!skipScreenshots) await page.screenshot({
              path: resolve(output, file),
              animations: "disabled",
            });
            if (!skipScreenshots) screenshots.push(file);
          }
        }
        await page.setViewportSize({ width: 1460, height: 900 });
        await page
          .getByRole("button", { name: "选择章节", exact: true })
          .click();
        const picker = page.getByRole("dialog", {
          name: "选择章节",
          exact: true,
        });
        await expect(picker).toBeVisible();
        const pickerFile = "manual-picker-light-1460.png";
        if (!skipScreenshots) await page.screenshot({
          path: resolve(output, pickerFile),
          animations: "disabled",
        });
        if (!skipScreenshots) screenshots.push(pickerFile);
        await picker.getByRole("button", { name: "取消", exact: true }).click();
        await page
          .getByRole("button", { name: "目标与设置", exact: true })
          .click();
        const settings = page.getByRole("dialog", {
          name: "码字设置",
          exact: true,
        });
        await expect(settings).toBeVisible();
        const settingsFile = "manual-settings-light-1460.png";
        if (!skipScreenshots) await page.screenshot({
          path: resolve(output, settingsFile),
          animations: "disabled",
        });
        if (!skipScreenshots) screenshots.push(settingsFile);
        await settings
          .getByRole("button", { name: "完成", exact: true })
          .click();
      },
    );

  const closeBody =
    (await editor().inputValue()) + "\n窗口关闭之前的最后一句。";
  await check(
    "native window close snapshots the latest input before shutting down",
    async () => {
      await editor().fill(closeBody);
      const closed = app.waitForEvent("close");
      await app.evaluate(({ BrowserWindow }) => {
        setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0);
      });
      await closed;
      app = null;
      await launch();
      await openManual();
      await expect(editor()).toHaveValue(closeBody);
      assert.equal(
        await readDailyWords(),
        dailyAfter + words("窗口关闭之前的最后一句。"),
      );
      assert.equal(
        (await call("book:get", { id: firstBook.id })).chapters[0].body,
        firstDraft,
        "Closing preserves the draft without silently committing it to the work",
      );
    },
  );

  await back();
  await writeFile(
    resolve(output, "manual-library-before-recovery.json"),
    await page.evaluate(() => localStorage.getItem("xm-manual-library-v2")),
  );
  await check(
    "legacy text with no trusted baseline is recovered independently from its former chapter",
    async () => {
      const text = "旧版人工码字草稿，缺少版本基线也不能丢失。";
      const title = "旧版恢复稿";
      await page.evaluate(
        ({ text, title, bookId, chapterId }) => {
          localStorage.removeItem("xm-manual-library-v2");
          localStorage.setItem(
            "xm-manual-draft",
            JSON.stringify({ bookId, chapterId, chapterTitle: title, text }),
          );
        },
        { text, title, bookId: firstBook.id, chapterId: firstChapter.id },
      );
      await page.reload();
      await openManual();
      await expect(editor()).toHaveValue(text);
      await expect(
        page.getByRole("textbox", { name: "文稿标题", exact: true }),
      ).toHaveValue(title);
      await expect(
        page.getByRole("button", { name: "存入作品", exact: true }),
      ).toBeVisible();
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const lib = JSON.parse(
              localStorage.getItem("xm-manual-library-v2"),
            );
            return lib?.drafts[lib.activeKey]?.bookId;
          }),
        )
        .toBeNull();
      const recovered = await page.evaluate(() => {
        const lib = JSON.parse(localStorage.getItem("xm-manual-library-v2"));
        return lib.drafts[lib.activeKey];
      });
      assert.equal(recovered.baseBody, "");
      assert.equal(recovered.baseTitle, "");
      assert.equal(recovered.baseRevision, null);
      assert.equal(
        (await call("book:get", { id: firstBook.id })).chapters[0].body,
        firstDraft,
      );
    },
  );

  await check(
    "a damaged v2 draft with intact text but missing baseline is salvaged as a scratch draft",
    async () => {
      await back();
      const text = "新草稿格式里的正文仍完好，缺少基线时也要保留。";
      const title = "缺少基线的恢复稿";
      await page.evaluate(
        ({ text, title, bookId, chapterId }) => {
          localStorage.removeItem("xm-manual-draft");
          localStorage.setItem(
            "xm-manual-library-v2",
            JSON.stringify({
              version: 2,
              activeKey: "chapter:damaged",
              drafts: {
                "chapter:damaged": {
                  key: "chapter:damaged",
                  text,
                  title,
                  bookId,
                  chapterId,
                },
              },
              daily: {},
            }),
          );
        },
        { text, title, bookId: firstBook.id, chapterId: firstChapter.id },
      );
      await page.reload();
      await openManual();
      await expect(editor()).toHaveValue(text);
      await expect(
        page.getByRole("textbox", { name: "文稿标题", exact: true }),
      ).toHaveValue(title);
      await expect(
        page.getByRole("button", { name: "存入作品", exact: true }),
      ).toBeVisible();
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const lib = JSON.parse(
              localStorage.getItem("xm-manual-library-v2"),
            );
            return lib?.drafts[lib.activeKey]?.baseBody;
          }),
        )
        .toBe("");
      assert.equal(
        (await call("book:get", { id: firstBook.id })).chapters[0].body,
        firstDraft,
      );
    },
  );

  await check(
    "failed local persistence retains in-memory drafts and requires a completed export before leaving",
    async () => {
      await back();
      const title = "存储失败恢复稿";
      const text = "浏览器存储失败时，这段未保存的内容不能消失。";
      await page.evaluate(
        ({ title, text }) => {
          const key = "scratch:storage-recovery";
          localStorage.setItem(
            "xm-manual-library-v2",
            JSON.stringify({
              version: 2,
              activeKey: key,
              drafts: {
                [key]: {
                  key,
                  bookId: null,
                  chapterId: null,
                  title,
                  text,
                  baseBody: "",
                  baseTitle: "",
                  baseRevision: null,
                  updatedAt: new Date().toISOString(),
                },
              },
              daily: {},
            }),
          );
        },
        { title, text },
      );
      await page.reload();
      await openManual();
      await expect(editor()).toHaveValue(text);
      await page.evaluate(() => {
        window.__manualOriginalStorageSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === "xm-manual-library-v2")
            throw new DOMException(
              "Fixture storage quota exhausted",
              "QuotaExceededError",
            );
          return window.__manualOriginalStorageSetItem.call(this, key, value);
        };
      });
      const updated = text + "\n这句话只能先留在内存中。";
      await editor().fill(updated);
      await expect(page.locator(".mt-banner")).toContainText("草稿保留失败");
      await page.getByRole("button", { name: "返回书架", exact: true }).click();
      await expect(page.locator(".toast")).toContainText("草稿保留失败");
      await expect(editor()).toHaveValue(updated);

      // Switching can retain the unsafe draft in memory while rescuing other work.
      await pick(otherBook.title, "第1章 外环港");
      const original = await editor().inputValue();
      await editor().fill(original + "\n保存到作品可以直接救回正文。");
      await page.getByRole("button", { name: "保存章节", exact: true }).click();
      await expect
        .poll(
          async () =>
            (await call("book:get", { id: otherBook.id })).chapters[0].body,
        )
        .toBe(original + "\n保存到作品可以直接救回正文。");
      await pickScratch(title);
      await expect(editor()).toHaveValue(updated);

      await app.evaluate(({ dialog }) => {
        globalThis.__manualOriginalSaveDialog = dialog.showSaveDialog;
        dialog.showSaveDialog = async () => ({
          canceled: true,
          filePath: undefined,
        });
      });
      const exportButton = page
        .getByRole("group", { name: "文稿", exact: true })
        .getByRole("button", { name: "导出 TXT", exact: true });
      await exportButton.click();
      await expect(exportButton).toBeEnabled();
      await page.getByRole("button", { name: "返回书架", exact: true }).click();
      await expect(page.locator(".toast")).toContainText("草稿保留失败");
      await expect(editor()).toHaveValue(updated);

      const file = resolve(output, "storage-recovery.txt");
      await app.evaluate(({ dialog }, file) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: file,
        });
      }, file);
      await exportButton.click();
      await expect(page.locator(".toast")).toContainText("TXT 已保存");
      assert.equal(await readFile(file, "utf8"), `${title}\n\n${updated}`);
      await back();
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = globalThis.__manualOriginalSaveDialog;
        delete globalThis.__manualOriginalSaveDialog;
      });
      await page.evaluate(() => {
        Storage.prototype.setItem = window.__manualOriginalStorageSetItem;
        delete window.__manualOriginalStorageSetItem;
      });
    },
  );

  await check(
    "the entire manual typing flow produces no renderer errors",
    async () => assert.deepEqual(pageErrors, []),
  );
  console.log(`Manual typing regression passed. ${output}`);
} catch (error) {
  if (!skipScreenshots && page && !page.isClosed())
    await page
      .screenshot({ path: resolve(output, "failure.png") })
      .catch(() => {});
  throw error;
} finally {
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(
      {
        passed:
          checks.length > 0 &&
          checks.every((check) => check.status === "passed"),
        dataDir,
        checks,
        errors: pageErrors,
        screenshots,
      },
      null,
      2,
    ),
  );
  if (app) await app.close();
}
