import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('test-results/comparison'); await mkdir(root, { recursive: true });
const data = await mkdtemp(resolve(root, 'run-')), errors = [];
const generated = '顾舟推开书店的门，窗边的老人抬起头。\n\n' + '雨声落在屋檐上，街角的灯还亮着。\n\n'.repeat(40);
const server = createServer(async (req, res) => { for await (const _ of req) {} res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: generated }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const env = { ...process.env, XM_TEST: '1', XM_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.XM_DEV_URL;
let app;
try {
  app = await electron.launch({ args: ['.'], env }); const page = await app.firstWindow(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  const call = (action, data = {}) => page.evaluate(async ({ action, data }) => { const r = await window.xingmiao.invoke(action, data); if (!r.ok) throw Error(r.error); return r.data; }, { action, data });
  let b = await call('book:create', { title: '双列创作测试' }); const first = b.chapters[0], second = await call('chapter:create', { bookId: b.id });
  const saved = await call('chapter:save', { id: first.id, revision: first.revision, patch: { title: '第1章 对照创作', body: '既有正文应当保留。' } });
  await call('config:save', { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture' });
  await call('ai:generate', { bookId: b.id, chapterId: first.id, kind: 'write', analyzeChanges: false });
  await expect.poll(async () => (await call('book:get', { id: b.id })).candidates[0]?.status).toBe('done');
  b = await call('book:get', { id: b.id }); const job = b.candidates[0];
  await page.reload(); await page.getByRole('button', { name: /继续.*双列创作测试/ }).click();
  const guide = page.locator('.creation-guide-close'); if (await guide.isVisible().catch(() => false)) await guide.click();
  await expect(page.locator('.manuscript > .continuity-panel')).toHaveCount(0); await expect(page.locator('.manuscript > .writing-card')).toHaveCount(0);
  await page.getByRole('button', { name: '续写资料', exact: true }).click(); await expect(page.locator('.chapter-tools-drawer')).toBeVisible(); await expect(page.locator('.continuity-panel')).toHaveAttribute('open', '');
  await page.getByRole('button', { name: '关闭章节资料', exact: true }).click();
  await page.getByRole('button', { name: '本章写前卡', exact: true }).click(); await expect(page.getByLabel('本章必须发生', { exact: true })).toBeVisible(); await page.getByRole('button', { name: '关闭章节资料', exact: true }).click();
  await page.getByRole('button', { name: '双列对照创作', exact: true }).click();
  const writer = page.locator('.compare-writer'), human = writer.getByRole('textbox', { name: '人工对照正文', exact: true }), ai = writer.getByRole('textbox', { name: 'AI参考正文', exact: true });
  await expect(human).toHaveValue(''); await expect(ai).toHaveValue(/顾舟推开书店/); await expect(ai).toHaveAttribute('readonly', '');
  assert.equal((await call('book:get', { id: b.id })).chapters[0].body, '既有正文应当保留。');
  const text = '顾舟没有推门。他站在檐下，看老人把门拉开。\n\n这是我自己重新写下的这一章。'; await human.fill(text);
  await expect.poll(async () => (await call('comparison:read', { chapterId: first.id })).text).toBe(text);
  assert.equal((await call('book:get', { id: b.id })).chapters[0].body, '既有正文应当保留。');
  await writer.getByRole('separator', { name: '调整对照栏宽', exact: true }).press('ArrowLeft'); await expect(writer.getByRole('separator')).toHaveAttribute('aria-valuenow', '48');
  await writer.getByRole('checkbox', { name: '同步滚动', exact: true }).check();
  for (const size of [{ width: 1464, height: 900 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size); await human.scrollIntoViewIfNeeded();
    const layout = await writer.locator('.compare-columns').evaluate(el => { const cols = [...el.querySelectorAll('.compare-column')].map(n => n.getBoundingClientRect()); return { left: cols[0].width, right: cols[1].width, horizontal: cols[1].left > cols[0].right, viewport: innerWidth, rightEdge: el.getBoundingClientRect().right }; });
    assert.ok(layout.horizontal && layout.left > 230 && layout.right > 230 && layout.rightEdge <= layout.viewport, JSON.stringify(layout));
    await page.screenshot({ path: resolve(data, `comparison-${size.width}.png`) });
  }
  await page.setViewportSize({ width: 1464, height: 900 });
  await writer.getByRole('button', { name: '粘贴参考文', exact: true }).click(); await writer.getByRole('textbox', { name: '自定义参考文', exact: true }).fill('新的参考文字，只用于左栏。'); await writer.getByRole('button', { name: '使用这份参考文', exact: true }).click();
  await expect(ai).toHaveValue('新的参考文字，只用于左栏。'); await expect(human).toHaveValue(text);
  await writer.getByRole('combobox', { name: '选择对照候选稿', exact: true }).selectOption(job.id); await expect(ai).toHaveValue(/顾舟推开书店/);
  await page.getByRole('button', { name: '退出对照创作', exact: true }).click(); await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toHaveValue('既有正文应当保留。');
  await page.getByRole('button', { name: '双列对照创作', exact: true }).click(); await expect(human).toHaveValue(text);
  await writer.getByRole('button', { name: '写入本章正文', exact: true }).click(); await expect.poll(async () => (await call('book:get', { id: b.id })).chapters[0].body).toBe(text);
  assert.ok((await call('versions:list', { id: first.id })).some(v => v.body === '既有正文应当保留。'));
  await page.getByRole('button', { name: '返回书架', exact: true }).click(); await page.getByRole('button', { name: /人工码字板/ }).click();
  await page.getByRole('button', { name: '选择章节', exact: true }).click(); const picker = page.getByRole('dialog', { name: '选择章节', exact: true }); await picker.locator('.mt-picker-books').getByRole('button', { name: /双列创作测试/ }).click(); await picker.locator('.mt-picker-chapters').getByRole('button', { name: /第1章 对照创作/ }).click();
  await page.getByRole('button', { name: '双列对照创作', exact: true }).click(); await expect(human).toHaveValue(text); await expect(ai).toHaveValue(/顾舟推开书店/);
  const nextText = text + '\n人工码字板中补充的一段。'; await human.fill(nextText); await page.keyboard.press('Control+s');
  await expect.poll(async () => (await call('comparison:read', { chapterId: first.id })).text).toBe(nextText);
  await page.getByRole('button', { name: '返回书架', exact: true }).click(); await page.getByRole('button', { name: /继续.*双列创作测试/ }).click(); await page.getByRole('button', { name: '双列对照创作', exact: true }).click(); await expect(human).toHaveValue(nextText);
  if (second) { await page.locator('.chapter-item').filter({ hasText: second.title }).first().click(); await expect(human).toHaveValue(''); await page.locator('.chapter-item').filter({ hasText: '第1章 对照创作' }).first().click(); await expect(human).toHaveValue(nextText); }
  const latest = (await call('book:get', { id: b.id })).chapters[0]; await call('chapter:save', { id: first.id, revision: latest.revision, patch: { body: '另一入口的新正文。' } }); await writer.getByRole('button', { name: '写入本章正文', exact: true }).click(); await expect(writer.getByRole('alert')).toContainText('正文已变化'); await expect(human).toHaveValue(nextText);
  assert.equal((await call('book:get', { id: b.id })).chapters[0].body, '另一入口的新正文。'); assert.deepEqual(errors, []);
  await writer.getByRole('button', { name: '另存为新章节并载入最新草稿', exact: true }).click();
  await expect(writer.getByRole('alert')).toHaveCount(0); await expect.poll(async () => (await call('book:get', { id: b.id })).chapters.some(c => c.title.includes('对照创作副本') && c.body === nextText)).toBe(true);
  await writeFile(resolve(data, 'result.json'), JSON.stringify({ passed: true, checks: ['compact tools drawer', 'readonly fixed reference', 'empty independent draft', 'autosave', 'split resizing', 'desktop and compact layout', 'source switching preserves writing', 'explicit apply with history', 'shared manual draft', 'chapter isolation', 'conflict refusal'] }, null, 2));
  console.log('Comparison desktop passed: ' + data);
} catch (error) {
  if (app) { const page = await app.firstWindow(); await page.screenshot({ path: resolve(data, 'failure.png') }).catch(() => {}); console.log(JSON.stringify(await page.evaluate(() => Object.fromEntries(['.workspace','.work-area','.editor-scroll','.compare-controls','.compare-sync','.compare-sync input','.compare-columns','.editor-status'].map(s => { const el=document.querySelector(s); const r=el?.getBoundingClientRect(); return [s,r?{x:r.x,y:r.y,w:r.width,h:r.height,position:getComputedStyle(el).position,overflow:getComputedStyle(el).overflow}:null]; }))),null,2)); }
  console.log('Failure artifacts: '+data); throw error;
} finally { if (app) await app.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
