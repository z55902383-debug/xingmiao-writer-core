import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve("test-results");
await mkdir(output, { recursive: true });
const dataPath = resolve(output, "ai-desktop-data");
await rm(dataPath, { recursive: true, force: true });
const requests = [];
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const value = JSON.parse(raw);
  requests.push(value);
  const prompt = value.messages.map((m) => m.content).join("\n");
  let text = "林晚把钥匙交给陈默。\n\n陈默望向窗外，雨停了。";
  if (prompt.includes("请回复：连接成功")) text = "连接成功";
  else if (prompt.includes("从本章正文抽取"))
    text = JSON.stringify({
      memories: [
        {
          subject: "林晚",
          relation: "将钥匙交给",
          object: "陈默",
          evidence: "林晚把钥匙交给陈默。",
        },
      ],
    });
  else if (prompt.includes("分析参考文章的叙事视角"))
    text =
      "叙事视角：第三人称限知。\n对白短促，用动作呈现心理。\n章节末尾保留具体悬念。";
  else if (prompt.includes("核对本章与资料"))
    text = "待确认：核对钥匙交接的时间。";
  res.writeHead(200, { "content-type": "text/event-stream" });
  if (prompt.includes("中断测试")) {
    res.write(
      "data: " +
        JSON.stringify({
          choices: [{ delta: { content: "这是一段中断后应保留的文本。" } }],
        }) +
        "\n\n",
    );
    return;
  }
  const send = () => {
    res.write(
      "data: " +
        JSON.stringify({
          choices: [{ delta: { content: text }, finish_reason: "stop" }],
          usage: { total_tokens: 88 },
        }) +
        "\n\n",
    );
    res.end("data: [DONE]\n\n");
  };
  if (prompt.includes("冲突测试")) setTimeout(send, 1200);
  else setTimeout(send, 180);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: dataPath };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
