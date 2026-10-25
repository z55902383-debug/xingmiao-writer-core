import { _electron as electron, expect } from "@playwright/test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const output = resolve("test-results/memo-library");
await mkdir(output, { recursive: true });
const data = await mkdtemp(resolve(output, "run-"));
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow(),
    errors = [];
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
  await expect(
    page.getByRole("heading", { name: "我的书架", exact: true }),
  ).toBeVisible();
  const book = await call("book:create", { title: "备忘录大量资料测试" }),
    other = await call("book:create", { title: "其他作品资料" }),
    now = new Date().toISOString();
  const memos = Array.from({ length: 120 }, (_, i) => ({
    id: "memo-" + i,
    title: "资料 " + String(i).padStart(3, "0"),
    category: i % 2 ? "人物" : "世界观",
    content:
      "资料正文-" +
      String(i).padStart(3, "0") +
      "\n" +
      "长篇设定，需要完整保存。\n".repeat(360),
    createdAt: now,
    updatedAt: now,
  }));
  await call("book:update", { id: book.id, patch: { memos } });
  await call("book:update", {
    id: other.id,
    patch: {
      memos: [
        {
          ...memos[0],
          id: "other",
          title: "另一部作品的资料",
          content: "跨书原文",
        },
      ],
    },
  });
  await page.reload();
  await page
    .locator(".book-card")
    .filter({ hasText: book.title })
    .getByRole("button")
    .first()
    .click();
  const guide = page.locator(".creation-guide-close");
  if (await guide.isVisible().catch(() => false)) await guide.click();
  await page.locator(".workspace-memo-trigger").click();
  const drawer = page.locator(".memo-drawer");
  await expect(drawer.locator(".memo-browser-item")).toHaveCount(120);
  const dimensions = await drawer.evaluate((el) => {
    const list = el.querySelector(".memo-browser-items"),
      body = el.querySelector("textarea");
    return {
      width: el.clientWidth,
      list: list.clientHeight,
      editor: body.clientHeight,
      overflow: list.scrollHeight > list.clientHeight,
    };
  });
  assert.ok(dimensions.width > 700);
  assert.ok(dimensions.editor > 300);
  assert.ok(dimensions.overflow);
  await drawer
    .getByRole("textbox", { name: "搜索备忘录", exact: true })
    .fill("正文-099");
  await expect(drawer.locator(".memo-browser-item")).toHaveCount(1);
  await drawer.getByRole("button", { name: "清除搜索", exact: true }).click();
  await drawer.getByLabel("筛选备忘录分类").selectOption("人物");
  await expect(drawer.locator(".memo-browser-item")).toHaveCount(60);
  await drawer.getByLabel("备忘录排序").selectOption("title");
  await drawer.locator(".memo-browser-item").first().click();
  await drawer
    .getByRole("textbox", { name: "备忘录标题", exact: true })
    .fill("标题已修改仍在编辑");
  await expect(
    drawer.getByRole("textbox", { name: "备忘录标题", exact: true }),
  ).toHaveValue("标题已修改仍在编辑");
  const area = drawer.getByRole("textbox", {
    name: "备忘录内容，可粘贴生成结果",
    exact: true,
  });
  await area.fill("选中片段\n保留完整内容");
  await area.press("Control+Home");
  await area.press("Shift+End");
  await drawer
    .getByRole("button", { name: "复制选中文字", exact: true })
    .click();
  assert.equal(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    "选中片段",
  );
  await drawer.getByLabel("筛选备忘录分类").selectOption("");
  await page.screenshot({
    path: resolve(output, "drawer-dark.png"),
    animations: "disabled",
  });
  await page.locator("#memo-book-select").selectOption(other.id);
  await expect(area).toHaveValue("跨书原文");
  await area.fill("跨书编辑已保存");
  await page.locator("#memo-book-select").selectOption(book.id);
  assert.equal(
    (await call("book:get", { id: other.id })).memos[0].content,
    "跨书编辑已保存",
  );
  await page
    .locator(".memo-drawer-header")
    .getByRole("button", { name: "关闭备忘录", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await call("book:get", { id: book.id })).memos.find(
          (m) => m.id === "memo-1",
        ).content,
    )
    .toBe("选中片段\n保留完整内容");
  await page.getByRole("tab", { name: "功能", exact: true }).click();
  await page
    .locator(".workspace-sidebar")
    .getByRole("button", { name: "备忘录", exact: true })
    .click();
  await page
    .locator(".module-page-head")
    .getByRole("button", { name: "新建备忘录", exact: true })
    .click();
  await expect(
    page
      .locator(".memo-page")
      .getByRole("textbox", { name: "备忘录标题", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(output, "page-dark.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1000, height: 680 });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.locator(".workspace-memo-trigger").click();
  await drawer.getByRole("button", { name: "展开备忘录", exact: true }).click();
  await expect(drawer).toHaveClass(/is-wide/);
  await page.screenshot({
    path: resolve(output, "drawer-light-wide.png"),
    animations: "disabled",
  });
  assert.ok(await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth));
  assert.deepEqual(errors, []);
  console.log(
    "120 notes + long content verified: independent scrolling, content search, category, sorting, stable editing, selected copy, cross-book save, new note on narrow page, expanded/light layout.",
  );
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
