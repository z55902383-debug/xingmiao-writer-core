import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Exercise the real renderer and Store with an isolated profile. This script
// never opens, resets or deletes the author's library and never requests AI.
const project = resolve(".");
const root = resolve("test-results/manual-followup");
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
let app;
let page;
let call;
const editor = () => page.getByRole("textbox", { name: "码字正文", exact: true });
const title = () => page.getByRole("textbox", { name: "文稿标题", exact: true });

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

async function theme(value) {
  await page.evaluate((value) => {
    localStorage.setItem("xm-theme", value);
    if (value === "light") document.documentElement.dataset.theme = value;
    else delete document.documentElement.dataset.theme;
  }, value);
}

async function openManual() {
  await page.getByRole("button", { name: /人工码字板/ }).click();
  await expect(editor()).toBeVisible();
}

async function back() {
  await page.getByRole("button", { name: "返回书架", exact: true }).click();
  await expect(editor()).not.toBeVisible();
}

async function pick(bookTitle, chapterTitle) {
  await page.getByRole("button", { name: "选择章节", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "选择章节", exact: true });
  await dialog.getByRole("button", { name: new RegExp(bookTitle) }).click();
  await dialog.locator(".mt-picker-chapters").getByRole("button", { name: new RegExp(chapterTitle) }).click();
  await expect(dialog).not.toBeVisible();
}

