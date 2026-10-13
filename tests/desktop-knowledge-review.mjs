import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
const root = resolve("test-results/knowledge-review-fixes");
await mkdir(root, { recursive: true });
const data = await mkdtemp(resolve(root, "run-")),
  out = resolve(data, "verification");
await mkdir(out);
const requests = [],
  errors = [];
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const part of req) raw += part;
  const request = JSON.parse(raw);
  requests.push(request);
  const command = request.messages.at(-1).content;
  const currentText = request.messages.find(
      (row) => row.role === "user",
    ).content,
    current = JSON.parse(currentText.slice(currentText.indexOf("{")));
  const changes =
    command === "删除世界资料"
      ? [
          {
            target: "worldRecord",
            id: current.worldRecords[0].id,
            operation: "delete",
            fields: {},
          },
        ]
      : command === "删除伏笔"
        ? [
            {
              target: "foreshadow",
              id: current.foreshadows[0].id,
              operation: "delete",
              fields: {},
            },
          ]
        : command === "部分采纳"
          ? [
              {
                target: "character",
                id: current.characters[1].id,
                operation: "update",
                fields: { role: "退休管理员" },
              },
              {
                target: "book",
                id: "",
                operation: "update",
                fields: { world: "魔法须登记" },
              },
            ]
          : command.includes("未采纳")
            ? [
                {
                  target: "book",
                  id: "",
                  operation: "update",
                  fields: { world: "魔法须登记" },
                },
              ]
            : [
                {
                  target: "character",
                  id: current.characters[0].id,
                  operation: "delete",
                  fields: {},
                },
              ];
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(
    "data: " +
      JSON.stringify({
        choices: [
          {
            delta: {
              content: JSON.stringify({ reply: "请核对修改方案。", changes }),
            },
            finish_reason: "stop",
          },
        ],
      }) +
      "\n\ndata: [DONE]\n\n",
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow();
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
  const book = await call("book:create", { title: "边界修复验证" });
  await call("book:update", {
    id: book.id,
    patch: {
      world: "原有世界规则",
      characters: [
        { id: "p1", name: "林舟", role: "调查员", description: "描述" },
        { id: "p2", name: "周伯", role: "管理员", description: "描述" },
      ],
    },
  });
  await call("config:save", {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    model: "fixture",
  });
  await page.reload();
  async function open() {
    await page.getByRole("button", { name: /继续.*边界修复验证/ }).click();
    await expect(page.locator(".workspace")).toBeVisible();
    const close = page.locator(".creation-guide-close");
    if (await close.isVisible()) await close.click();
    await page.getByRole("button", { name: "资料整理", exact: true }).click();
    await expect(
      page.getByRole("textbox", {
        name: "想查询或调整哪些资料？",
        exact: true,
      }),
    ).toBeVisible();
  }
  async function send(message) {
    const count = await page.locator(".knowledge-message.assistant").count();
    await page
      .getByRole("textbox", { name: "想查询或调整哪些资料？", exact: true })
      .fill(message);
    await page
      .getByRole("button", { name: "发送资料要求", exact: true })
      .click();
    await expect(page.locator(".knowledge-message.assistant")).toHaveCount(
      count + 1,
    );
    await expect(
      page
        .locator(".knowledge-message.assistant")
        .last()
        .locator(".knowledge-reply"),
    ).toBeVisible();
  }
  await open();
  await send("部分采纳");
  const checks = page.locator(".knowledge-change input[type=checkbox]");
  await checks.nth(1).uncheck();
  await page
    .getByRole("button", { name: "确认写入所选修改", exact: true })
    .click();
  await expect(page.locator(".knowledge-proposal")).toContainText(
    "已写入 1/2 项",
  );
  assert.equal((await call("book:get", { id: book.id })).world, "原有世界规则");
  await page.getByRole("button", { name: "返回书架", exact: true }).click();
  await open();
  await expect(checks).toHaveCount(2);
  await expect(checks.nth(0)).toBeChecked();
  await expect(checks.nth(1)).not.toBeChecked();
  await expect(page.locator(".knowledge-item-status").nth(1)).toHaveText(
    "未采纳",
  );
  await page
    .locator(".knowledge-log")
    .evaluate((el) => el.scrollTo({ top: 0 }));
  await page.screenshot({ path: resolve(out, "partial-reopened-dark.png") });
  const messages = await page.locator(".knowledge-message.assistant").count();
  await page
    .getByRole("button", { name: "重新核对未采纳项", exact: true })
    .click();
  await expect(page.locator(".knowledge-message.assistant")).toHaveCount(
    messages + 1,
  );
  await expect(
    page.getByRole("button", { name: "确认写入所选修改", exact: true }),
  ).toBeVisible();
  assert.ok(requests.at(-1).messages.at(-1).content.includes("未采纳"));
  await page
    .getByRole("button", { name: "确认写入所选修改", exact: true })
    .click();
  await expect
    .poll(async () => (await call("book:get", { id: book.id })).world)
    .toBe("魔法须登记");
  await send("删除人物");
  await page
    .getByRole("button", { name: "确认写入所选修改", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await call("trash:list")).filter((row) => row.type === "character")
          .length,
    )
    .toBe(1);
  const deleted = (await call("trash:list")).find(
    (row) => row.type === "character",
  );
  await call("book:update", { id: book.id, patch: { world: "作者后续规则" } });
  await page.getByRole("button", { name: "清空对话", exact: true }).click();
  await page
    .getByRole("dialog", { name: "清空资料对话", exact: true })
    .getByRole("button", { name: "清空对话", exact: true })
    .click();
  await expect(page.locator(".knowledge-message")).toHaveCount(0);
  await call("trash:restore", { id: deleted.id });
  let current = await call("book:get", { id: book.id });
  assert.equal(current.characters.filter((row) => row.id === "p1").length, 1);
  assert.equal(current.world, "作者后续规则");
  await call("book:update", {
    id: book.id,
    patch: {
      worldRecords: [
        {
          id: "w1",
          category: "规则",
          title: "旧世界规则",
          description: "描述",
          certainty: "fixed",
        },
      ],
      foreshadows: [
        {
          id: "f1",
          title: "旧伏笔",
          note: "说明",
          status: "open",
          plantedChapterId: "",
        },
      ],
    },
  });
  await send("删除世界资料");
  await page
    .getByRole("button", { name: "确认写入所选修改", exact: true })
    .click();
  await expect
    .poll(
      async () => (await call("book:get", { id: book.id })).worldRecords.length,
    )
    .toBe(0);
  await send("删除伏笔");
  await page
    .getByRole("button", { name: "确认写入所选修改", exact: true })
    .click();
  await expect
    .poll(
      async () => (await call("book:get", { id: book.id })).foreshadows.length,
    )
    .toBe(0);
  const file = resolve(out, "backup.json");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  await call("backup:save");
  const backup = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(backup.excludedHistory, [
    "knowledge-chat",
    "knowledge-proposal-undo",
  ]);
  await call("backup:restore");
  const copy = (await call("books:list")).find((row) => row.id !== book.id);
  assert.deepEqual(
    (await call("knowledge:get", { bookId: copy.id })).messages,
    [],
  );
  const trash = (await call("trash:list")).filter(
    (row) => row.bookId === copy.id,
  );
  for (const type of ["worldRecord", "foreshadow"]) {
    const entry = trash.find((row) => row.type === type);
    assert.ok(entry);
    await call("trash:restore", { id: entry.id });
  }
  current = await call("book:get", { id: copy.id });
  assert.equal(current.worldRecords.length, 1);
  assert.equal(current.foreshadows.length, 1);
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(out, "result.json"),
    JSON.stringify(
      {
        passed: true,
        partialCheckedAfterReopen: [true, false],
        remainingRechecked: true,
        deletedCharacterRecoveredAfterClear: true,
        customTrashRestoredFromBackup: true,
        conversationBackupExclusionExplicit: true,
      },
      null,
      2,
    ),
  );
  console.log("Knowledge review fixes passed: " + out);
} finally {
  await app.close();
  server.closeAllConnections();
  server.close();
}
