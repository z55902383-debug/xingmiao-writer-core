import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, rm, readFile } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve("test-results"),
  dataPath = resolve(output, "timeline-data");
await mkdir(output, { recursive: true });
await rm(dataPath, { recursive: true, force: true });
const env = { ...process.env, XM_TEST: "1", XM_DATA_DIR: dataPath };
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
  let book = await call("book:get", { id: b.id });
  const first = book.chapters[0];
  await page.locator(".compose-advanced > summary").click();
  await page.locator(".assistant-compose select").first().selectOption("5");
  await expect.poll(async () => (await call("book:get", { id: b.id })).contextChapters).toBe(5);
  await page.getByRole("tab", { name: "功能" }).click();
  await page.getByRole("button", { name: "世界设定", exact: true }).click();
  if (await guideClose.isVisible().catch(() => false)) await guideClose.click({ force: true });
  await page.getByRole("tab", { name: /世界变化/ }).click();
  await page.getByRole("button", { name: "记录变化", exact: true }).click();
  await page.getByLabel("事件标题", { exact: true }).fill("港口封锁");
  await page.getByLabel("变化对象", { exact: true }).fill("雾港");
  await page.getByLabel("变化维度", { exact: true }).fill("交通");
  await page
    .getByLabel("变化后的状态", { exact: true })
    .fill("全城港口封锁，客船停航");
  await page.getByLabel("记录性质", { exact: true }).selectOption("confirmed");
  await page.getByRole("button", { name: "保存变化", exact: true }).click();
  await expect(page.locator(".current-world")).toContainText("全城港口封锁");
  await page.screenshot({ path: resolve(output, "v03-world.png") });
  await page.getByLabel("查看时间点", { exact: true }).selectOption("");
  await expect(page.locator(".current-world")).toHaveCount(0);
  await expect(page.locator(".event-row")).toContainText("尚未到达");
  await page.getByRole("button", { name: "人物档案", exact: true }).click();
  await page.getByRole("tab", { name: /关系与变化/ }).click();
  await page.getByRole("button", { name: "记录变化", exact: true }).click();
  await page.getByLabel("事件标题", { exact: true }).fill("共同调查");
  await page.getByLabel("生效章节", { exact: true }).selectOption("");
  await page.getByLabel("记录性质", { exact: true }).selectOption("confirmed");
  await page.getByLabel("变化后的状态", { exact: true }).fill("彼此信任的搭档");
  await page.getByRole("button", { name: "保存变化", exact: true }).click();
  await page.locator(".graph-accessible summary").click();
  await expect(page.locator(".edge-label")).toContainText("彼此信任的搭档");
  await page.getByRole("button", { name: "记录变化", exact: true }).click();
  await page.getByLabel("变化类型", { exact: true }).selectOption("character");
  await page.getByLabel("事件标题", { exact: true }).fill("陈默失踪");
  await page.getByLabel("变化后的状态", { exact: true }).fill("失踪");
  await page.getByLabel("记录性质", { exact: true }).selectOption("confirmed");
  await page.getByRole("button", { name: "保存变化", exact: true }).click();
  await expect(
    page.locator(".node-status").filter({ hasText: "失踪" }),
  ).toBeVisible();
  await page.screenshot({ path: resolve(output, "v03-graph.png") });
  await page.getByRole("button", { name: "故事大纲", exact: true }).click();
  await page.getByRole("tab", { name: /分卷章节/ }).click();
  await page.getByRole("button", { name: "新建分卷", exact: true }).click();
  await page.getByLabel("卷名", { exact: true }).fill("第一卷 · 潮声");
  await page
    .getByLabel("卷大纲", { exact: true })
    .fill("一封信打破平静，追查十年前的火灾。");
  await page
    .getByLabel("卷细纲", { exact: true })
    .fill("开端：收到来信\n推进：调查码头\n高潮：灯塔之夜");
  await page.getByRole("button", { name: "保存分卷", exact: true }).click();
  book = await call("book:get", { id: b.id });
  const volume = book.volumes[0];
  await page
    .getByLabel(`${first.title}所属分卷`, { exact: true })
    .selectOption(volume.id);
  await expect(page.locator(".volume-block").first()).toContainText(
    first.title,
  );
  await page
    .getByLabel(`${first.title}章节概要`, { exact: true })
    .fill("陌生信件让陈默开始追查过去");
  await page.getByRole("tab", { name: /故事总纲/ }).click();
  await page.getByLabel("全书每章默认字数", { exact: true }).fill("3000");
  await page.getByRole("tab", { name: /分卷章节/ }).click();
  await page.screenshot({ path: resolve(output, "v03-volumes.png") });
  await page
    .locator(".volume-block")
    .first()
    .getByRole("button", { name: "进入正文", exact: true })
    .click();
  await page.locator(".assistant-compose select").nth(1).selectOption("2000");
  await expect
    .poll(
      async () =>
        (await call("book:get", { id: b.id })).chapters[0].targetWords,
    )
    .toBe(2000);
  await page.getByText("自定义字数", { exact: true }).click();
  await page.getByLabel("自定义本章字数", { exact: true }).fill("2345");
  await page.getByRole("button", { name: "应用字数", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await call("book:get", { id: b.id })).chapters[0].targetWords,
    )
    .toBe(2345);
  await page.locator(".assistant-compose select").nth(1).selectOption("2000");
  await expect
    .poll(
      async () =>
        (await call("book:get", { id: b.id })).chapters[0].targetWords,
    )
    .toBe(2000);
  const ctx = await call("context:preview", {
    bookId: b.id,
    chapterId: first.id,
    kind: "write",
  });
  assert.equal(ctx.targetWords, 2000);
  // Editing the chapter invalidates its world and character events without destroying them.
  await page
    .getByLabel("章节正文", { exact: true })
    .fill("新正文：雾港的雨停了。");
  await page.getByRole("button", { name: "本章定稿", exact: true }).click();
  await page.getByRole("button", { name: "世界设定", exact: true }).click();
  await expect(page.locator(".event-row")).toContainText("待复核");
  await page.getByRole("button", { name: "重新核对", exact: true }).click();
  await page.getByRole("button", { name: "保存变化", exact: true }).click();
  await expect(page.locator(".event-row")).toContainText("当前有效");
  // Backup includes remapped volume, character and timeline references.
  const backupPath = resolve(output, "v03-backup.json");
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, backupPath);
  await call("backup:save");
  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  assert.equal(backup.books[0].volumes.length, 1);
  assert.equal(await call("backup:restore"), 1);
  const restored = (await call("books:list")).find((x) => x.id !== b.id);
  const rb = await call("book:get", { id: restored.id });
  assert.equal(rb.chapters[0].volumeId, rb.volumes[0].id);
  assert.equal(rb.contextChapters,5);
  assert.equal(rb.chapters[0].summary, "陌生信件让陈默开始追查过去");
  assert.equal(rb.chapters[0].targetWords, 2000);
  assert.ok(
    rb.timeline.every(
      (e) => !e.chapterId || rb.chapters.some((c) => c.id === e.chapterId),
    ),
  );
  assert.ok(
    rb.timeline
      .filter((e) => e.kind !== "world")
      .every((e) => rb.characters.some((c) => c.id === e.characterId)),
  );
  assert.equal(rb.timeline.length, 3);
  await page.getByRole("button", { name: "故事大纲", exact: true }).click();
  await page
    .getByRole("button", { name: `删除分卷 ${volume.title}`, exact: true })
    .click();
  await page.getByRole("button", { name: "确认删除分卷", exact: true }).click();
  await expect(page.locator(".volume-block")).toHaveCount(1);
  assert.equal((await call("book:get", { id: b.id })).chapters.length, 1);
  const trash = (await call("trash:list")).find((t) => t.type === "volume");
  await call("trash:restore", { id: trash.id });
  assert.equal(
    (await call("book:get", { id: b.id })).chapters[0].volumeId,
    volume.id,
  );
  await page.getByLabel('修改章节名称 '+first.title,{exact:true}).fill('重新命名的章节');
  await page.getByRole('button',{name:'已保存',exact:true}).click();
  assert.equal((await call('book:get',{id:b.id})).chapters[0].title,'重新命名的章节');
  await page.getByRole('button',{name:'删除章节 重新命名的章节',exact:true}).click();
  await page.getByRole('button',{name:'确认删除章节',exact:true}).click();
  await expect(page.locator('#volume-none')).toHaveCount(0);
  assert.equal((await call('book:get',{id:b.id})).chapters.length,0);
  assert.ok((await call('trash:list')).some(x=>x.type==='chapter'));
  assert.deepEqual(errors, []);
  console.log(
    "Timeline desktop passed: world timeline, time filtering, relation graph, character state, volume hierarchy, synopsis, target words, invalidation/reconfirmation, backup ID remapping and volume recovery.",
  );
} finally {
  await app.close();
}
