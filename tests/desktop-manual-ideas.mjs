import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// All library writes and AI calls use an isolated profile and localhost fixture.
const root = resolve("test-results/manual-ideas");
await mkdir(root, { recursive: true });
const dataDir = await mkdtemp(resolve(root, "run-"));
const output = resolve(dataDir, "verification");
await mkdir(output, { recursive: true });
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;

const checks = [],
  errors = [],
  screenshots = [],
  requests = [],
  layoutBounds = [];
const skipScreenshots =
  process.argv.includes("--no-screenshots") ||
  process.env.XM_MANUAL_IDEAS_SKIP_SCREENSHOTS === "1";
const reply =
  "方向一：失踪的雨伞是秘密传递的信物。\n\n方向二：借用失物招领的热梗，让两位陌生人交换各自的秘密。\n\n请先选择喜欢的方向，再由作者写入正文。";
const cancelledReply = "取消前收到的一条构思。";
let app, page, call, books, chapter;
const editor = () =>
  page.getByRole("textbox", { name: "码字正文", exact: true });
const memoPanel = () =>
  page.getByRole("complementary", { name: "作品备忘录", exact: true });
const ideaPanel = () =>
  page.getByRole("complementary", { name: "灵感助手", exact: true });

const server = createServer(async (req, res) => {
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const value = JSON.parse(raw);
    requests.push(value);
    const prompt = value.messages.map((message) => message.content).join("\n");
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (content, finish) =>
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content }, ...(finish ? { finish_reason: finish } : {}) }] })}\n\n`,
      );
    if (prompt.includes("取消灵感回归")) {
      send(cancelledReply);
      return;
    }
    send(reply.slice(0, 23));
    setTimeout(() => {
      if (res.destroyed) return;
      send(reply.slice(23), "stop");
      res.end("data: [DONE]\n\n");
    }, 120);
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

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
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1460, height: 900 });
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

async function seed() {
  books = [];
  for (const [title, memoTitle, content] of [
    ["灵感回归甲书", "甲书雨伞线索", "甲书专属线索：红色雨伞在书店门口消失。"],
    ["灵感回归乙书", "乙书星图线索", "乙书专属线索：深空星图藏在机械鸟体内。"],
  ]) {
    let book = await call("book:create", { title, genre: "悬疑" });
    const now = new Date().toISOString();
    book = await call("book:update", {
      id: book.id,
      patch: {
        memos: [
          {
            id: `memo-${books.length}`,
            title: memoTitle,
            content,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    });
    books.push(book);
  }
  chapter = await call("chapter:save", {
    id: books[0].chapters[0].id,
    revision: books[0].chapters[0].revision,
    patch: {
      title: "第1章 雨夜书店",
      body: "　　林晚关上书店的门。\n\n　　街角的路灯亮了。",
    },
  });
  await call("config:save", {
    provider: "api",
    model: "ideas-fixture",
    baseUrl,
    apiKey: "local-fixture-only",
    maxTokens: 4096,
    temperature: 0.8,
  });
  await page.reload();
}

async function openManual({ panels = true } = {}) {
  await page.getByRole("button", { name: /人工码字板/ }).click();
  await expect(editor()).toBeVisible();
  if (panels) {
    const views = page.getByRole("group", { name: "视图", exact: true });
    if (!(await ideaPanel().isVisible())) {
      await views.getByRole("button", { name: "灵感助手", exact: true }).click();
    }
    if (!(await memoPanel().isVisible())) {
      await views.getByRole("button", { name: "备忘录", exact: true }).click();
    }
  }
}

async function back() {
  await page.getByRole("button", { name: "返回书架", exact: true }).click();
  await expect(editor()).not.toBeVisible();
}

async function pickChapter() {
  await page.getByRole("button", { name: "选择章节", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "选择章节", exact: true });
  await dialog
    .getByRole("button", { name: new RegExp(books[0].title) })
    .click();
  await dialog
    .locator(".mt-picker-chapters")
    .getByRole("button", { name: new RegExp(chapter.title) })
    .click();
  await expect(dialog).not.toBeVisible();
}

async function memos(bookId) {
  return (await call("book:get", { id: bookId })).memos || [];
}

async function bookContent(bookId) {
  const book = await call("book:get", { id: bookId });
  return {
    chapters: book.chapters.map(({ id, title, body, revision }) => ({
      id,
      title,
      body,
      revision,
    })),
    candidates: book.candidates,
    writingActivity: book.writingActivity || [],
  };
}

function requestSources(request) {
  const source = request.messages
    .flatMap((message) => message.content.split("\n"))
    .find((line) => line.startsWith("{") && line.endsWith("}"));
  assert.ok(
    source,
    "The fixture request must contain its explicit source selection",
  );
  return JSON.parse(source);
}

async function snapshot(file) {
  if (skipScreenshots) return;
  const toast = page.locator(".toast");
  if (await toast.isVisible())
    await toast.getByRole("button", { name: "关闭提示", exact: true }).click();
  await expect(toast).not.toBeVisible();
  await page.screenshot({
    path: resolve(output, file),
    animations: "disabled",
  });
  screenshots.push(file);
}

async function assertInsideWritingArea(control, label, theme) {
  const area = await page.locator(".mt-writing-layout").boundingBox();
  const element = await control.boundingBox();
  const measured = { label, theme, area, element };
  layoutBounds.push(measured);
  assert.ok(
    area &&
      element &&
      element.y >= area.y - 1 &&
      element.y + element.height <= area.y + area.height + 1,
    `The ${label} must be fully visible inside the writing area: ${JSON.stringify(measured)}`,
  );
}

async function theme(value) {
  const toggle = page.getByRole("button", {
    name: value === "light" ? "浅色模式" : "深色模式",
    exact: true,
  });
  if (await toggle.count()) await toggle.click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.dataset.theme === "light" ? "light" : "dark",
      ),
    )
    .toBe(value);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.dataset.themeReveal || ""),
    )
    .toBe("");
}

try {
  await launch();
  await seed();
  await openManual();
  await pickChapter();

  await check(
    "memo reference and inspiration stay beside the manuscript and expose grouped toolbar actions",
    async () => {
      await expect(memoPanel()).toBeVisible();
      await expect(ideaPanel()).toBeVisible();
      for (const name of ["文稿", "编辑", "视图", "专注"]) {
        await expect(
          page.getByRole("group", { name, exact: true }),
        ).toBeVisible();
      }
      await expect(
        memoPanel().getByRole("textbox", { name: "备忘录内容", exact: true }),
      ).toHaveValue(/甲书专属线索/);
      await expect(editor()).toHaveValue(chapter.body);
    },
  );

  await check(
    "memo creation, title and content edits are persisted to the selected story without touching prose",
    async () => {
      const before = await bookContent(books[0].id);
      await memoPanel()
        .getByRole("button", { name: "新建备忘录", exact: true })
        .click();
      await memoPanel()
        .getByRole("textbox", { name: "备忘录标题", exact: true })
        .fill("甲书临时线索");
      await memoPanel()
        .getByRole("textbox", { name: "备忘录内容", exact: true })
        .fill("甲书新建灵感：店主每天给不存在的客人留灯。");
      await memoPanel()
        .getByRole("textbox", { name: "备忘录内容", exact: true })
        .press("Control+s");
      await expect
        .poll(async () =>
          (await memos(books[0].id)).some(
            (memo) =>
              memo.title === "甲书临时线索" &&
              memo.content.includes("不存在的客人"),
          ),
        )
        .toBe(true);
      await expect(memoPanel()).toContainText("备忘录已同步到作品");
      assert.deepEqual(await bookContent(books[0].id), before);
      assert.equal((await memos(books[1].id)).length, 1);
    },
  );

  await check(
    "memo search and book switching cannot mix two stories or discard the pending edit",
    async () => {
      await memoPanel().getByLabel("搜索备忘录", { exact: true }).fill("雨伞");
      await expect(memoPanel()).toContainText("甲书雨伞线索");
      await expect(memoPanel()).not.toContainText("乙书星图线索");
      await memoPanel()
        .getByLabel("搜索备忘录", { exact: true })
        .fill("没有这条线索");
      await expect(memoPanel()).toContainText("没有找到匹配的备忘录。");
      await memoPanel().getByLabel("搜索备忘录", { exact: true }).fill("");
      await memoPanel()
        .getByLabel("选择作品", { exact: true })
        .selectOption(books[1].id);
      await expect(
        memoPanel().getByRole("textbox", { name: "备忘录内容", exact: true }),
      ).toHaveValue(/乙书专属线索/);
      await memoPanel()
        .getByRole("textbox", { name: "备忘录内容", exact: true })
        .fill("乙书专属线索：星图新增一个坐标。");
      await memoPanel()
        .getByLabel("选择作品", { exact: true })
        .selectOption(books[0].id);
      await expect
        .poll(async () => (await memos(books[1].id))[0].content)
        .toBe("乙书专属线索：星图新增一个坐标。");
      await expect(editor()).toHaveValue(chapter.body);
    },
  );

  await check(
    "inspiration uses only the selected memo and author inputs, creates no prose candidate and can be saved as a memo",
    async () => {
      await memoPanel()
        .getByRole("button", { name: /甲书雨伞线索/ })
        .click();
      await expect(ideaPanel()).toContainText("甲书雨伞线索");
      await ideaPanel()
        .getByRole("textbox", { name: "创意构思", exact: true })
        .fill("围绕雨伞失踪给出三条悬疑方向，不要写正文。");
      await ideaPanel()
        .getByRole("textbox", { name: "热梗或关键词", exact: true })
        .fill("失物招领、命运交换");
      const before = await bookContent(books[0].id);
      const beforeDraft = await editor().inputValue();
      const beforeStats = await page.locator(".mt-footer-center").textContent();
      const beforeRequests = requests.length;
      await ideaPanel()
        .getByRole("button", { name: "开始构思", exact: true })
        .click();
      await expect(ideaPanel()).toContainText(reply);
      assert.equal(requests.length, beforeRequests + 1);
      const prompt = requests
        .at(-1)
        .messages.map((message) => message.content)
        .join("\n");
      assert.match(prompt, /红色雨伞/);
      assert.match(prompt, /围绕雨伞失踪/);
      assert.match(prompt, /失物招领、命运交换/);
      assert.doesNotMatch(prompt, /乙书专属线索|机械鸟/);
      assert.deepEqual(
        requestSources(requests.at(-1)).memos.map((memo) => memo.id),
        ["memo-0"],
      );
      assert.deepEqual(await bookContent(books[0].id), before);
      await expect(editor()).toHaveValue(beforeDraft);
      await expect(page.locator(".mt-footer-center")).toHaveText(beforeStats);
      const previousMemos = await memos(books[0].id);
      await ideaPanel()
        .getByRole("button", { name: "另存为备忘录", exact: true })
        .click();
      await expect
        .poll(async () => (await memos(books[0].id)).length)
        .toBe(previousMemos.length + 1);
      assert.ok(
        (await memos(books[0].id)).some((memo) => memo.content === reply),
      );
      assert.equal((await memos(books[1].id)).length, 1);
      assert.deepEqual(await bookContent(books[0].id), before);
    },
  );

  await check(
    "the reference toggle excludes the memo and meme mode uses the author's inputs",
    async () => {
      const reference = ideaPanel().getByRole("checkbox", {
        name: "参考备忘录",
        exact: true,
      });
      await expect(reference).toBeChecked();
      await reference.uncheck();
      await ideaPanel()
        .getByLabel("发散方式", { exact: true })
        .selectOption("trend");
      await ideaPanel()
        .getByRole("textbox", { name: "创意构思", exact: true })
        .fill("无参考备忘录的原创构思回归");
      const beforeRequests = requests.length;
      await ideaPanel()
        .getByRole("button", { name: "开始构思", exact: true })
        .click();
      await expect.poll(() => requests.length).toBe(beforeRequests + 1);
      await expect(
        ideaPanel().getByRole("button", { name: "开始构思", exact: true }),
      ).toBeEnabled();
      const source = requestSources(requests.at(-1));
      assert.deepEqual(source.memos, []);
      assert.equal(source.idea, "无参考备忘录的原创构思回归");
      assert.equal(source.trend, "失物招领、命运交换");
      assert.match(
        requests.at(-1).messages[1].content,
        /本次讨论方式：转化热梗/,
      );
      await ideaPanel()
        .getByLabel("发散方式", { exact: true })
        .selectOption("brainstorm");
      await reference.check();
    },
  );

  await check(
    "inspiration cancellation restores controls and leaves prose and candidate history untouched",
    async () => {
      await ideaPanel()
        .getByRole("textbox", { name: "创意构思", exact: true })
        .fill("取消灵感回归");
      const before = await bookContent(books[0].id);
      await ideaPanel()
        .getByRole("button", { name: "开始构思", exact: true })
        .click();
      await expect(ideaPanel()).toContainText(cancelledReply);
      await ideaPanel()
        .getByRole("button", { name: "停止构思", exact: true })
        .click();
      await expect(
        ideaPanel().getByRole("button", { name: "开始构思", exact: true }),
      ).toBeEnabled();
      assert.deepEqual(await bookContent(books[0].id), before);
      await expect(editor()).toHaveValue(chapter.body);
    },
  );

  await check(
    "each story keeps its own conversation and sends only that story's selected memo",
    async () => {
      const before = await bookContent(books[1].id);
      await memoPanel()
        .getByLabel("选择作品", { exact: true })
        .selectOption(books[1].id);
      await expect(ideaPanel()).toContainText(books[1].title);
      await expect(ideaPanel()).not.toContainText("取消灵感回归");
      await expect(
        ideaPanel().getByRole("textbox", { name: "热梗或关键词", exact: true }),
      ).toHaveValue("");
      await ideaPanel()
        .getByRole("textbox", { name: "创意构思", exact: true })
        .fill("乙书构思回归");
      const beforeRequests = requests.length;
      await ideaPanel()
        .getByRole("button", { name: "开始构思", exact: true })
        .click();
      await expect.poll(() => requests.length).toBe(beforeRequests + 1);
      await expect(
        ideaPanel().getByRole("button", { name: "开始构思", exact: true }),
      ).toBeEnabled();
      const source = requestSources(requests.at(-1));
      assert.equal(source.book.id, books[1].id);
      assert.deepEqual(
        source.memos.map((memo) => memo.id),
        ["memo-1"],
      );
      assert.deepEqual(source.history, []);
      assert.deepEqual(await bookContent(books[1].id), before);
      await expect(editor()).toHaveValue(chapter.body);
      await memoPanel()
        .getByLabel("选择作品", { exact: true })
        .selectOption(books[0].id);
      await expect(
        ideaPanel().getByRole("log", { name: "灵感对话", exact: true }),
      ).toContainText(cancelledReply);
      await expect(
        ideaPanel().getByRole("log", { name: "灵感对话", exact: true }),
      ).not.toContainText("乙书构思回归");
    },
  );

  await check(
    "manual memo edits appear in the Workspace memo module and return to the writing pad",
    async () => {
      await back();
      await page
        .getByRole("button", {
          name: `继续写作：${books[0].title}`,
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("textbox", { name: "章节正文", exact: true }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "功能", exact: true }).click();
      await page.getByRole("button", { name: "备忘录", exact: true }).click();
      await page.getByRole("button", { name: /甲书临时线索/ }).click();
      await expect(
        page.getByRole("textbox", { name: "备忘录内容", exact: true }),
      ).toHaveValue(/不存在的客人/);
      await page
        .getByRole("textbox", { name: "备忘录内容", exact: true })
        .fill("从主工作台修改的共用备忘录。");
      await expect
        .poll(
          async () =>
            (await memos(books[0].id)).find(
              (memo) => memo.title === "甲书临时线索",
            )?.content,
        )
        .toBe("从主工作台修改的共用备忘录。");
      await page.getByRole("button", { name: "返回书架", exact: true }).click();
      await openManual();
      await memoPanel()
        .getByRole("button", { name: /甲书临时线索/ })
        .click();
      await expect(
        memoPanel().getByRole("textbox", { name: "备忘录内容", exact: true }),
      ).toHaveValue("从主工作台修改的共用备忘录。");
    },
  );

  await check(
    "memo deletion requires confirmation and affects only the selected memo in its story",
    async () => {
      const first = await memos(books[0].id);
      const second = await memos(books[1].id);
      await memoPanel()
        .getByRole("button", { name: /甲书临时线索/ })
        .click();
      await memoPanel()
        .getByRole("button", { name: "删除备忘录", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "删除这条备忘录？",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      assert.deepEqual(await memos(books[0].id), first);
      await memoPanel()
        .getByRole("button", { name: "删除备忘录", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "确认删除备忘录", exact: true })
        .click();
      await expect
        .poll(async () => (await memos(books[0].id)).length)
        .toBe(first.length - 1);
      assert.deepEqual(await memos(books[1].id), second);
    },
  );

  await check(
    "external memo edits preserve the local draft and save-as-new recovers it without overwriting the source",
    async () => {
      await memoPanel().locator('[data-memo-id="memo-0"]').click();
      const before = await bookContent(books[0].id);
      const beforeSecondBook = await memos(books[1].id);
      const beforeNotes = await memos(books[0].id);
      const original = beforeNotes.find((memo) => memo.id === "memo-0");
      assert.ok(original);
      const localTitle = "甲书冲突恢复灵感";
      const localBody = "本机尚未提交的灵感：店主把红色雨伞留给未来的自己。";
      const externalBody = "另一个编辑窗口保存的新内容：线索改为蓝色雨伞。";
      const beforeStats = await page.locator(".mt-footer-center").textContent();
      await memoPanel()
        .getByRole("textbox", { name: "备忘录标题", exact: true })
        .fill(localTitle);
      await memoPanel()
        .getByRole("textbox", { name: "备忘录内容", exact: true })
        .fill(localBody);
      // Save the other editor's version immediately, before the 650 ms local autosave.
      const external = await call("memo:save", {
        bookId: books[0].id,
        id: original.id,
        title: original.title,
        content: externalBody,
        baseUpdatedAt: original.updatedAt,
      });
      assert.notEqual(external.updatedAt, original.updatedAt);
      await expect(memoPanel().getByRole("alert")).toContainText(
        "这条备忘录已在其他地方修改，当前编辑仍保留。",
      );
      await expect(
        memoPanel().getByRole("textbox", { name: "备忘录标题", exact: true }),
      ).toHaveValue(localTitle);
      await expect(
        memoPanel().getByRole("textbox", { name: "备忘录内容", exact: true }),
      ).toHaveValue(localBody);
      assert.equal(
        (await memos(books[0].id)).find((memo) => memo.id === original.id)
          ?.content,
        externalBody,
      );
      await memoPanel()
        .getByRole("button", { name: "另存为新备忘录", exact: true })
        .click();
      await expect
        .poll(async () => (await memos(books[0].id)).length)
        .toBe(beforeNotes.length + 1);
      const recovered = await memos(books[0].id);
      assert.ok(
        recovered.some(
          (memo) =>
            memo.id !== original.id &&
            memo.title === localTitle &&
            memo.content === localBody,
        ),
      );
      assert.equal(
        recovered.find((memo) => memo.id === original.id)?.content,
        externalBody,
      );
      await expect(
        memoPanel().getByRole("textbox", { name: "备忘录内容", exact: true }),
      ).toHaveValue(localBody);
      await expect(memoPanel().getByRole("alert")).not.toBeVisible();
      await expect(page.locator(".mt-footer-center")).toHaveText(beforeStats);
      await expect(editor()).toHaveValue(chapter.body);
      assert.deepEqual(await bookContent(books[0].id), before);
      assert.deepEqual(await memos(books[1].id), beforeSecondBook);
    },
  );

  await check(
    "reference and inspiration panels fit both themes and compact layouts",
    async () => {
      for (const mode of ["dark", "light"]) {
        await back();
        await page.setViewportSize({ width: 1460, height: 900 });
        await openManual();
        await theme(mode);
        await expect(memoPanel()).toBeVisible();
        await expect(ideaPanel()).toBeVisible();
        await snapshot(`manual-ideas-${mode}-1460.png`);
        await back();
        await page.setViewportSize({ width: 900, height: 700 });
        await openManual({ panels: false });
        if (await memoPanel().isVisible()) {
          await memoPanel().getByRole("button", { name: "收起备忘录", exact: true }).click();
        }
        if (await ideaPanel().isVisible()) {
          await ideaPanel().getByRole("button", { name: "收起灵感助手", exact: true }).click();
        }
        await expect(editor()).toBeVisible();
        await expect(memoPanel()).not.toBeVisible();
        await expect(ideaPanel()).not.toBeVisible();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 2,
          ),
          false,
        );
        await snapshot(`manual-folded-${mode}-900.png`);
        await page
          .getByRole("group", { name: "视图", exact: true })
          .getByRole("button", { name: "备忘录", exact: true })
          .click();
        await expect(memoPanel()).toBeVisible();
        await expect(ideaPanel()).not.toBeVisible();
        await expect(editor()).toBeVisible();
        await snapshot(`manual-notes-${mode}-900.png`);
        await assertInsideWritingArea(
          memoPanel().getByRole("textbox", { name: "备忘录内容", exact: true }),
          "memo text area",
          mode,
        );
        await assertInsideWritingArea(
          memoPanel().getByRole("button", { name: "保存备忘录", exact: true }),
          "save note button",
          mode,
        );
        await memoPanel()
          .getByRole("button", { name: "收起备忘录", exact: true })
          .click();
        await page
          .getByRole("group", { name: "视图", exact: true })
          .getByRole("button", { name: "灵感助手", exact: true })
          .click();
        await expect(ideaPanel()).toBeVisible();
        await expect(memoPanel()).not.toBeVisible();
        await expect(editor()).toBeVisible();
        await snapshot(`manual-assistant-${mode}-900.png`);
        await assertInsideWritingArea(
          ideaPanel().getByRole("button", { name: "开始构思", exact: true }),
          "brainstorm submit button",
          mode,
        );
        const composer = await ideaPanel()
          .locator(".mt-idea-composer")
          .evaluate((element) => ({
            scrollTop: element.scrollTop,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
          }));
        layoutBounds.push({ label: "idea composer", theme: mode, ...composer });
        assert.equal(
          composer.scrollTop,
          0,
          `The composer must not have been scrolled: ${JSON.stringify(composer)}`,
        );
        assert.ok(
          composer.scrollHeight <= composer.clientHeight + 1,
          `The submit action must require no composer scrolling: ${JSON.stringify(composer)}`,
        );
        await ideaPanel()
          .getByRole("button", { name: "收起灵感助手", exact: true })
          .click();
      }
    },
  );

  await check("memo content survives an isolated app restart", async () => {
    const before = await Promise.all(books.map((book) => memos(book.id)));
    await app.close();
    app = null;
    await launch();
    assert.deepEqual(
      await Promise.all(books.map((book) => memos(book.id))),
      before,
    );
    await openManual();
    await expect(editor()).toHaveValue(chapter.body);
  });
  assert.deepEqual(errors, []);
} catch (error) {
  if (!skipScreenshots && !screenshots.length && page && !page.isClosed())
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
        errors,
        screenshots,
        layoutBounds,
        requests: requests.map((request) => ({
          model: request.model,
          stream: request.stream,
          messages: request.messages,
        })),
      },
      null,
      2,
    ),
  );
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
