import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const project = resolve(".");
const root = resolve("test-results/manuscript-formatting");
await mkdir(root, { recursive: true });
const dataDir = await mkdtemp(resolve(root, "run-"));
const output = resolve(dataDir, "verification");
await mkdir(output, { recursive: true });
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
const defaults = {
  indent: 2,
  paragraphSpacing: "blank",
  autoIndent: true,
  formatAi: true,
};
const checks = [],
  errors = [],
  screenshots = [],
  requests = [];
let app, page, call, book, chapter;
const manual = () =>
  page.getByRole("textbox", { name: "码字正文", exact: true });
const workspace = () =>
  page.getByRole("textbox", { name: "章节正文", exact: true });
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const request = JSON.parse(raw);
  requests.push(request);
  const prompt = request.messages.map((m) => m.content).join("\n");
  const review = prompt.includes("分析章节中的新人");
  const content = review
    ? '{"changes":[]}'
    : " 晚风吹进书店。\r\n\r\n路灯亮了。 \n结尾。";
  const partial = prompt.includes("长度中断检查");
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: partial ? "length" : "stop" }] })}\n\n`,
  );
  res.end("data: [DONE]\n\n");
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
async function check(name, run) {
  try {
    await run();
    checks.push({ name, status: "passed" });
    console.log(`Passed: ${name}`);
  } catch (e) {
    checks.push({ name, status: "failed", error: e.stack });
    throw e;
  }
}
async function launch() {
  app = await electron.launch({ args: ["."], env });
  assert.equal(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
    dataDir,
  );
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
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
async function settings() {
  await page.getByRole("button", { name: "正文排版", exact: true }).click();
  return page.getByRole("dialog", { name: "正文排版", exact: true });
}
async function closeSettings(dialog) {
  await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
}
async function savePrefs(patch) {
  const dialog = await settings();
  if ("indent" in patch)
    await dialog
      .getByLabel("首行缩进", { exact: true })
      .selectOption(String(patch.indent));
  if ("paragraphSpacing" in patch)
    await dialog
      .getByLabel("段落间距", { exact: true })
      .selectOption(patch.paragraphSpacing);
  if ("autoIndent" in patch)
    await dialog
      .getByRole("checkbox", { name: "回车自动缩进", exact: true })
      .setChecked(patch.autoIndent);
  if ("formatAi" in patch)
    await dialog
      .getByRole("checkbox", { name: "AI 生成自动排版", exact: true })
      .setChecked(patch.formatAi);
  await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
async function pickChapter() {
  await page.getByRole("button", { name: "选择章节", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "选择章节", exact: true });
  await dialog.getByRole("button", { name: new RegExp(book.title) }).click();
  await dialog
    .locator(".mt-picker-chapters")
    .getByRole("button", { name: new RegExp(chapter.title) })
    .click();
  await expect(dialog).not.toBeVisible();
}
async function snapshot(name) {
  if (
    process.env.XM_MANUSCRIPT_SKIP_SCREENSHOTS === "1" ||
    process.argv.includes("--no-screenshots")
  )
    return;
  const path = resolve(output, name + ".png");
  await page.screenshot({ path });
  screenshots.push(path);
}
async function themeMode(value) {
  const desiredToggle = value === "dark" ? "深色模式" : "浅色模式";
  const button = page.getByRole("button", {
    name: new RegExp(`^(切换到)?${desiredToggle}$`),
  });
  if (await button.count()) await button.click();
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
async function generate(kind = "write", instruction = "") {
  const latest = (await call("book:get", { id: book.id })).chapters.find(
    (c) => c.id === chapter.id,
  );
  const started = await call("ai:generate", {
    bookId: book.id,
    chapterId: latest.id,
    kind,
    instruction,
  });
  await expect
    .poll(
      async () =>
        (await call("book:get", { id: book.id })).candidates.find(
          (j) => j.id === started.id,
        )?.status,
    )
    .not.toBe("running");
  return (await call("book:get", { id: book.id })).candidates.find(
    (j) => j.id === started.id,
  );
}

try {
  await launch();
  book = await call("book:create", { title: "正文排版回归", genre: "悬疑" });
  chapter = book.chapters[0];
  await page.reload();
  await page.getByRole("button", { name: /人工码字板/ }).click();
  await expect(manual()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "正文排版", exact: true }),
  ).toBeEnabled();

  await check(
    "first typed paragraph is indented, Enter continues and native undo restores text",
    async () => {
      await manual().focus();
      await page.keyboard.insertText("风");
      await expect(manual()).toHaveValue("　　风");
      await page.keyboard.insertText("起。");
      await manual().press("Enter");
      await expect(manual()).toHaveValue("　　风起。\n\n　　");
      assert.equal(
        await manual().evaluate((e) => e.selectionStart),
        "　　风起。\n\n　　".length,
      );
      await manual().press("Control+z");
      await expect(manual()).toHaveValue("　　风起。");
      await manual().press("Shift+Enter");
      await expect(manual()).toHaveValue("　　风起。\n");
    },
  );

  await check(
    "mid-paragraph splits and IME confirmation preserve content and cursor",
    async () => {
      await manual().fill("　　第一句。　　后句。");
      await manual().evaluate((e) => {
        e.focus();
        e.setSelectionRange(6, 6);
      });
      await manual().press("Enter");
      await expect(manual()).toHaveValue("　　第一句。\n\n　　后句。");
      const before = await manual().inputValue();
      const prevented = await manual().evaluate(
        (e) =>
          !e.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              keyCode: 229,
              isComposing: true,
              bubbles: true,
              cancelable: true,
            }),
          ),
      );
      assert.equal(prevented, false);
      await expect(manual()).toHaveValue(before);
      await manual().fill("");
      await manual().focus();
      await manual().evaluate((e) =>
        e.dispatchEvent(
          new CompositionEvent("compositionstart", { bubbles: true }),
        ),
      );
      await page.keyboard.insertText("晚风");
      await expect(manual()).toHaveValue("晚风");
      await manual().evaluate((e) =>
        e.dispatchEvent(
          new CompositionEvent("compositionend", {
            data: "晚风",
            bubbles: true,
          }),
        ),
      );
      await expect(manual()).toHaveValue("　　晚风");
    },
  );

  await check(
    "cancel leaves settings unchanged; saved compact and disabled preferences affect subsequent input only",
    async () => {
      const before = await manual().inputValue();
      let dialog = await settings();
      await dialog.getByLabel("首行缩进", { exact: true }).selectOption("0");
      await closeSettings(dialog);
      assert.deepEqual(await call("manuscript:get"), defaults);
      await expect(manual()).toHaveValue(before);
      await savePrefs({ indent: 0, paragraphSpacing: "compact" });
      await expect(manual()).toHaveValue(before);
      await manual().press("Control+End");
      await manual().press("Enter");
      await expect(manual()).toHaveValue(before + "\n");
      await savePrefs({
        indent: 2,
        paragraphSpacing: "blank",
        autoIndent: false,
      });
      await manual().fill("不自动缩进。");
      await manual().press("Enter");
      await expect(manual()).toHaveValue("不自动缩进。\n");
      await savePrefs(defaults);
    },
  );

  await check(
    "manual format persists a recovery draft and whitespace does not increase words",
    async () => {
      await pickChapter();
      const raw = "第一段。\n第二段。\n\n“对白。”";
      await manual().fill(raw);
      const dialog = await settings();
      await dialog
        .getByRole("button", { name: "整理当前正文", exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await expect(manual()).toHaveValue(
        "　　第一段。\n\n　　第二段。\n\n　　“对白。”",
      );
      assert.equal(
        (await manual().inputValue()).replace(/\s/g, "").length,
        raw.replace(/\s/g, "").length,
      );
      const local = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("xm-manual-library-v2")),
      );
      assert.ok(
        Object.values(local.drafts).some(
          (d) => d.title.includes("排版前") && d.text === raw,
        ),
      );
      await page.getByRole("button", { name: "保存章节", exact: true }).click();
      await expect(page.locator(".mt-save-status").first()).toContainText(
        "已保存到作品",
      );
      for (const theme of ["dark", "light"]) {
        await themeMode(theme);
        await snapshot(`manual-${theme}-1460`);
      }
      await page.getByRole("button", { name: "返回书架", exact: true }).click();
    },
  );

  await check(
    "workspace uses shared preferences and keeps recoverable chapter versions",
    async () => {
      await page
        .getByRole("button", { name: `继续写作：${book.title}`, exact: true })
        .click();
      await expect(workspace()).toBeVisible();
      await workspace().press("Control+End");
      const body = await workspace().inputValue();
      await workspace().press("Enter");
      await expect(workspace()).toHaveValue(body + "\n\n　　");
      await workspace().press("Control+z");
      await expect(workspace()).toHaveValue(body);
      const raw = "主工作台旧稿。\n新的段落。";
      await workspace().fill(raw);
      await page.getByRole("button", { name: "整理正文", exact: true }).click();
      await expect(workspace()).toHaveValue(
        "　　主工作台旧稿。\n\n　　新的段落。",
      );
      assert.ok(
        (await call("versions:list", { id: chapter.id })).some(
          (v) => v.body === raw,
        ),
      );
      await savePrefs({ indent: 0, paragraphSpacing: "compact" });
      const existing = await workspace().inputValue();
      await expect(workspace()).toHaveValue(existing);
      await workspace().press("Control+End");
      await workspace().press("Enter");
      await expect(workspace()).toHaveValue(existing + "\n");
      await workspace().press("Control+z");
      await savePrefs(defaults);
    },
  );

  await check(
    "settings preview and editors remain usable at desktop and compact widths in both themes",
    async () => {
      for (const theme of ["dark", "light"]) {
        await page.setViewportSize({ width: 1460, height: 900 });
        await themeMode(theme);
        for (const [width, height] of [
          [1460, 900],
          [900, 700],
        ]) {
          await page.setViewportSize({ width, height });
          await expect(
            page.getByRole("button", { name: "正文排版", exact: true }),
          ).toBeVisible();
          await snapshot(`workspace-${theme}-${width}`);
          const dialog = await settings();
          await expect(
            dialog.getByRole("button", { name: "保存设置", exact: true }),
          ).toBeVisible();
          const saveBounds = await dialog
            .getByRole("button", { name: "保存设置", exact: true })
            .boundingBox();
          assert.ok(
            saveBounds &&
              saveBounds.y >= 0 &&
              saveBounds.y + saveBounds.height <= height,
            "Settings actions remain inside the viewport without scrolling",
          );
          await expect(
            dialog.getByRole("region", { name: "排版预览", exact: true }),
          ).toBeVisible();
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 2,
            ),
            false,
          );
          await snapshot(`settings-${theme}-${width}`);
          await closeSettings(dialog);
        }
      }
      await page.setViewportSize({ width: 1460, height: 900 });
    },
  );

  await check(
    "AI generation, review and adoption share normalized prose, with partial and disabled modes",
    async () => {
      await workspace().press("Control+s");
      await expect(page.locator(".editor-status")).toContainText("已保存");
      await call("config:save", {
        provider: "api",
        model: "fixture",
        baseUrl,
        apiKey: "local-fixture-only",
        maxTokens: 4096,
        temperature: 0.8,
      });
      const job = await generate();
      assert.equal(
        job.output,
        "　　晚风吹进书店。\n\n　　路灯亮了。\n\n　　结尾。",
      );
      assert.equal(job.review.status, "empty");
      assert.ok(requests[0].messages[1].content.includes("正文排版："));
      await call("ai:adopt", { id: job.id, mode: "replace" });
      assert.equal(
        (await call("book:get", { id: book.id })).chapters[0].body,
        job.output,
      );
      await call("manuscript:set", {
        ...defaults,
        paragraphSpacing: "compact",
      });
      const continuing = await generate("continue");
      const adopted = await call("ai:adopt", {
        id: continuing.id,
        mode: "append",
      });
      assert.ok(adopted.chapters[0].body.startsWith(job.output + "\n　　晚风"));
      const interrupted = await generate("polish", "长度中断检查");
      assert.equal(interrupted.status, "interrupted");
      assert.equal(
        interrupted.output,
        "　　晚风吹进书店。\n　　路灯亮了。\n　　结尾。",
      );
      await call("manuscript:set", { ...defaults, formatAi: false });
      const disabled = await generate("write");
      assert.equal(
        disabled.output,
        " 晚风吹进书店。\r\n\r\n路灯亮了。 \n结尾。",
      );
      assert.doesNotMatch(requests.at(-2).messages[1].content, /正文排版：/);
      const plain = await call("ai:adopt", {
        id: disabled.id,
        mode: "replace",
      });
      assert.equal(plain.chapters[0].body, disabled.output);
    },
  );

  await check(
    "format preferences survive an app restart and manuscript exports retain actual indents",
    async () => {
      const prefs = { ...defaults, paragraphSpacing: "compact" };
      await call("manuscript:set", prefs);
      await app.close();
      app = null;
      await launch();
      assert.deepEqual(await call("manuscript:get"), prefs);
      await page.getByRole("button", { name: /人工码字板/ }).click();
      await pickChapter();
      await expect(manual()).toBeVisible();
      await page.getByRole("button", { name: "一键排版", exact: true }).click();
      const formatted = await manual().inputValue();
      assert.ok(formatted.startsWith("　　"));
      assert.ok(formatted.includes("\n　　"));
      const path = resolve(output, "exported.txt");
      await app.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: path,
        });
      }, path);
      await page.getByRole("button", { name: "导出 TXT", exact: true }).click();
      const exportedTitle = await page
        .getByRole("textbox", { name: "文稿标题", exact: true })
        .inputValue();
      await expect
        .poll(async () => readFile(path, "utf8").catch(() => ""))
        .toBe(`${exportedTitle}\n\n${formatted}`);
    },
  );
  assert.deepEqual(errors, []);
} catch (e) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: resolve(output, "failure.png") })
      .catch(() => {});
  throw e;
} finally {
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(
      {
        passed: checks.length > 0 && checks.every((c) => c.status === "passed"),
        dataDir,
        checks,
        errors,
        screenshots,
      },
      null,
      2,
    ),
  );
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
