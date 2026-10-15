import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('test-results/author-tools'); await mkdir(root, { recursive: true });
const data = await mkdtemp(resolve(root, 'run-')), requests = [], errors = [];
const repeated = '林晚沿着长廊走到窗前，把铜钥匙藏进书柜最下面的抽屉里。';
const server = createServer(async (req, res) => {
  let raw = ''; for await (const part of req) raw += part;
  const input = JSON.parse(raw); requests.push(input);
  const prompt = input.messages.map(m => m.content).join('\n');
  const content = prompt.includes('从来源章节提取明确事实') ? JSON.stringify({ rows: [
    { kind: 'character', subject: '林晚', value: '交出钥匙的人', evidence: '林晚把铜钥匙交给陈默。' },
    { kind: 'memory', subject: '铜钥匙', relation: '持有者', value: '陈默', evidence: '林晚把铜钥匙交给陈默。' },
  ] }) : prompt.includes('拆解可迁移写作技法') ? JSON.stringify({ rows: [{ title: '行动交代关系', method: '用物品交接呈现信任', useWhen: '人物有行动目标时', evidence: '交出铜钥匙' }] })
    : prompt.includes('没有变化返回') ? '{"changes":[]}' : repeated + '\n' + repeated + '\n（此处省略）\n她推开那扇多年无人问津的房门，看见桌面上的';
  res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const env = { ...process.env, XM_TEST: '1', XM_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.XM_DEV_URL;
let app, debugPage;
try {
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow(); debugPage = page; page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  const call = (action, data = {}) => page.evaluate(async ({ action, data }) => { const r = await window.xingmiao.invoke(action, data); if (!r.ok) throw Error(r.error); return r.data; }, { action, data });
  await expect(page.getByRole('button', { name: '导入已有书稿', exact: true })).toBeVisible();
  const headingActions = page.locator('.shelf-heading-actions');
  const importBounds = await headingActions.getByRole('button', { name: '导入已有书稿', exact: true }).boundingBox();
  const createBounds = await headingActions.getByRole('button', { name: '新建作品', exact: true }).boundingBox();
  assert.ok(createBounds.x - importBounds.x - importBounds.width >= 10, 'Shelf actions need a consistent gap');
  assert.ok(createBounds.x - importBounds.x - importBounds.width <= 16, 'Shelf actions must stay grouped');
  await page.screenshot({ path: resolve(data, 'shelf-action-spacing.png') });
  await call('config:save', { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture' });
  await page.reload();
  await page.getByRole('button', { name: '导入已有书稿', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '导入已有书稿', exact: true });
  await dialog.getByLabel('导入书名', { exact: true }).fill('优化完整流程测试');
  await dialog.getByLabel('原始书稿', { exact: true }).fill('第1章 雨夜\n林晚把铜钥匙交给陈默。\n第2章 未完\n她走进房间，看见');
  await dialog.getByRole('button', { name: '预览章节切分', exact: true }).click();
  await expect(dialog).toContainText('识别到 2 章');
  await dialog.getByRole('button', { name: '创建可续写作品', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  let book = await call('book:get', { id: (await call('books:list'))[0].id });
  assert.equal(book.chapters[0].status, 'final'); assert.equal(book.chapters[1].status, 'draft');
  const guide = page.locator('.creation-guide-close'); if (await guide.isVisible().catch(() => false)) await guide.click();
  await page.getByRole('button', { name: '素材与复核', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '素材与复核', exact: true });
  await dialog.locator('.author-tool-list input').first().check();
  await dialog.getByRole('button', { name: /分析选中章节/ }).click();
  await expect(dialog.locator('.author-analysis-row')).toHaveCount(2);
  await dialog.locator('.author-analysis-run > summary').first().click();
  await dialog.locator('.author-analysis-row input').first().check();
  await dialog.locator('.author-analysis-row input').last().check();
  await dialog.getByRole('button', { name: '采用勾选资料', exact: true }).click();
  await expect(dialog).toContainText('已采用');
  book = await call('book:get', { id: book.id }); assert.equal(book.memories.length, 1); assert.equal(book.characters[0].name, '林晚');
  await dialog.getByRole('tab', { name: '拆文素材', exact: true }).click();
  await dialog.getByLabel('参考作品或来源名称', { exact: true }).fill('参考小说');
  await dialog.getByLabel('拆文原文', { exact: true }).fill('私有参考原文：他交出铜钥匙。');
  await dialog.getByRole('button', { name: '提炼可复用技法', exact: true }).click();
  await expect(dialog.locator('.author-analysis-row')).toHaveCount(1);
  await dialog.locator('.author-analysis-run > summary').first().click();
  await dialog.locator('.author-analysis-row input').check();
  await dialog.getByRole('button', { name: '采用勾选资料', exact: true }).click();
  const technique = dialog.locator('details').filter({ has: page.locator(':scope > summary', { hasText: '行动交代关系 · 参考小说' }) }).first();
  await technique.locator('summary').first().click();
  await technique.getByRole('checkbox', { name: '用于本书正文生成', exact: true }).check();
  await expect.poll(async () => (await call('book:get', { id: book.id })).techniques[0].enabled).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: resolve(data, 'technique-library.png') });
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '本章写前卡', exact: true }).click(); const card = page.locator('.writing-card');
  await card.getByLabel('本章必须发生', { exact: true }).fill('交出钥匙');
  await card.getByLabel('本章禁止发生', { exact: true }).fill('不揭露真凶');
  await card.getByLabel('写到哪里停', { exact: true }).fill('门响时停笔');
  for (const size of [{ width: 1464, height: 900 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size);
    const closeAssistant = page.locator('.assistant-drawer-trigger[aria-expanded="true"]');
    if (await closeAssistant.isVisible().catch(() => false)) {
      await closeAssistant.click();
      await expect.poll(() => page.locator('.assistant-panel').evaluate(el => Math.round(el.getBoundingClientRect().left))).toBeGreaterThanOrEqual(size.width);
    }
    const layout = await card.evaluate(el => {
      const intro = el.querySelector('.writing-card-intro'), p = intro.querySelector('p'), b = intro.querySelector('button');
      const a = p.getBoundingClientRect(), r = b.getBoundingClientRect(), c = el.getBoundingClientRect();
      const label = el.querySelector('.field > label').getBoundingClientRect(), textarea = el.querySelector('textarea').getBoundingClientRect();
      return { separation: r.x >= a.right ? r.x - a.right : r.y - a.bottom, inside: r.right <= c.right && r.x >= c.x, labelGap: textarea.top - label.bottom };
    });
    assert.ok(layout.inside && layout.separation >= 12, 'Writing-card action must have breathing room');
    assert.ok(layout.labelGap >= 6, 'Field labels must not touch inputs');
    await card.locator('summary').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(data, `writing-card-spacing-${size.width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: '关闭章节资料', exact: true }).click();
  await page.getByRole('button', { name: '打开写作助手', exact: true }).click();
  await page.getByRole('button', { name: '开始生成', exact: true }).click();
  await expect(page.locator('.candidate-text')).toContainText(repeated);
  await expect(page.locator('.generation-activity')).toHaveAttribute('data-active', 'false');
  const review = page.locator('.prose-review:not(.relation-check)'); await review.locator('summary').click();
  await expect(review.locator('article')).toHaveCount(3);
  await review.getByRole('button', { name: '定位原文', exact: true }).first().click();
  assert.equal(await page.evaluate(() => window.getSelection()?.toString().trim()), repeated);
  await review.getByRole('button', { name: '忽略此处', exact: true }).first().click();
  await expect(review.locator('article')).toHaveCount(2);
  await review.getByRole('button', { name: '恢复已忽略项', exact: true }).click();
  await expect(review.locator('article')).toHaveCount(3);
  await page.screenshot({ path: resolve(data, 'prose-review.png') });
  const request = requests.find(r => r.messages.some(m => m.content.includes('根据本章大纲创作本章正文')));
  assert.ok(request); const prose = JSON.parse(request.messages[1].content.split('以下 JSON 为资料数据：\n')[1]);
  assert.equal(prose.writingCard.stop, '门响时停笔'); assert.equal(prose.techniques[0].title, '行动交代关系'); assert.ok(!JSON.stringify(request).includes('私有参考原文'));
  await page.getByRole('button', { name: '采用结果', exact: true }).click();
  await expect.poll(async () => (await call('book:get', { id: book.id })).chapters[1].proseSources?.length).toBe(1);
  const original = book.chapters[0], changed = await call('chapter:save', { id: original.id, revision: original.revision, patch: { body: '林晚收回铜钥匙。' } });
  await call('chapter:finalize', { id: changed.id, revision: changed.revision });
  await page.reload();
  await page.getByRole('button', { name: /继续.*优化完整流程测试/ }).click();
  if (await guide.isVisible().catch(() => false)) await guide.click();
  await page.getByRole('button', { name: '素材与复核', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '素材与复核', exact: true });
  await dialog.getByRole('tab', { name: '改稿影响', exact: true }).click();
  await expect(dialog.locator('.author-impact')).toHaveCount(1);
  await expect(dialog.locator('.author-impact')).toContainText('铜钥匙');
  await expect(dialog.locator('.author-impact')).toContainText('第2章');
  await dialog.getByRole('button', { name: '已人工核对这条关联', exact: true }).click();
  await expect(dialog.locator('.author-impact')).not.toContainText('曾引用此前文的正文');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.screenshot({ path: resolve(data, 'revision-impact-light.png') });
  assert.deepEqual(errors, []);
  await writeFile(resolve(data, 'result.json'), JSON.stringify({ status: 'passed', checks: ['import and partial chapter', 'evidenced record reconstruction', 'technique adoption and selection', 'writing card in actual request', 'prose issue selection and ignore', 'dependent candidate and stale memory impact'], requests: requests.length }, null, 2));
  console.log('Author tools desktop passed: ' + data);
} catch (error) {
 if (debugPage) {
  await debugPage.screenshot({ path: resolve(data, 'failure.png') }).catch(() => {});
  const layout = await debugPage.evaluate(() => ({ size: [innerWidth, innerHeight], elements: ['.workspace','.assistant-panel','.assistant-writing-mode','.assistant-body','.assistant-compose','.compose-bottom','.writing-card'].map(selector => { const e = document.querySelector(selector); if (!e) return {selector}; const r=e.getBoundingClientRect(),s=getComputedStyle(e); return {selector,rect:{x:r.x,y:r.y,width:r.width,height:r.height},overflow:s.overflow,display:s.display,minHeight:s.minHeight,flex:s.flex}; }) }));
  await writeFile(resolve(data, 'failure-layout.json'), JSON.stringify(layout,null,2));
  console.log('Failure details: '+data);
 }
 throw error;
} finally { if (app) await app.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
