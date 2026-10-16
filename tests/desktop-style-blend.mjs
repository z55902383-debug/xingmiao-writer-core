import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('test-results/style-blend');
await mkdir(output, { recursive: true });
const data = await mkdtemp(resolve(output, 'run-'));
const requests = [], errors = [];
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw); requests.push(input);
  const prompt = input.messages.map(row => row.content).join('\n');
  const match = prompt.match(/PRIVATE-([ABC])/);
  const content = match ? `风格${match[1]}：限知视角，克制叙述，生活化对白。FULL-${match[1]}-END` : '林晚推开邮局的门，把信封放在柜台上。';
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end('data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const env = { ...process.env, XM_TEST: '1', XM_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE; delete env.XM_DEV_URL;
let app = await electron.launch({ args: ['.'], env });
try {
  let page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  const call = (action, args = {}) => page.evaluate(async ({ action, args }) => {
    const result = await window.xingmiao.invoke(action, args);
    if (!result.ok) throw Error(result.error); return result.data;
  }, { action, args });
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  await call('config:save', { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture', name: '隔离模型', maxTokens: 4096 });
  await page.reload();
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建作品', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '开始一个新的故事' });
  await modal.getByLabel('书名 *', { exact: true }).fill('仿写融合专项');
  await expect(modal.getByLabel('创作方式', { exact: true })).toHaveCount(0);
  await modal.getByLabel('创作路径', { exact: true }).selectOption('short');
  await page.screenshot({ path: resolve(data, 'new-book.png') });
  await modal.getByRole('button', { name: '创建作品', exact: true }).click();
  await page.getByRole('tab', { name: '功能', exact: true }).click();
  await expect(page.getByRole('button', { name: '仿写对标', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '风格档案', exact: true }).click();
  const library = page.getByRole('region', { name: '写作资料库', exact: true });
  await expect(library.getByRole('heading', { name: '从参考小说提炼风格', exact: true })).toBeVisible();
  let book = (await call('books:list')).find(row => row.title === '仿写融合专项');
  assert.equal(book.creationMode, 'short');
  const paths = [];
  for (const name of ['A', 'B', 'C']) { const path = resolve(data, `${name}.txt`); await writeFile(path, `PRIVATE-${name} 原文参考，人物、情节不进入创作。`, 'utf8'); paths.push(path); }
  const invalid = resolve(data, 'invalid.txt'); await writeFile(invalid, Buffer.from([0xff, 0xfe, 0xfd])); paths.push(invalid);
  await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, paths);
  await library.getByRole('button', { name: '批量上传参考小说', exact: true }).click();
  let upload = page.getByRole('dialog', { name: '核对上传的参考小说' });
  await expect(upload.getByRole('alert')).toContainText('UTF-8');
  await upload.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await call('book:get', { id: book.id })).writingProfiles?.length || 0, 0);
  await library.getByRole('button', { name: '批量上传参考小说', exact: true }).click();
  upload = page.getByRole('dialog', { name: '核对上传的参考小说' });
  await upload.getByRole('button', { name: '保存有效参考' }).click();
  await expect(library.locator('.writing-profile-row')).toHaveCount(3);
  for (const name of ['A', 'B', 'C']) {
    const row = library.locator('.writing-profile-row').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(library.getByRole('checkbox', { name, exact: true })).toBeDisabled();
    await row.getByRole('button', { name: 'AI 蒸馏', exact: true }).click();
    await expect(page.locator('.candidate-text')).toContainText(`FULL-${name}-END`);
    await page.getByRole('button', { name: '采用结果', exact: true }).click();
    await expect(library.getByRole('checkbox', { name, exact: true })).toBeEnabled();
  }
  for (const name of ['A', 'B', 'C']) await library.getByRole('checkbox', { name, exact: true }).check();
  const blend = library.getByRole('region', { name: '本书风格融合', exact: true });
  await expect(blend.getByRole('slider')).toHaveCount(2);
  await blend.getByRole('button', { name: '平均分配' }).click();
  await expect(blend.getByRole('spinbutton', { name: 'A 参考占比' })).toHaveValue('34');
  const first = blend.getByRole('slider').first();
  await first.focus(); await page.keyboard.press('ArrowRight');
  await expect(blend.getByRole('spinbutton', { name: 'A 参考占比' })).toHaveValue('35');
  await expect(blend.getByRole('spinbutton', { name: 'B 参考占比' })).toHaveValue('32');
  await expect(blend.getByRole('spinbutton', { name: 'C 参考占比' })).toHaveValue('33');
  const box = await first.boundingBox(), track = await blend.locator('.style-blend-track').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(track.x + track.width * .45, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
  await expect(blend.getByRole('spinbutton', { name: 'A 参考占比' })).toHaveValue('45');
  await expect(blend.getByRole('spinbutton', { name: 'C 参考占比' })).toHaveValue('33');
  const zero = blend.getByRole('spinbutton', { name: 'C 参考占比' }); await zero.fill('0'); await zero.press('Enter');
  await expect(zero).toHaveValue('0');
  await expect(blend.getByRole('slider').first()).toBeEnabled();
  book = await call('book:get', { id: book.id });
  const [a, b, c] = book.writingProfiles;
  assert.equal(book.writingSelection.styleWeights[c.id], 0);
  assert.equal(Object.values(book.writingSelection.styleWeights).reduce((a, b) => a + b, 0), 100);
  const before = requests.length;
  // Both controls persist the same selection; changing weights alone never calls AI.
  await page.getByRole('button', { name: '章节正文', exact: true }).click();
  await page.getByRole('button', { name: /^选择写作风格与要求/ }).click();
  const picker = page.getByRole('region', { name: '风格参考', exact: true });
  await expect(picker.getByRole('spinbutton', { name: 'C 参考占比' })).toHaveValue('0');
  assert.equal(requests.length, before);
  const job = await call('ai:generate', { bookId: book.id, chapterId: book.chapters[0].id, kind: 'write', skillIds: [], analyzeChanges: false });
  await expect.poll(async () => (await call('book:get', { id: book.id })).candidates.find(row => row.id === job.id)?.status).toBe('done');
  const sent = JSON.stringify(requests.findLast(input => input.messages.some(row => row.content.includes('根据本章大纲创作本章正文'))));
  assert.ok(sent.includes('FULL-A-END') && sent.includes('FULL-B-END'));
  assert.ok(!sent.includes('FULL-C-END') && !sent.includes('PRIVATE-'));
  const done = (await call('book:get', { id: book.id })).candidates.find(row => row.id === job.id);
  assert.deepEqual(done.context.writingReferences.map(row => row.weight), [book.writingSelection.styleWeights[a.id], book.writingSelection.styleWeights[b.id]]);
  await page.getByRole('tab', { name: '功能', exact: true }).click();
  await page.getByRole('button', { name: '风格档案', exact: true }).click();
  const cShare = blend.getByRole('spinbutton', { name: 'C 参考占比' }); await cShare.fill('20'); await cShare.press('Enter');
  await expect(blend.getByRole('slider').first()).toBeEnabled();
  book = await call('book:get', { id: book.id });
  assert.equal(book.writingSelection.styleWeights[c.id], 20);
  assert.equal(book.candidates.find(row => row.id === job.id).context.writingReferences.length, 2);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [1464, 1024, 560]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 560) {
        const close = page.locator('.assistant-panel .assistant-drawer-close');
        if (await page.locator('.assistant-drawer-trigger').getAttribute('aria-expanded') === 'true') await close.click();
      }
      await blend.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: resolve(data, `blend-${theme}-${width}.png`) });
    }
  }
  await app.close(); app = await electron.launch({ args: ['.'], env }); page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  const reopened = await call('book:get', { id: book.id });
  assert.deepEqual(reopened.writingSelection, book.writingSelection);
  assert.deepEqual(errors, []);
  await writeFile(resolve(data, 'result.json'), JSON.stringify({ status: 'passed', requests: requests.length, checks: ['new book routing', 'batch preview and cancellation', 'invalid file isolation', 'independent distillation and adoption', 'two handles for three styles', 'keyboard and pointer adjustment', 'numeric zero exclusion', 'shared picker state', 'weighted full model context', 'candidate snapshot', 'themes and widths', 'restart persistence'] }, null, 2));
  console.log(`Style blend desktop passed: ${data}`);
} finally { if (app) await app.close(); server.close(); }
