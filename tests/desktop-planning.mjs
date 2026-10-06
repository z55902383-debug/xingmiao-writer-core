import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
const requests = [];
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const data = JSON.parse(raw),
    prompt = data.messages[1].content;
  requests.push(prompt);
  let text = "章节正文候选";
  if (prompt.includes("完整全书总纲"))
    text = "总纲候选：灾难、调查、反转、结局。";
  else if (prompt.includes("世界初始设定"))
    text = "世界候选：雾港被封锁，科技存在限制。";
  else if (prompt.includes("人物基础档案"))
    text = JSON.stringify({
      characters: [
        { name: "顾舟", role: "调查员", description: "谨慎而执着。" },
      ],
    });
  else if (prompt.includes("指定目标卷生成卷大纲"))
    text = "卷大纲候选：寻找旧日真相。";
  else if (prompt.includes("指定卷的大纲生成更细"))
    text = "卷细纲候选：码头、灯塔、旧仓库。";
  else if (prompt.includes("生成简明概要"))
    text = "章节概要候选：主角遇到陌生访客。";
  else if (prompt.includes("本章可执行的章节细纲"))
    text = "章节细纲候选：访客带来封锁消息。";
  else if (prompt.includes("后续世界、人物状态或关系的变化计划"))
    text = JSON.stringify({
      events: [
        {
          kind: "world",
          title: "封港计划",
          entity: "雾港",
          attribute: "交通",
          value: "客船停止航行",
          chapterId: "",
          sequence: 1,
        },
      ],
    });
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(
    "data: " +
      JSON.stringify({
        choices: [{ delta: { content: text }, finish_reason: "stop" }],
      }) +
      "\n\ndata: [DONE]\n\n",
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const output = resolve("test-results"),
  dir = resolve(output, "planning-data");
await mkdir(output, { recursive: true });
await rm(dir, { recursive: true, force: true });
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
const app = await electron.launch({ args: ["."], env });
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
  await page.getByRole("button", { name: "打开示例体验" }).click();
  const guideClose = page.locator(".creation-guide-close");
  if (await guideClose.isVisible().catch(() => false)) await guideClose.click();
  const b = (await call("books:list"))[0];
  await call("config:save", {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    model: "fixture",
    name: "测试模型",
    maxTokens: 4096,
    temperature: null,
  });
  await page.getByRole("button", { name: "返回书架" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "打开 雾港来信", exact: true })
    .click();
  await page.getByRole("tab", { name: "功能", exact: true }).click();
  const before = await call("book:get", { id: b.id });
  async function generate(button, label) {
    await button.click();
    await expect(page.locator(".candidate")).toContainText(label);
    await expect(
      page
        .locator(".candidate")
        .getByRole("button", { name: "采用结果", exact: true }),
    ).toBeEnabled();
    await page
      .locator(".candidate")
      .getByRole("button", { name: "采用结果", exact: true })
      .click();
    await expect(
      page
        .locator(".candidate")
        .getByRole("button", { name: "已采用", exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "故事大纲", exact: true }).click();
  await expect(
    page
      .locator(".assistant-panel")
      .getByRole("button", { name: "生成全书总纲", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await generate(
    page
      .locator(".document-page")
      .getByRole("button", { name: "生成全书总纲", exact: true }),
    "总纲候选",
  );
  assert.match((await call("book:get", { id: b.id })).outline, /总纲候选/);
  await page.getByRole("tab", { name: "分卷章节", exact: true }).click();
  await page.getByRole("button", { name: "新建分卷", exact: true }).click();
  await page.getByLabel("卷名", { exact: true }).fill("第一卷");
  await page.getByRole("button", { name: "保存分卷", exact: true }).click();
  await generate(
    page
      .locator(".volume-block")
      .first()
      .getByRole("button", { name: "生成卷大纲", exact: true }),
    "卷大纲候选",
  );
  await generate(
    page
      .locator(".volume-block")
      .first()
      .getByRole("button", { name: "生成卷细纲", exact: true }),
    "卷细纲候选",
  );
  await generate(
    page
      .locator(".volume-chapter")
      .first()
      .getByRole("button", { name: /生成章节概要/ }),
    "章节概要候选",
  );
  await generate(
    page
      .locator(".volume-chapter")
      .first()
      .getByRole("button", { name: /生成本章细纲/ }),
    "章节细纲候选",
  );
  await page.screenshot({ path: resolve(output, "v031-generation.png") });
  await page.getByRole("button", { name: "世界设定", exact: true }).click();
  await expect(
    page
      .locator(".assistant-panel")
      .getByRole("button", { name: "生成世界设定", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await generate(
    page
      .locator(".document-page")
      .getByRole("button", { name: "生成世界设定", exact: true }),
    "世界候选",
  );
  await page.getByRole("button", { name: "人物档案", exact: true }).click();
  await generate(
    page
      .locator(".document-page")
      .getByRole("button", { name: "AI 生成人物档案", exact: true }),
    "顾舟",
  );
  await page
    .getByRole("button", { name: "关系与记忆", exact: false })
    .first()
    .click();
  await page.getByRole("tab", { name: "变化时间线", exact: true }).click();
  await generate(
    page
      .locator(".document-page")
      .getByRole("button", { name: "生成变化计划", exact: true }),
    "封港计划",
  );
  const after = await call("book:get", { id: b.id });
  assert.equal(after.chapters[0].body, before.chapters[0].body);
  assert.equal(after.characters.length, before.characters.length + 1);
  assert.equal(after.timeline[0].phase, "planned");
  assert.match(after.volumes[0].outline, /卷大纲候选/);
  assert.match(after.volumes[0].detail, /卷细纲候选/);
  assert.match(after.chapters[0].summary, /章节概要候选/);
  assert.deepEqual(errors, []);
  assert.equal(requests.length, 8);
  console.log(
    "Planning UI passed: eight contextual generation routes, previews, adoption destinations and unchanged body.",
  );
} finally {
  await app.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
