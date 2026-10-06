import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
const dir = resolve("test-results/atlas-data");
await mkdir(resolve("test-results"), { recursive: true });
await rm(dir, { recursive: true, force: true });
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: dir };
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
  await page.getByRole("button", { name: "打开示例体验" }).click();
  await page.getByRole("tab", { name: "功能" }).click();
  const guideClose = page.locator(".creation-guide-close");
  if (await guideClose.isVisible().catch(() => false)) await guideClose.click();
  const b = (await call("books:list"))[0];
  let book = await call("book:get", { id: b.id });
  await page.getByRole("button", { name: "人物档案", exact: true }).click();
  await page.getByRole("tab", { name: "关系与变化" }).click();
  await expect(page.locator(".cytoscape-canvas canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "点选连线", exact: true }).click();
  const tap = async (index) => {
    const point = await page.locator(".cytoscape-canvas").evaluate((el, i) => {
      const p = el._cyreg.cy.nodes()[i].renderedPosition();
      const r = el.getBoundingClientRect();
      return { x: p.x + r.x, y: p.y + r.y };
    }, index);
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    await page.mouse.click(point.x, point.y);
  };
  await page.locator(".cytoscape-canvas").scrollIntoViewIfNeeded();
  await tap(0);
  await expect(page.locator(".graph-help")).toContainText("再点击");
  await tap(1);
  await page
    .getByRole("button", { name: "设置后续变化 / 时间（可选）", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "记录时间线变化" }),
  ).toBeVisible();
  await expect(page.getByLabel("主体人物", { exact: true })).toHaveValue(
    book.characters[0].id,
  );
  await expect(page.getByLabel("关系对象", { exact: true })).toHaveValue(
    book.characters[1].id,
  );
  await page.getByLabel("事件标题", { exact: true }).fill("联手调查");
  await page.getByLabel("变化后的状态", { exact: true }).fill("彼此信任");
  await page.getByLabel("生效章节", { exact: true }).selectOption("");
  await page.getByLabel("记录性质", { exact: true }).selectOption("confirmed");
  await page.getByRole("button", { name: "保存变化", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".cytoscape-canvas")
        .evaluate((el) => el._cyreg.cy.edges().length),
    )
    .toBe(1);
  await page.locator(".cytoscape-canvas").scrollIntoViewIfNeeded();
  // Click an actual canvas edge to open its editable source event.
  const edge = await page.locator(".cytoscape-canvas").evaluate((el) => {
    const p = el._cyreg.cy.edges()[0].renderedMidpoint(),
      r = el.getBoundingClientRect();
    return { x: r.x + p.x, y: r.y + p.y };
  });
  await page.mouse.click(edge.x, edge.y);
  await page
    .getByRole("button", { name: "设置后续变化 / 时间（可选）", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "编辑时间线变化" }),
  ).toBeVisible();
  await page.getByLabel("变化后的状态", { exact: true }).fill("互相提防");
  await page.getByRole("button", { name: "保存变化", exact: true }).click();
  await expect
    .poll(async () => (await call("book:get", { id: b.id })).timeline[0].value)
    .toBe("互相提防");
  await page.locator(".cytoscape-canvas").scrollIntoViewIfNeeded();
  await tap(0);
  for (const width of [1464, 1040]) {
    await app.evaluate(
      ({ BrowserWindow }, w) =>
        BrowserWindow.getAllWindows()[0].setSize(w, 900),
      width,
    );
    await page.locator(".graph-selection").scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        page.locator(".graph-workbench").evaluate((el) => {
          const box = el.getBoundingClientRect();
          return [
            ...el.querySelectorAll(
              ".graph-selection button, .graph-accessible",
            ),
          ].every((child) => {
            const rect = child.getBoundingClientRect();
            return (
              rect.bottom <= box.bottom &&
              rect.right <= box.right &&
              rect.left >= box.left
            );
          });
        }),
      )
      .toBe(true);
  }
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1464, 900),
  );
  await page.getByRole("button", { name: "编辑人物档案", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  // Drag a node and verify the saved layout can be restored after leaving the view.
  await page.locator(".cytoscape-canvas").scrollIntoViewIfNeeded();
  const pos = await page.locator(".cytoscape-canvas").evaluate((el) => {
    const p = el._cyreg.cy.nodes()[0].renderedPosition(),
      r = el.getBoundingClientRect();
    return { x: r.x + p.x, y: r.y + p.y };
  });
  await page.mouse.move(pos.x, pos.y);
  await page.mouse.down();
  await page.mouse.move(pos.x + 45, pos.y + 25, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate((id) => !!localStorage.getItem("graph-layout:" + id), b.id),
    )
    .toBe(true);
  await page
    .locator(".graph-workbench")
    .screenshot({ path: resolve("test-results/v04-graph.png") });
  for (const label of ["兄妹", "敌对"]) {
    await page.getByRole("button", { name: "添加关系", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "添加人物关系", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("button", { name: "保存关系", exact: true }).click();
  }
  const relations = (await call("book:get", { id: b.id })).timeline;
  assert.ok(
    relations.some(
      (e) =>
        e.value === "兄妹" &&
        e.attribute === "亲属关系" &&
        e.phase === "confirmed" &&
        e.chapterId === "",
    ),
  );
  assert.ok(
    relations.some((e) => e.value === "敌对" && e.attribute === "相处关系"),
  );
  await page.getByRole("button", { name: "世界设定", exact: true }).click();
  await page.getByRole("tab", { name: "世界变化" }).click();
  for (const [title, phase] of [
    ["港口封锁", "confirmed"],
    ["旧城开放", "planned"],
  ]) {
    await page.getByRole("button", { name: "记录变化", exact: true }).click();
    await page.getByLabel("事件标题", { exact: true }).fill(title);
    await page.getByLabel("变化对象", { exact: true }).fill("雾港");
    await page
      .getByLabel("变化后的状态", { exact: true })
      .fill(
        title === "港口封锁"
          ? "停止航行，城内补给开始减少。"
          : "居民可以进入旧城，寻找失踪者。",
      );
    await page.getByLabel("记录性质", { exact: true }).selectOption(phase);
    await page.getByRole("button", { name: "保存变化", exact: true }).click();
  }
  await page
    .getByLabel("时间线布局", { exact: true })
    .selectOption("alternating");
  await expect(
    page.locator(".chrono-timeline.alternating .event-row"),
  ).toHaveCount(2);
  await page
    .locator(".chrono-timeline")
    .screenshot({ path: resolve("test-results/v04-world.png") });
  await page
    .getByLabel("时间线布局", { exact: true })
    .selectOption("horizontal");
  await expect(page.locator(".chrono-timeline.horizontal")).toBeVisible();
  await page
    .getByLabel("筛选变化状态", { exact: true })
    .selectOption("planned");
  await expect(page.locator(".event-row")).toHaveCount(1);
  await page.getByLabel("筛选变化状态", { exact: true }).selectOption("all");
  await page.getByRole("button", { name: "上一时间点", exact: true }).click();
  await expect(page.getByLabel("查看时间点", { exact: true })).toHaveValue("");
  await expect(page.locator(".current-world")).toHaveCount(0);
  await page.getByRole("button", { name: "下一时间点", exact: true }).click();
  await expect(page.locator(".current-world")).toContainText("停止航行");
  await page.getByRole("button", { name: "关系与记忆", exact: false }).click();
  await expect(page.locator(".memory-time-label")).toContainText(
    book.chapters[0].title,
  );
  await page.getByRole("button", { name: "故事大纲", exact: true }).click();
  await page.getByRole("tab", { name: /剧情时间线/ }).click();
  await expect(page.locator(".outline-journey")).toContainText(
    book.chapters[0].title,
  );
  await page.locator(".journey-chapters button").first().click();
  await expect(page.locator(".volume-chapter").first()).toBeInViewport();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1040, 760),
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Atlas desktop passed: real canvas node/edge interaction, relationship creation/edit, person editor, drag persistence, timeline layouts/filter/time navigation, memory and outline chronology, compact width.",
  );
} finally {
  await app.close();
}