let app = await electron.launch({ args: ["."], env });
try {
  let page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = (action, data = {}) =>
    page.evaluate(
      async ({ action, data }) => {
        const r = await window.xingmiao.invoke(action, data);
        if (!r.ok) throw new Error(r.error);
        return r.data;
      },
      { action, data },
    );
  await page.getByRole("button", { name: "创建第一部作品" }).click();
  await page.getByLabel("书名 *", { exact: true }).fill("集成测试作品");
  await page.getByRole("button", { name: "创建作品", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "章节正文" })).toBeVisible();
  await page.getByRole("button", { name: "模型与设置", exact: true }).click();
  await page.getByLabel("接口地址", { exact: true }).fill(baseUrl);
  await page
    .getByLabel("模型名称", { exact: true })
    .fill("local-fixture-model");
  await page
    .getByLabel("API 密钥", { exact: true })
    .fill("fixture-only-not-a-real-key");
  await page.getByRole("button", { name: "保存并测试连接" }).click();
  await expect(page.getByText("连接成功 · 连接成功")).toBeVisible();
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  const cfg = await call("config:get");
  expect(cfg.hasKey).toBe(true);
  expect(cfg.encryptedKey).toBeUndefined();
  await page.getByRole("button", { name: "展开本章细纲" }).click();
  await page
    .getByRole("textbox", { name: "本章细纲" })
    .fill("林晚把钥匙交给陈默，雨停了。");
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  await expect(page.locator(".candidate-text")).toContainText(
    "林晚把钥匙交给陈默。",
  );
  await page.getByRole("button", { name: "采用结果", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "章节正文" })).toHaveValue(
    /陈默望向窗外/,
  );
  await page.getByRole("button", { name: "本章定稿", exact: true }).click();
  // 任务改为按意图分组：先选分组页签，再点具体任务
  await page.getByRole("tab", { name: "故事检查", exact: true }).click();
  await page.getByRole("button", { name: "提取本章记忆", exact: true }).click();
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  await expect(page.locator(".candidate-facts")).toContainText("将钥匙交给");
  await page.getByRole("button", { name: "确认记忆", exact: true }).click();
  await page.getByRole("tab", { name: "功能" }).click();
  await page.getByRole("button", { name: /关系与记忆/ }).click();
  await expect(
    page.locator(".memory-list").getByText("林晚把钥匙交给陈默。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "章节" }).click();
  await page.getByRole("button", { name: "添加新章节" }).click();
  await page.getByRole("tab", { name: "创作正文", exact: true }).click();
  await page.getByRole("button", { name: "按大纲写正文", exact: true }).click();
  await page.getByLabel("补充创作要求", { exact: true }).fill("冲突测试");
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  await page
    .getByRole("textbox", { name: "章节正文" })
    .fill("作者手动修改，不能被覆盖。");
  await expect(
    page.getByRole("button", { name: "采用结果", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "采用结果", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("原文已修改");
  await expect(page.getByRole("textbox", { name: "章节正文" })).toHaveValue(
    "作者手动修改，不能被覆盖。",
  );
  expect(requests.at(-1).messages[1].content).toContain("将钥匙交给");
  await page.getByLabel("补充创作要求", { exact: true }).fill("中断测试");
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  await expect(page.locator(".candidate-text")).toContainText("中断后应保留");
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(page.locator(".candidate-state-panel")).toContainText("已停止生成");
  await page.getByRole("tab", { name: "功能" }).click();
  await page.getByRole("button", { name: "风格档案", exact: true }).click();
  const referencePath = resolve(output, "reference.txt");
  await writeFile(
    referencePath,
    "雨落在屋檐上。他没有抬头。\n“你还是来了。”她说。",
    "utf8",
  );
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, referencePath);
  await page.getByRole("button", { name: "导入文章", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "reference.txt" }),
  ).toBeVisible();
  await page.getByLabel("补充创作要求", { exact: true }).fill("");
  await page
    .getByRole("button", { name: "用 AI 分析写法", exact: true })
    .click();
  await expect(page.locator(".candidate-text")).toContainText("第三人称限知");
  await page.getByRole("button", { name: "采用结果", exact: true }).click();
  await expect(
    page.getByLabel("写作方法与语言偏好", { exact: true }),
  ).toHaveValue(/对白短促/);
  const exportPath = resolve(output, "export.md");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, exportPath);
  await page.getByRole("button", { name: "导出作品", exact: true }).click();
  await expect
    .poll(async () => {
      try {
        return await readFile(exportPath, "utf8");
      } catch {
        return "";
      }
    })
    .toContain("作者手动修改");
  await page.getByRole("button", { name: "返回书架" }).click();
  const backupPath = resolve(output, "backup.json");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, backupPath);
  await page.getByRole("button", { name: "备份作品", exact: true }).click();
  await expect
    .poll(async () => {
      try {
        return JSON.parse(await readFile(backupPath, "utf8")).format;
      } catch {
        return "";
      }
    })
    .toBe("xingmiao-backup");
  const backup = await readFile(backupPath, "utf8");
  expect(backup).not.toContain("fixture-only-not-a-real-key");
  expect(backup).not.toContain("encryptedKey");
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, backupPath);
  await page.getByRole("button", { name: "恢复备份", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "打开 集成测试作品（恢复）",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "打开 集成测试作品（恢复）", exact: true })
    .click();
  await page.getByRole("tab", { name: "功能" }).click();
  await page.getByRole("button", { name: /关系与记忆/ }).click();
  await expect(
    page.locator(".memory-list").getByText("林晚把钥匙交给陈默。", { exact: true }),
  ).toBeVisible();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1040, 760),
  );
  await page.screenshot({ path: resolve(output, "06-compact-window.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (errors.length) throw new Error(errors.join("\n"));
  await page.getByRole("button", { name: "返回书架" }).click();
  await app.close();
  app = await electron.launch({ args: ["."], env });
  page = await app.firstWindow();
  await expect(
    page.getByRole("button", { name: "打开 集成测试作品", exact: true }),
  ).toBeVisible();
  const restoredConfig = await call("config:get");
  expect(restoredConfig.hasKey).toBe(true);
  await page
    .getByRole("button", { name: "打开 集成测试作品", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "章节正文" })
    .fill("关闭窗口前的最后一笔，必须保存。");
  const closed = app.waitForEvent("close");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  await closed;
  app = await electron.launch({ args: ["."], env });
  page = await app.firstWindow();
  await page
    .getByRole("button", { name: "打开 集成测试作品", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "章节正文" })).toHaveValue(
    "关闭窗口前的最后一笔，必须保存。",
  );
  console.log(
    "Desktop integration passed: new book, encrypted config, connection test, streaming generation, adoption, finalization, sourced memories, write conflict, cancellation, reference import, style analysis, export, backup, restore, compact layout, restart persistence.",
  );
} finally {
  await app.close();
  server.closeAllConnections();
  server.close();
}
