import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const folder = resolve('test-results/context-range');
await mkdir(folder, { recursive: true });
const data = await mkdtemp(resolve(folder, 'run-'));
const requests = [], errors = [];
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  const input = JSON.parse(raw);
  requests.push(input);
  const content = input.messages.some(m => m.content.includes('没有变化返回'))
    ? '{"changes":[]}' : '林晚把钥匙放回柜台，推门走进雨里。';
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end('data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const env = { ...process.env, XM_TEST: '1', XM_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
let app;
try {
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(e.message));
  const call = (action, data = {}) => page.evaluate(async ({ action, data }) => {
    const result = await window.xingmiao.invoke(action, data);
    if (!result.ok) throw Error(result.error);
    return result.data;
  }, { action, data });
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  let book = await call('book:create', { title: '十章连贯性测试' });
  assert.equal(book.contextChapters, 10);
  await call('book:update', { id: book.id, patch: { premise: '雨夜调查', outline: '调查旧案' } });
  for (let i = 0; i < 13; i++) {
    book = await call('book:get', { id: book.id });
    const chapter = book.chapters.at(-1);
    await call('chapter:save', { id: chapter.id, revision: chapter.revision, patch: { body: `前文标记${i}。`, outline: '调查线索' } });
    book = await call('book:get', { id: book.id });
    if (i !== 11) await call('chapter:finalize', { id: chapter.id, revision: book.chapters.at(-1).revision });
    await call('chapter:create', { bookId: book.id });
  }
  book = await call('book:get', { id: book.id });
  const current = book.chapters.at(-1);
  const expected = book.chapters.slice(0, -1).filter(c => c.status === 'final').slice(-10);
  await call('config:save', { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture', name: '隔离模型' });
  await page.evaluate(({ bookId, chapterId }) => localStorage.setItem(`xm-last-chapter:${bookId}`, chapterId), { bookId: book.id, chapterId: current.id });
  await page.reload();
  await page.getByRole('button', { name: /继续.*十章连贯性测试/ }).click();
  const guide = page.locator('.creation-guide-close');
  if (await guide.isVisible().catch(() => false)) await guide.click();
  await page.locator('.compose-advanced > summary').click();
  const range = page.getByRole('combobox', { name: '引用最近已定稿章节', exact: true });
  await expect(range).toHaveValue('10');
  await page.locator('.context-toggle').click();
  const checked = page.locator('.context-chapter-picker input:checked');
  await expect(checked).toHaveCount(10);
  // Keep a stable chapter target while the preview replaces its checkbox list.
  await page.locator('.context-chapter-picker label').filter({ hasText: expected[0].title }).locator('input').uncheck();
  await expect(checked).toHaveCount(9);
  await range.selectOption('5');
  await expect(checked).toHaveCount(5);
  await range.selectOption('10');
  await expect(checked).toHaveCount(10);
  await expect(page.locator('#assistant-context-detail')).not.toContainText('正在更新引用清单');
  await page.screenshot({ path: resolve(data, 'context-ten-chapters.png') });
  await page.getByRole('button', { name: '开始生成', exact: true }).click();
  await expect(page.locator('.candidate-text')).toContainText('林晚把钥匙');
  const prose = requests.find(r => r.messages.some(m => m.content.includes('根据本章大纲创作本章正文')));
  assert.ok(prose, 'Actual generation request must reach the isolated model');
  const payload = JSON.parse(prose.messages[1].content.split('以下 JSON 为资料数据：\n')[1]);
  assert.deepEqual(payload.recent, expected.map(c => ({ title: c.title, body: c.body })));
  assert.deepEqual(errors, []);
  await writeFile(resolve(data, 'result.json'), JSON.stringify({ status: 'passed', chapterCount: payload.recent.length, titles: payload.recent.map(c => c.title) }, null, 2));
  console.log('Ten-chapter context desktop passed: ' + data);
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise(r => server.close(r));
}
