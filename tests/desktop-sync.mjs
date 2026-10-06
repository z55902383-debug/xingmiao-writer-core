import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import assert from "node:assert/strict";
let empty = false;
const body = "顾舟走进旧书店。顾舟已经失踪。";
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const data = JSON.parse(raw),
    analysis = data.messages[0].content.includes("核对小说正文");
  const text = analysis
    ? JSON.stringify({
        changes: empty
          ? []
          : [
              {
                kind: "newCharacter",
                subject: "顾舟",
                value: "来到旧书店的访客",
                role: "访客",
                evidence: "顾舟走进旧书店。",
              },
              {
                kind: "character",
                subject: "顾舟",
                attribute: "生存状态",
                value: "失踪",
                evidence: "顾舟已经失踪。",
              },
            ],
      })
    : body;
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
const dir = resolve("test-results/sync-data");
await mkdir(resolve("test-results"), { recursive: true });
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
  const b = (await call("books:list"))[0],
    book = await call("book:get", { id: b.id });
  await call("config:save", {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    model: "fixture",
    maxTokens: 4096,
    temperature: null,
  });
  await call("ai:generate", {
    bookId: b.id,
    chapterId: book.chapters[0].id,
    kind: "write",
  });
  await expect(
    page.getByRole("button", { name: "查阅变化清单", exact: true }),
  ).toBeVisible();
  assert.equal((await call("book:get", { id: b.id })).characters.length, 2);
  await page.getByRole("button", { name: "查阅变化清单", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认同步并定稿", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "暂不同步", exact: true }).click();
  await page.getByRole("button", { name: "采用结果", exact: true }).click();
  await page.getByRole("button", { name: "查阅变化清单", exact: true }).click();
  await page.getByLabel("人物描述", { exact: true }).fill("谨慎的访客");
  await page
    .getByRole("button", { name: "确认同步并定稿", exact: true })
    .click();
  await expect(
    page.getByText("本章变化已确认同步", { exact: true }),
  ).toBeVisible();
  const saved = await call("book:get", { id: b.id });
  assert.equal(
    saved.characters.find((c) => c.name === "顾舟").description,
    "谨慎的访客",
  );
  assert.ok(saved.timeline.some((e) => e.value === "失踪"));
  assert.equal(saved.chapters[0].status, "final");
  empty = true;
  await call("ai:generate", {
    bookId: b.id,
    chapterId: book.chapters[0].id,
    kind: "write",
  });
  await expect
    .poll(
      async () =>
        (await call("book:get", { id: b.id })).candidates[0].review?.status,
    )
    .toBe("empty");
  await page.reload();
  await page
    .getByRole("button", { name: "打开 雾港来信", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "查阅变化清单", exact: true }),
  ).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    "Sync desktop passed: automatic analysis, no mutation before consent, editable review, adoption prerequisite, atomic sync/finalization, no-change silence and persistence.",
  );
} finally {
  await app.close();
  server.closeAllConnections();
  server.close();
}
