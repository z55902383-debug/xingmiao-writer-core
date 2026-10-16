import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('test-results/style-blend-edges');
await mkdir(output, { recursive: true });
const data = await mkdtemp(resolve(output, 'run-'));
const results = [], errors = [], requests = [];
let failNextModel = false;
const server = createServer(async (req, res) => {
  let raw = ''; for await (const part of req) raw += part;
  const input = JSON.parse(raw); requests.push(input);
  if (failNextModel) { failNextModel = false; res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: '测试服务暂时不可用' } })); return; }
  const content = '独立蒸馏：限知视角、简洁对白，通过人物行动推进场景。';
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end('data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const env = { ...process.env, XM_TEST: '1', XM_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE; delete env.XM_DEV_URL;
let app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  const call = (action, args = {}) => page.evaluate(async ({ action, args }) => {
    const result = await window.xingmiao.invoke(action, args);
    if (!result.ok) throw Error(result.error); return result.data;
  }, { action, args });
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  await call('config:save', { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture', name: '边界测试模型', maxTokens: 4096 });
  let book = await call('book:create', { title: '融合边界专项', writingMode: 'imitate', premise: '原创故事方向' });
  for (const title of ['A', 'B', 'C']) book = await call('writing:save', { bookId: book.id, profile: { kind: 'style', title, body: `STYLE-${title}`, source: `PRIVATE-${title}`, sourceName: `${title}.txt` } });
  book = await call('writing:save', { bookId: book.id, profile: { kind: 'requirement', title: '独立写作要求', body: '要求保持场景衔接', source: '', sourceName: '' } });
  const [a, b, c, r] = book.writingProfiles;
  const ids = [a.id, b.id, c.id];
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('xm:invoke');
    globalThis.blendEdge = { delay: 0, fail: false, active: false };
    ipcMain.removeHandler('xm:invoke');
    ipcMain.handle('xm:invoke', async (...args) => {
      if (args[1] === 'writing:select') {
        const mode = globalThis.blendEdge;
        mode.active = true;
        try {
          if (mode.delay) await new Promise(done => setTimeout(done, mode.delay));
          if (mode.fail) { mode.fail = false; return { ok: false, error: '测试保存失败，原比例保留' }; }
          return await original(...args);
        } finally { mode.active = false; }
      }
      return original(...args);
    });
  });
  const mode = value => app.evaluate((_, value) => Object.assign(globalThis.blendEdge, value), value);
  async function fresh(values = [50, 30, 20]) {
    await mode({ delay: 0, fail: false });
    await call('writing:select', { bookId: book.id, selection: { styleIds: ids, requirementIds: [r.id], styleWeights: Object.fromEntries(ids.map((id, i) => [id, values[i]])) } });
    await page.reload();
    await page.getByRole('button', { name: /继续.*融合边界专项/ }).click();
    await page.getByRole('tab', { name: '功能', exact: true }).click();
    await page.getByRole('button', { name: '风格档案', exact: true }).click();
  }
  const library = page.getByRole('region', { name: '写作资料库', exact: true });
  const blend = library.getByRole('region', { name: '本书风格融合', exact: true });
  const share = name => blend.getByRole('spinbutton', { name: `${name} 参考占比`, exact: true });
  async function check(name, fn) {
    try { await fn(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, status: 'failed', error: error.message.split('\n').slice(0, 8).join('\n') }); console.log(`FAIL ${name}: ${error.message.split('\n')[0]}`); }
  }

  await fresh();
  await check('写作要求不能混入风格选择列表', async () => {
    await expect(library.getByRole('region', { name: '本书使用的风格', exact: true }).getByRole('checkbox', { name: '独立写作要求', exact: true })).toHaveCount(0, { timeout: 1000 });
  });
  await fresh([100, 0, 0]);
  await check('输入越界值归正后显示与保存一致', async () => {
    await share('A').fill('200'); await share('A').press('Enter');
    await expect(share('A')).toHaveValue('100', { timeout: 1000 });
    await share('B').fill('-10'); await share('B').press('Enter');
    await expect(share('B')).toHaveValue('0', { timeout: 1000 });
    await share('A').fill('99.8'); await share('A').press('Enter');
    await expect(share('A')).toHaveValue('100');
  });
  await fresh([100, 0, 0]);
  await check('零占比重叠滑块不挡住可移动的分隔点', async () => {
    await blend.getByRole('slider').first().scrollIntoViewIfNeeded();
    const handle = await blend.getByRole('slider').first().boundingBox();
    const track = await blend.locator('.style-blend-track').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
    await page.mouse.move(track.x + track.width * .7, handle.y + handle.height / 2, { steps: 4 }); await page.mouse.up();
    await expect(share('A')).toHaveValue('70', { timeout: 1000 });
    await expect(share('B')).toHaveValue('30'); await expect(share('C')).toHaveValue('0');
  });
  await fresh();
  await check('保存比例未完成时不能用旧比例开始生成', async () => {
    await page.getByRole('tab', { name: '创作正文', exact: true }).click();
    await page.getByRole('checkbox', { name: '正文生成后自动分析故事变化', exact: true }).uncheck();
    await mode({ delay: 1500 });
    await share('A').fill('60'); await share('A').press('Enter');
    await expect.poll(() => app.evaluate(() => globalThis.blendEdge.active)).toBe(true);
    await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeDisabled({ timeout: 500 });
  });
  await expect.poll(() => app.evaluate(() => globalThis.blendEdge.active)).toBe(false);
  await check('保存完成后按新比例生成并经确认采用正文', async () => {
    await page.getByRole('button', { name: '开始生成', exact: true }).click();
    await expect(page.locator('.candidate-text')).toContainText('独立蒸馏');
    const current = await call('book:get', { id: book.id });
    const job = current.candidates.find(row => row.kind === 'write');
    assert.equal(job.context.writingReferences.find(row => row.id === a.id).weight, 60);
    assert.deepEqual(job.context.writingReferences.filter(row => row.kind === 'style').map(row => row.weight), [60, 24, 16]);
    assert.ok(!JSON.stringify(requests.at(-1)).includes('PRIVATE-'));
    assert.equal(current.chapters[0].body, '');
    await page.getByRole('button', { name: '采用结果', exact: true }).click();
    await expect.poll(async () => (await call('book:get', { id: book.id })).chapters[0].body).toContain('独立蒸馏');
  });
  await fresh();
  await check('中央占比保存失败回滚显示且保留写作要求', async () => {
    await mode({ fail: true });
    await share('A').fill('60'); await share('A').press('Enter');
    await expect(blend.getByRole('alert')).toContainText('测试保存失败');
    await expect(share('A')).toHaveValue('50');
    const current = await call('book:get', { id: book.id });
    assert.equal(current.writingSelection.styleWeights[a.id], 50);
    assert.deepEqual(current.writingSelection.requirementIds, [r.id]);
  });
  await fresh();
  await check('右侧占比保存失败回滚显示且保留写作要求', async () => {
    await page.getByRole('button', { name: /^选择写作风格与要求/ }).click();
    const picker = page.getByRole('region', { name: '风格参考', exact: true });
    const input = picker.getByRole('spinbutton', { name: 'A 参考占比' });
    await mode({ fail: true }); await input.fill('65'); await input.press('Enter');
    await expect(input).toHaveValue('50');
    const current = await call('book:get', { id: book.id });
    assert.equal(current.writingSelection.styleWeights[a.id], 50);
    assert.deepEqual(current.writingSelection.requirementIds, [r.id]);
  });
  await fresh();
  await check('蒸馏后原文改变不能采用旧结果覆盖', async () => {
    const job = await call('ai:generate', { bookId: book.id, chapterId: book.chapters[0].id, kind: 'style', writingProfileId: a.id, analyzeChanges: false });
    await expect.poll(async () => (await call('book:get', { id: book.id })).candidates.find(row => row.id === job.id)?.status).toBe('done');
    const current = (await call('book:get', { id: book.id })).writingProfiles.find(row => row.id === a.id);
    await call('writing:save', { bookId: book.id, profile: { ...current, source: 'NEW SOURCE' } });
    await assert.rejects(() => call('ai:adopt', { id: job.id, mode: 'replace' }), /已修改或删除/);
    assert.equal((await call('book:get', { id: book.id })).writingProfiles.find(row => row.id === a.id).body, 'STYLE-A');
  });
  await fresh();
  await check('单篇蒸馏服务失败可重试且采用前不改变原档案', async () => {
    const row = library.locator('.writing-profile-row').filter({ has: page.getByRole('heading', { name: 'A', exact: true }) });
    failNextModel = true;
    await row.getByRole('button', { name: 'AI 蒸馏', exact: true }).click();
    await expect.poll(async () => (await call('book:get', { id: book.id })).candidates.find(job => job.kind === 'style')?.status).toBe('error');
    assert.equal((await call('book:get', { id: book.id })).writingProfiles.find(row => row.id === a.id).body, 'STYLE-A');
    await expect(row.getByRole('button', { name: 'AI 蒸馏', exact: true })).toBeEnabled();
    await row.getByRole('button', { name: 'AI 蒸馏', exact: true }).click();
    await expect(page.locator('.candidate-text')).toContainText('独立蒸馏');
    assert.equal((await call('book:get', { id: book.id })).writingProfiles.find(row => row.id === a.id).body, 'STYLE-A');
    await page.getByRole('button', { name: '采用结果', exact: true }).click();
    const current = await call('book:get', { id: book.id });
    assert.match(current.writingProfiles.find(row => row.id === a.id).body, /独立蒸馏/);
    assert.equal(current.writingProfiles.find(row => row.id === b.id).body, 'STYLE-B');
  });
  await fresh();
  await check('粘贴新参考后保存并蒸馏不会被保存锁拦住', async () => {
    await library.getByRole('button', { name: '粘贴参考原文', exact: true }).click();
    const modal = page.getByRole('dialog', { name: '编辑写作风格', exact: true });
    await modal.getByRole('textbox', { name: '名称', exact: true }).fill('新参考D');
    await modal.getByRole('textbox', { name: '蒸馏参考原文', exact: true }).fill('PRIVATE-D 新参考原文');
    await modal.getByRole('button', { name: '保存并蒸馏', exact: true }).click();
    await expect(page.locator('.candidate-text')).toContainText('独立蒸馏');
    await page.getByRole('button', { name: '采用结果', exact: true }).click();
    const current = await call('book:get', { id: book.id });
    assert.match(current.writingProfiles.find(row => row.title === '新参考D').body, /独立蒸馏/);
  });
  await check('实际备份恢复保留每篇原文、占比与作品模式且不覆盖原书', async () => {
    const backup = resolve(data, 'backup.json');
    const before = await call('book:get', { id: book.id });
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, backup);
    await call('backup:save');
    assert.equal(await call('backup:restore'), 1);
    const copy = (await call('books:list')).find(row => row.id !== book.id);
    assert.ok(copy);
    const restored = await call('book:get', { id: copy.id });
    assert.equal(restored.writingMode, 'imitate');
    assert.deepEqual(restored.writingSelection, before.writingSelection);
    assert.deepEqual(restored.writingProfiles.map(row => [row.title, row.source, row.body]), before.writingProfiles.map(row => [row.title, row.source, row.body]));
    assert.deepEqual((await call('book:get', { id: book.id })).writingProfiles, before.writingProfiles);
  });
  assert.deepEqual(errors, []);
  await writeFile(resolve(data, 'result.json'), JSON.stringify({ results, requests: requests.length, errors }, null, 2));
  console.log(`Edge results: ${data}`);
  if (results.some(row => row.status === 'failed')) process.exitCode = 1;
} finally { if (app) await app.close(); server.close(); }
