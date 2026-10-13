import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
const root = resolve("test-results/knowledge-assistant");
await mkdir(root, { recursive: true });
const data = await mkdtemp(resolve(root, "run-")),
  shots = resolve(data, "verification");
await mkdir(shots);
const requests = [],
  errors = [];
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const part of req) raw += part;
  const value = JSON.parse(raw);
  requests.push(value);
  const instruction = value.messages.at(-1).content;
  const first = value.messages.find((row) => row.role === "user").content;
  const snapshot = JSON.parse(first.slice(first.indexOf("{")));
  const reply =
    instruction === "调整世界规则"
      ? {
          reply: "建议调整世界规则。",
          changes: [
            {
              target: "book",
              id: "",
              operation: "update",
              fields: { world: "雨港只允许登记后的魔法" },
            },
          ],
        }
      : instruction === "修改管理员身份"
        ? {
            reply: "建议把周伯的公开身份改为退休管理员，其他人物资料保持原样。",
            changes: [
              {
                target: "character",
                id: snapshot.characters.find((row) => row.name === "周伯").id,
                operation: "update",
                fields: { role: "退休管理员" },
              },
            ],
          }
        : { reply: "林舟信任周伯，周伯保管书店钥匙。", changes: [] };
  if (instruction === "慢速请求") await new Promise((r) => setTimeout(r, 1200));
  if (res.destroyed) return;
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(
    "data: " +
      JSON.stringify({
        choices: [
          { delta: { content: JSON.stringify(reply) }, finish_reason: "stop" },
        ],
      }) +
      "\n\ndata: [DONE]\n\n",
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
let app = await electron.launch({ args: ["."], env });
try {
  let page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1464, height: 900 });
  const call = (action, data = {}) =>
    page.evaluate(
      async ({ action, data }) => {
        const r = await window.xingmiao.invoke(action, data);
        if (!r.ok) throw Error(r.error);
        return r.data;
      },
      { action, data },
    );
  await expect(
    page.getByRole("heading", { name: "我的书架", exact: true }),
  ).toBeVisible();
  let book = await call("book:create", { title: "资料对话专项" });
  await call("book:update", {
    id: book.id,
    patch: {
      outline: "原有故事大纲",
      world: "雨港禁止魔法",
      style: "STYLE-PRIVATE",
      reference: "REFERENCE-PRIVATE",
      characters: [
        { id: "p1", name: "林舟", role: "调查员", description: "寻找父亲" },
        { id: "p2", name: "周伯", role: "管理员", description: "保管钥匙" },
      ],
    },
  });
  await call("chapter:save", {
    id: book.chapters[0].id,
    revision: book.chapters[0].revision,
    patch: { body: "CHAPTER-BODY-PRIVATE", outline: "CHAPTER-OUTLINE-PRIVATE" },
  });
  await call("memory:add", {
    bookId: book.id,
    memory: { subject: "林舟", relation: "信任", object: "周伯" },
  });
  await call("config:save", {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    model: "fixture",
    name: "专项模型",
  });
  await page.reload();
  await page.getByRole("button", { name: /继续.*资料对话专项/ }).click();
  await expect(page.locator(".workspace")).toBeVisible();
  const close = page.locator(".creation-guide-close");
  if (await close.isVisible()) await close.click();
  await page.locator("#instruction").fill("保留原有写作要求");
  await page.getByRole("button", { name: "资料整理", exact: true }).click();
  const input = page.getByRole("textbox", {
    name: "想查询或调整哪些资料？",
    exact: true,
  });
  await expect(input).toBeVisible();
  await expect(page.locator("#instruction")).not.toBeVisible();
  await page.screenshot({ path: resolve(shots, "empty-dark.png") });
  async function send(message) {
    await input.fill(message);
    await page
      .getByRole("button", { name: "发送资料要求", exact: true })
      .click();
    await expect(
      page.locator(".knowledge-message").last().locator(".knowledge-reply"),
    ).toBeVisible();
  }
  await send("列出现有关系");
  await expect(page.locator(".knowledge-reply").last()).toContainText(
    "林舟信任周伯",
  );
  assert.equal(
    (await call("book:get", { id: book.id })).characters[1].role,
    "管理员",
  );
  const prompt = JSON.stringify(requests[0].messages);
  for (const marker of [
    "CHAPTER-BODY-PRIVATE",
    "CHAPTER-OUTLINE-PRIVATE",
    "STYLE-PRIVATE",
    "REFERENCE-PRIVATE",
  ])
    assert.ok(!prompt.includes(marker));
  await send("修改管理员身份");
  await expect(
    page.getByRole("button", { name: "确认写入所选修改", exact: true }),
  ).toBeVisible();
  assert.equal(
    (await call("book:get", { id: book.id })).characters[1].role,
    "管理员",
  );
  await page.locator(".knowledge-change-detail > summary").last().click();
  await expect(page.locator(".knowledge-field-diff").last()).toContainText(
    "退休管理员",
  );
  await page.screenshot({ path: resolve(shots, "proposal-dark.png") });
  await page.locator(".assistant-panel").screenshot({ path: resolve(shots, "proposal-panel-dark.png") });
  await page
    .getByRole("button", { name: "确认写入所选修改", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "撤销这次修改", exact: true }),
  ).toBeVisible();
  assert.equal(
    (await call("book:get", { id: book.id })).characters[1].role,
    "退休管理员",
  );
  await page.getByRole("tab", { name: "功能", exact: true }).click();
  await page.getByRole("button", { name: "人物档案", exact: true }).click();
  await expect(
    page
      .locator(".character-card")
      .filter({
        has: page.getByRole("heading", { name: "周伯", exact: true }),
      }),
  ).toContainText("退休管理员");
  await page.getByRole("button", { name: "撤销这次修改", exact: true }).click();
  await expect(
    page
      .locator(".character-card")
      .filter({
        has: page.getByRole("heading", { name: "周伯", exact: true }),
      }),
  ).toContainText("管理员");
  assert.equal(
    (await call("book:get", { id: book.id })).characters[1].role,
    "管理员",
  );
  await send("调整世界规则");
  await call("book:update", {
    id: book.id,
    patch: { world: "作者已手动修改世界" },
  });
  await page
    .getByRole("button", { name: "确认写入所选修改", exact: true })
    .click();
  await expect(page.locator(".knowledge-composer .error-box")).toContainText(
    "资料已变化",
  );
  assert.equal(
    (await call("book:get", { id: book.id })).world,
    "作者已手动修改世界",
  );
  await input.fill("慢速请求");
  await page.getByRole("button", { name: "发送资料要求", exact: true }).click();
  await expect(
    page
      .locator(".knowledge-composer")
      .getByRole("button", { name: "停止", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "写作生成", exact: true }).click();
  await expect(page.locator("#instruction")).toHaveValue("保留原有写作要求");
  await expect
    .poll(
      async () =>
        (await call("knowledge:get", { bookId: book.id })).messages.at(-1)
          .status,
    )
    .toBe("cancelled");
  await page.getByRole("button", { name: "资料整理", exact: true }).click();
  await expect(
    page.locator(".knowledge-message.assistant .knowledge-reply").first(),
  ).toContainText("林舟信任周伯");
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    for (const size of [
      { width: 1464, height: 900 },
      { width: 1024, height: 700 },
    ]) {
      await page.setViewportSize(size);
      const open = page.getByRole("button", {
        name: "打开写作助手",
        exact: true,
      });
      if (await open.isVisible()) await open.click();
      await expect(input).toBeVisible();
      await expect(
        page.getByRole("button", { name: "发送资料要求", exact: true }),
      ).toBeVisible();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: resolve(shots, `knowledge-${theme}-${size.width}.png`),
      });
    }
  }
  const chapters = (await call("book:get", { id: book.id })).chapters;
  assert.equal(chapters[0].body, "CHAPTER-BODY-PRIVATE");
  assert.equal(chapters[0].outline, "CHAPTER-OUTLINE-PRIVATE");
  await app.close();
  app = await electron.launch({ args: ["."], env });
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(
    page.getByRole("heading", { name: "我的书架", exact: true }),
  ).toBeVisible();
  const restored = await call("knowledge:get", { bookId: book.id });
  assert.equal(
    restored.messages[1].content,
    "林舟信任周伯，周伯保管书店钥匙。",
  );
  const other = await call("book:create", { title: "隔离作品" });
  assert.deepEqual(
    (await call("knowledge:get", { bookId: other.id })).messages,
    [],
  );
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(shots, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        checks: [
          "scope excludes chapters/styles",
          "query only",
          "review before apply",
          "live character refresh",
          "undo",
          "conflict protection",
          "switch cancellation",
          "retained writing input",
          "themes and compact sizes",
          "restart persistence",
          "book isolation",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Knowledge assistant desktop passed: " + shots);
} finally {
  await app.close();
  server.closeAllConnections();
  server.close();
}
