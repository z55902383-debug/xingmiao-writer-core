import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const folder = resolve('test-results/generation-activity');
await mkdir(folder, { recursive: true });
const data = await mkdtemp(resolve(folder, 'run-'));
const responses = [], errors = [];
const server = createServer(async (req, res) => {
  let raw = ''; for await (const part of req) raw += part;
  const input = JSON.parse(raw);
  responses.push({ res, input, analysis: input.messages.some(m => m.content.includes('没有变化返回')) });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const chunk = (request, text) => {
  if (!request.res.headersSent) request.res.writeHead(200, { 'content-type': 'text/event-stream' });
  request.res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n');
};
const done = request => request.res.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
const env = { ...process.env, XM_TEST: '1', XM_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.XM_DEV_URL;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  const call = (action, data = {}) => page.evaluate(async ({ action, data }) => {
    const result = await window.xingmiao.invoke(action, data); if (!result.ok) throw Error(result.error); return result.data;
  }, { action, data });
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  let book = await call('book:create', { title: '生成交互专项' });
  await call('book:update', { id: book.id, patch: { reference: '旧参考文章', referenceName: 'old.txt', style: '旧版风格内容' } });
  book = await call('writing:save', { bookId: book.id, profile: { kind: 'style', title: '短段对白 · 镜头跟随人物行动的写作风格', body: '', source: '可蒸馏的测试原文', sourceName: 'example.txt' } });
  await call('writing:save', { bookId: book.id, profile: { kind: 'requirement', title: '段落要求', body: '对白另起一段', source: '', sourceName: '' } });
  await call('config:save', { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture', name: '隔离模型', maxTokens: 4096 });
  await page.reload();
  await page.getByRole('button', { name: /继续.*生成交互专项/ }).click();
  const close = page.locator('.creation-guide-close'); if (await close.isVisible().catch(() => false)) await close.click();
  await page.getByRole('tab', { name: '功能', exact: true }).click(); await page.getByRole('button', { name: '风格档案', exact: true }).click();
  const legacy = page.locator('.writing-legacy');
  await expect(legacy).not.toHaveAttribute('open', '');
  await expect(page.locator('.writing-row-badge')).toHaveText('待蒸馏或填写');
  await legacy.locator('summary').first().click(); await expect(page.getByLabel('写作方法与语言偏好', { exact: true })).toHaveValue('旧版风格内容');
  await legacy.locator('summary').first().click();
  // Delay only the fixture IPC so the preparation state can be inspected before a Job exists.
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('xm:invoke');
    ipcMain.removeHandler('xm:invoke');
    ipcMain.handle('xm:invoke', async (...args) => {
      if (args[1] === 'ai:generate') await new Promise(r => setTimeout(r, 800));
      return original(...args);
    });
  });
  const activity = page.getByRole('region', { name: '生成进度', exact: true });
  await page.locator('.writing-library').getByRole('button', { name: 'AI 蒸馏', exact: true }).click();
  await expect(activity).toContainText('正在准备资料'); await expect(activity).toHaveAttribute('data-active', 'true');
  await expect(activity).toContainText('短段对白');
  await expect.poll(() => responses.length).toBe(1); await expect(activity).toContainText('等待模型响应');
  await expect(activity).not.toContainText('%');
  assert.notEqual(await activity.locator('.generation-activity-icon svg').evaluate(el => getComputedStyle(el).animationName), 'none');
  chunk(responses[0], '风格正在逐段生成。\n'); await expect(activity).toContainText('正在生成内容'); await expect(activity).toContainText('已生成');
  chunk(responses[0], Array.from({ length: 85 }, (_, i) => `第 ${i + 1} 条：以动作推进场景，保留人物的选择。`).join('\n') + '\n');
  const output = page.locator('.candidate-text'); await expect(output).toContainText('第 85 条');
  await expect.poll(() => output.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await output.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  await expect(page.getByRole('button', { name: '跟随最新内容', exact: true })).toBeVisible();
  chunk(responses[0], '最新一条：不重复解释情绪。'); await expect(output).toContainText('最新一条');
  assert.equal(await output.evaluate(el => el.scrollTop), 0);
  await page.getByRole('button', { name: '跟随最新内容', exact: true }).click();
  await expect.poll(() => output.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(32);
  // Activity stays visible outside the independently scrolling assistant and document.
  await page.locator('.assistant-body').evaluate(el => el.scrollTop = el.scrollHeight);
  await expect(activity).toBeVisible(); const rect = await activity.boundingBox(); assert.ok(rect.y < 150);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const width of [1460, 1024]) {
      await page.setViewportSize({ width, height: 900 }); await expect(activity).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: resolve(data, `generating-${theme}-${width}.png`) });
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await activity.locator('.generation-activity-icon svg').evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await activity.locator('.generation-activity-track i').evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  done(responses[0]); await expect(activity).toHaveAttribute('data-active', 'false'); await expect(activity).toContainText('生成完成');
  await activity.getByRole('button', { name: '查看结果', exact: true }).click();
  await page.getByRole('button', { name: '采用结果', exact: true }).click();
  await expect(page.locator('.writing-row-badge')).toHaveText('可选用');
  await page.screenshot({ path: resolve(data, 'library-complete.png') });
  // Prose generation remains active while the separate story-change analysis runs.
  await page.getByRole('button', { name: '章节正文', exact: true }).click(); await page.getByRole('tab', { name: '创作正文', exact: true }).click();
  await page.getByRole('button', { name: '开始生成', exact: true }).click(); await expect.poll(() => responses.length).toBe(2);
  await expect(activity).not.toContainText('已生成');
  chunk(responses[1], '林晚推开门，听见雨滴落在窗沿。'); done(responses[1]);
  await expect.poll(() => responses.length).toBe(3); assert.ok(responses[2].analysis);
  await expect(activity).toContainText('正在分析故事变化'); await expect(activity).toHaveAttribute('data-active', 'true');
  await activity.getByRole('button', { name: '停止当前生成', exact: true }).click(); await expect(activity).toHaveAttribute('data-active', 'false');
  book = await call('book:get', { id: book.id }); assert.match(book.candidates[0].output, /林晚推开门/); assert.equal(book.chapters[0].body, '');
  // Stop a stream and preserve received text; the next request must return to waiting.
  await page.getByRole('button', { name: '开始生成', exact: true }).click(); await expect.poll(() => responses.length).toBe(4);
  chunk(responses[3], '这段内容会在停止后保留。'); await expect(activity).toContainText('正在生成内容');
  await activity.getByRole('button', { name: '停止当前生成', exact: true }).click(); await expect(activity).toContainText('已停止生成');
  await expect(activity).toHaveAttribute('data-active', 'false');
  await page.getByRole('button', { name: '开始生成', exact: true }).click(); await expect.poll(() => responses.length).toBe(5);
  responses[4].res.writeHead(400, { 'content-type': 'application/json' }); responses[4].res.end(JSON.stringify({ error: { message: 'fixture unavailable' } }));
  await expect(activity).toContainText('生成失败'); await expect(activity).toHaveAttribute('data-active', 'false');
  assert.deepEqual(errors, []);
  await writeFile(resolve(data, 'result.json'), JSON.stringify({ status: 'passed', checks: ['preparation from central generate', 'waiting and live character count', 'persistent activity after scrolling', 'follow and pause streaming', 'dark/light at 1460/1024', 'reduced motion', 'completion', 'analysis cancellation retains prose', 'stream cancellation', 'request failure', 'legacy disclosure and row status'] }, null, 2));
  console.log('Generation activity desktop passed: ' + data);
} finally { await app.close(); server.closeAllConnections(); server.close(); }