async function manager() {
  await page.getByRole("button", { name: "临时稿管理", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "临时稿管理", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeDialog(dialog) {
  await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

async function sources() {
  await page.getByRole("button", { name: "稿件与历史", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "稿件与历史", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function currentChapter(bookId, chapterId) {
  return (await call("book:get", { id: bookId })).chapters.find((chapter) => chapter.id === chapterId);
}

async function candidateAdopted(chapterId, jobId) {
  const jobs = await call("manual:chapter-sources", { chapterId });
  const candidate = jobs.find((job) => job.id === jobId);
  assert.ok(candidate, "The chapter-scoped source API must retain older generated drafts");
  return candidate.adopted;
}

async function snapshot(file) {
  if (process.env.XM_MANUAL_SKIP_SCREENSHOTS === "1") return;
  await expect(page.locator(".toast")).not.toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: resolve(output, file), animations: "disabled" });
  screenshots.push(file);
}

try {
  await launch();
  const book = await call("book:create", { title: "人工码字功能回归", genre: "悬疑" });
  const historyBody = "旧稿：钟声响起时，林晚还在书店等雨停。";
  const originalBody = "现稿：林晚关上书店的门。\n\n街角的路灯亮了起来。";
  let chapter = await call("chapter:save", {
    id: book.chapters[0].id,
    revision: book.chapters[0].revision,
    patch: { title: "第1章 雨夜书店", body: historyBody },
  });
  chapter = await call("chapter:save", { id: chapter.id, revision: chapter.revision, patch: { body: originalBody } });
  const versions = await call("versions:list", { id: chapter.id });
  const oldVersion = versions.find((version) => version.body === historyBody);
  assert.ok(oldVersion, "The real chapter history must contain the previous body");
  const generatedBody = "候选稿：雨停了，林晚看见门口多出一封没有署名的信。\n\n信封边缘沾着新鲜的泥。";
  const jobId = "manual-followup-generated-fixture";
  await app.evaluate(async ({ app }, input) => {
    const mainRequire = process.mainModule.require.bind(process.mainModule);
    const { createRequire } = mainRequire("node:module");
    const { join } = mainRequire("node:path");
    const require = createRequire(join(input.project, "package.json"));
    const { Store } = require(join(input.project, "electron", "store.cjs"));
    const db = new Store(join(app.getPath("userData"), "xingmiao.sqlite"));
    try {
      const job = {
        id: input.jobId, bookId: input.bookId, chapterId: input.chapterId,
        kind: "write", instruction: "隔离回归候选稿", output: input.body,
        status: "done", error: "", adopted: false,
        createdAt: new Date().toISOString(), baseRevision: input.revision,
        model: "Fixture", provider: "api", profileName: "Local fixture",
        context: { messages: [], tokens: 0 },
      };
      db.putJob(job);
      db.putJob({ ...job, id: `${input.jobId}-running`, status: "running", output: "未完成的流式结果不能当成完稿载入。" });
      db.putJob({ ...job, id: `${input.jobId}-outline`, kind: "outline", output: "剧情大纲不能混入正文稿件。" });
      // The general book view only retains the latest 40 candidates. Older
      // chapter text must still be available through the dedicated source API.
      for (let index = 0; index < 45; index++) db.putJob({
        ...job, id: `${input.jobId}-overflow-${index}`, kind: "outline",
        output: `较新的规划记录 ${index}，不属于正文稿件。`,
        createdAt: new Date(Date.now() + index + 1).toISOString(),
      });
    } finally { db.close(); }
  }, { project, jobId, bookId: book.id, chapterId: chapter.id, revision: chapter.revision, body: generatedBody });
  await page.reload();

  await check("only the current shelf navigation is highlighted in light and dark themes", async () => {
    for (const value of ["dark", "light"]) {
      await theme(value);
      const nav = page.locator(".shelf-nav .typing-nav-item");
      await expect(nav).not.toHaveClass(/\bactive\b/);
      assert.equal(await nav.getAttribute("aria-current"), null);
      await expect(page.locator('.shelf-nav [aria-current="page"]')).toHaveCount(1);
      await expect(page.locator('.shelf-nav [aria-current="page"]')).toContainText("我的书架");
      const style = await page.evaluate(() => {
        const typing = getComputedStyle(document.querySelector(".shelf-nav .typing-nav-item"));
        const neutral = getComputedStyle(document.querySelector(".shelf-nav .nav-item:not(.active):not(.typing-nav-item)"));
        return { typingBg: typing.backgroundColor, neutralBg: neutral.backgroundColor, typingColor: typing.color, neutralColor: neutral.color };
      });
      assert.equal(style.typingBg, style.neutralBg, `${value}: inactive navigation backgrounds must match`);
      assert.equal(style.typingColor, style.neutralColor, `${value}: inactive navigation text colors must match`);
    }
    await theme("dark");
  });

  await openManual();
  await pick(book.title, chapter.title);
  await check("existing saved chapter text loads with accurate word count and without mutating the work", async () => {
    await expect(editor()).toHaveValue(originalBody);
    assert.equal((await currentChapter(book.id, chapter.id)).body, originalBody);
    await expect(page.locator(".mt-root")).toContainText(/本次净增\s*\+?0/);
  });

  const scratchTitle = "码字板独立临时稿";
  const renamedTitle = "修改后的临时稿名称";
  const scratchBody = "临时稿正文：船长把航海图铺在灯下。";
  await check("blank temporary drafts can be found, continued and renamed without losing text", async () => {
    await page.getByRole("button", { name: "新建临时稿", exact: true }).click();
    await expect(editor()).toHaveValue("");
    await pick(book.title, chapter.title);
    let dialog = await manager();
    const blankRow = dialog.locator(".mt-draft-row").filter({ has: page.getByRole("button", { name: /未命名临时稿/ }) }).first();
    await expect(blankRow).toBeVisible();
    await blankRow.getByRole("button", { name: /未命名临时稿/ }).click();
    await expect(dialog).not.toBeVisible();
    await title().fill(scratchTitle);
    await editor().fill(scratchBody);
    await pick(book.title, chapter.title);
    dialog = await manager();
    const row = dialog.locator(".mt-draft-row").filter({ hasText: scratchTitle });
    await row.getByRole("button", { name: "重命名", exact: true }).click();
    await dialog.getByRole("textbox", { name: "临时稿名称", exact: true }).fill(renamedTitle);
    await dialog.getByRole("button", { name: "确认重命名", exact: true }).click();
    await expect(row).not.toBeVisible();
    await dialog.locator(".mt-draft-row").filter({ hasText: renamedTitle }).getByRole("button", { name: new RegExp(renamedTitle) }).click();
    await expect(editor()).toHaveValue(scratchBody);
    await expect(title()).toHaveValue(renamedTitle);
    assert.equal((await currentChapter(book.id, chapter.id)).body, originalBody);
  });

  await check("deleting a temporary draft moves it to recoverable trash and restoring retains its content", async () => {
    // Make a retained chapter draft newer than every scratch draft. Deleting
    // the active scratch must still choose another scratch, never this chapter.
    const retainedChapter = originalBody + "\n仍未保存的章节草稿。";
    await pick(book.title, chapter.title);
    await editor().fill(retainedChapter);
    let dialog = await manager();
    await dialog.locator(".mt-draft-row").filter({ hasText: renamedTitle }).getByRole("button", { name: new RegExp(renamedTitle) }).click();
    await expect(editor()).toHaveValue(scratchBody);
    dialog = await manager();
    await snapshot("manual-draft-manager-dark-1460.png");
    await dialog.locator(".mt-draft-row").filter({ hasText: renamedTitle }).getByRole("button", { name: "删除", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "删除临时稿？", exact: true });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "移入回收站", exact: true }).click();
    await expect(confirm).not.toBeVisible();
    dialog = page.getByRole("dialog", { name: "临时稿管理", exact: true });
    await expect(dialog.locator(".mt-draft-row").filter({ hasText: renamedTitle })).toHaveCount(0);
    await closeDialog(dialog);
    await expect(page.getByRole("button", { name: "存入作品", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "保存章节", exact: true })).not.toBeVisible();
    await expect(editor()).toHaveValue("");
    const kept = await page.evaluate((id) => JSON.parse(localStorage.getItem("xm-manual-library-v2")).drafts[`chapter:${id}`], chapter.id);
    assert.equal(kept.text, retainedChapter);
    assert.equal((await currentChapter(book.id, chapter.id)).body, originalBody);
    dialog = await manager();
    await dialog.getByRole("tab", { name: /^回收站/ }).click();
    const trashed = dialog.locator(".mt-draft-row").filter({ hasText: renamedTitle });
    await expect(trashed).toBeVisible();
    await trashed.getByRole("button", { name: "恢复", exact: true }).click();
    await dialog.getByRole("tab", { name: /^临时稿/ }).click();
    await dialog.locator(".mt-draft-row").filter({ hasText: renamedTitle }).getByRole("button", { name: new RegExp(renamedTitle) }).click();
    await expect(editor()).toHaveValue(scratchBody);
    await expect(title()).toHaveValue(renamedTitle);
    await back();
    await page.reload();
    await openManual();
    await expect(editor()).toHaveValue(scratchBody);
  });

  await check("the manager can create an editable blank temporary draft", async () => {
    const dialog = await manager();
    await dialog.getByRole("button", { name: "新建临时稿", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(editor()).toHaveValue("");
    await title().fill("由管理页创建");
    await editor().fill("新临时稿可以立即编辑。");
    await pick(book.title, chapter.title);
  });

  const priorDirty = originalBody + "\n这句是载入生成稿前的手动修改。";
  await check("loading a generated body stages a chapter draft, retains previous edits and does not adopt or commit", async () => {
    await editor().fill(priorDirty);
    const dialog = await sources();
    await dialog.getByRole("tab", { name: /^生成稿/ }).click();
    await expect(dialog.locator(".mt-source-row")).toHaveCount(1);
    await dialog.locator(`.mt-source-row[data-source-id="${jobId}"]`).click();
    await expect(dialog.getByRole("textbox", { name: "稿件正文预览", exact: true })).toHaveValue(generatedBody);
    await snapshot("manual-generated-source-dark-1460.png");
    await dialog.getByRole("button", { name: "载入当前章节草稿", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(editor()).toHaveValue(generatedBody);
    assert.equal((await currentChapter(book.id, chapter.id)).body, originalBody);
    assert.equal(await candidateAdopted(chapter.id, jobId), false);
    const drafts = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("xm-manual-library-v2")).drafts));
    assert.ok(drafts.some((draft) => !draft.bookId && draft.text === priorDirty), "Replacing a dirty draft must preserve a separate scratch copy");
    await page.getByRole("button", { name: "保存章节", exact: true }).click();
    await expect.poll(async () => (await currentChapter(book.id, chapter.id)).body).toBe(generatedBody);
    assert.equal(await candidateAdopted(chapter.id, jobId), false);
  });

  await check("generated text can be saved as a scratch draft without changing chapter text", async () => {
    const dialog = await sources();
    await dialog.getByRole("tab", { name: /^生成稿/ }).click();
    await dialog.locator(`.mt-source-row[data-source-id="${jobId}"]`).click();
    await dialog.getByRole("button", { name: "另存临时稿", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(editor()).toHaveValue(generatedBody);
    await expect(page.getByRole("button", { name: "存入作品", exact: true })).toBeVisible();
    assert.equal((await currentChapter(book.id, chapter.id)).body, generatedBody);
    await pick(book.title, chapter.title);
  });

  await check("a history version is staged in the editor and written to the story only after save", async () => {
    const dialog = await sources();
    await dialog.getByRole("tab", { name: /^历史版本/ }).click();
    await dialog.locator(`.mt-source-row[data-source-id="${oldVersion.id}"]`).click();
    await expect(dialog.getByRole("textbox", { name: "稿件正文预览", exact: true })).toHaveValue(historyBody);
    await snapshot("manual-history-source-dark-1460.png");
    await dialog.getByRole("button", { name: "载入当前章节草稿", exact: true }).click();
    await expect(editor()).toHaveValue(historyBody);
    assert.equal((await currentChapter(book.id, chapter.id)).body, generatedBody);
    await page.getByRole("button", { name: "保存章节", exact: true }).click();
    await expect.poll(async () => (await currentChapter(book.id, chapter.id)).body).toBe(historyBody);
  });

  const cleanExternal = "同步后的正文：林晚把那封信锁进抽屉。";
  const dirtyLocal = cleanExternal + "\n作者还未保存的本机修改。";
  const dirtyExternal = "另一窗口修改的正文：抽屉里只剩一张空白纸。";
  await check("focus synchronizes clean external edits while retaining dirty drafts with an explicit conflict", async () => {
    let latest = await currentChapter(book.id, chapter.id);
    await call("chapter:save", { id: latest.id, revision: latest.revision, patch: { body: cleanExternal } });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(editor()).toHaveValue(cleanExternal);
    await editor().fill(dirtyLocal);
    latest = await currentChapter(book.id, chapter.id);
    await call("chapter:save", { id: latest.id, revision: latest.revision, patch: { body: dirtyExternal } });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator(".mt-root").getByRole("alert").filter({ hasText: /变化|修改|冲突|更新/ })).toBeVisible();
    await expect(editor()).toHaveValue(dirtyLocal);
    assert.equal((await currentChapter(book.id, chapter.id)).body, dirtyExternal);
    await page.getByRole("button", { name: "重新载入作品", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "重新载入作品？", exact: true });
    await confirm.getByRole("button", { name: "保留副本并载入", exact: true }).click();
    await expect(editor()).toHaveValue(dirtyExternal);
  });

  await check("clearing a nonempty chapter requires confirmation and cancel keeps the saved body", async () => {
    await editor().fill("");
    await page.getByRole("button", { name: "保存章节", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "确认清空章节？", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal((await currentChapter(book.id, chapter.id)).body, dirtyExternal);
    await expect(editor()).toHaveValue("");
    await editor().fill(dirtyExternal);
  });

  await check("find and replace supports stepping, replacing one or all matches and undo", async () => {
    await page.getByRole("button", { name: "新建临时稿", exact: true }).click();
    await title().fill("查找替换检查稿");
    const text = "猫在窗边。\n猫在门边。\n猫在桌边。";
    await editor().fill(text);
    await page.getByRole("button", { name: "查找替换", exact: true }).click();
    await page.getByRole("textbox", { name: "查找内容", exact: true }).fill("猫");
    await page.getByRole("textbox", { name: "替换为", exact: true }).fill("星喵");
    await page.getByRole("button", { name: "下一个匹配", exact: true }).click();
    await expect.poll(() => editor().evaluate((element) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe("猫");
    // A manual text selection can differ from the find panel's last index.
    // Replace current must honor the selected second match.
    await editor().evaluate((element) => {
      const second = element.value.indexOf("猫", 1);
      element.focus();
      element.setSelectionRange(second, second + 1);
    });
    await page.getByRole("button", { name: "替换当前", exact: true }).click();
    const once = await editor().inputValue();
    assert.equal(once, "猫在窗边。\n星喵在门边。\n猫在桌边。");
    assert.equal((once.match(/星喵/g) || []).length, 1);
    assert.equal((once.match(/猫/g) || []).length, 2);
    await page.getByRole("button", { name: "全部替换", exact: true }).click();
    await expect(editor()).toHaveValue(text.replaceAll("猫", "星喵"));
    await page.getByRole("button", { name: "撤销替换", exact: true }).click();
    await expect(editor()).toHaveValue(once);
    await snapshot("manual-find-replace-dark-1460.png");
    assert.equal((await currentChapter(book.id, chapter.id)).body, dirtyExternal);
  });

  await check("paragraph formatting preserves all content and keeps a recoverable copy of the original draft", async () => {
    const raw = "第一段没有缩进。\n第二段还没换行。\n\n“这里是对白。”";
    await editor().fill(raw);
    await page.getByRole("button", { name: "一键排版", exact: true }).click();
    await expect(editor()).toHaveValue("　　第一段没有缩进。\n\n　　第二段还没换行。\n\n　　“这里是对白。”");
    const drafts = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("xm-manual-library-v2")).drafts));
    assert.ok(drafts.some((draft) => !draft.bookId && draft.title.includes("排版前") && draft.text === raw));
    assert.equal((await currentChapter(book.id, chapter.id)).body, dirtyExternal);
  });

  await check("desktop and compact editors preserve usable controls and avoid horizontal overflow", async () => {
    await page.getByRole("button", { name: "查找替换", exact: true }).click();
    for (const value of ["dark", "light"]) {
      await theme(value);
      for (const [width, height] of [[1460, 900], [900, 700]]) {
        await page.setViewportSize({ width, height });
        await expect(editor()).toBeVisible();
        await expect(page.getByRole("button", { name: "临时稿管理", exact: true })).toBeVisible();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `${value}/${width} must not overflow horizontally`);
        const bounds = await editor().boundingBox();
        assert.ok(bounds.width >= 300 && bounds.height >= 180, `${value}/${width} must retain a useful writing area`);
        await snapshot(`manual-followup-${value}-${width}.png`);
      }
    }
    await page.setViewportSize({ width: 1460, height: 900 });
  });

  await check("the new draft controls translate to English while manuscript text and names are preserved", async () => {
    const before = await editor().inputValue();
    await back();
    await page.evaluate(() => localStorage.setItem("xm-language", "en"));
    await page.reload();
    await page.getByRole("button", { name: /Writing pad/ }).click();
    await expect(page.locator(".mt-document-title")).toHaveValue("查找替换检查稿");
    await expect(page.getByRole("textbox", { name: "Writing pad text", exact: true })).toHaveValue(before);
    await page.getByRole("button", { name: "Manage scratch drafts", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Manage scratch drafts", exact: true });
    await expect(dialog.getByRole("tab", { name: "Scratch drafts", exact: true })).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "Trash", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "查找替换检查稿", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "New scratch draft", exact: true })).toBeVisible();
  });

  await check("the new flows produce no renderer exceptions", async () => assert.deepEqual(pageErrors, []));
  console.log(`Manual follow-up regression passed. ${output}`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await writeFile(resolve(output, "report.json"), JSON.stringify({
    passed: checks.length > 0 && checks.every((check) => check.status === "passed"),
    dataDir, checks, errors: pageErrors, screenshots,
  }, null, 2));
  if (app) await app.close();
}
