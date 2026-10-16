import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('test-results/style-sync'); await mkdir(output, { recursive: true });
const data = await mkdtemp(resolve(output, 'run-'));
const env = { ...process.env, XM_TEST: '1', XM_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.XM_DEV_URL;
const errors = [], checks = [];
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  const call = (action, args = {}) => page.evaluate(async ({ action, args }) => { const result = await window.xingmiao.invoke(action, args); if (!result.ok) throw Error(result.error); return result.data; }, { action, args });
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  let book = await call('book:create', { title: '双侧风格同步专项', writingMode: 'imitate' });
  for (let i = 0; i < 18; i++) book = await call('writing:save', { bookId: book.id, profile: { title: ['克制叙述', '轻快对白', '环境氛围'][i] || `备用风格${i}`, kind: 'style', body: '视角、语言、对白与叙事节奏。'.repeat(12), source: '参考小说原文', sourceName: `参考${i}.txt` } });
  const [a, b, c] = book.writingProfiles;
  await call('writing:select', { bookId: book.id, selection: { styleIds: [a.id, b.id, c.id], requirementIds: [], styleWeights: { [a.id]: 50, [b.id]: 30, [c.id]: 20 } } });
  await page.reload(); await page.getByRole('button', { name: /继续.*双侧风格同步专项/ }).click();
  await page.getByRole('tab', { name: '功能', exact: true }).click(); await page.getByRole('button', { name: '风格档案', exact: true }).click();
  const library = page.getByRole('region', { name: '写作资料库', exact: true });
  const main = library.getByRole('region', { name: '本书风格融合', exact: true });
  const picker = page.getByRole('region', { name: '风格参考', exact: true });
  const side = picker.getByRole('region', { name: '本书风格融合', exact: true });
  const mainInput = main.getByRole('spinbutton', { name: '克制叙述 参考占比', exact: true });
  const sideInput = side.getByRole('spinbutton', { name: '克制叙述 参考占比', exact: true });
  await expect(main.locator('.style-blend-track')).toBeVisible();
  await expect(side.locator('.style-blend-track')).toBeVisible();
  const mainTrack = await main.locator('.style-blend-track').boundingBox();
  const sideTrack = await side.locator('.style-blend-track').boundingBox();
  assert.ok(mainTrack.width > sideTrack.width * 1.5);
  checks.push('large central track and compact assistant track are both visible');
  const scroll = library.locator('.writing-materials-scroll');
  const panelBefore = await main.boundingBox();
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => main.boundingBox()).toEqual(panelBefore);
  await expect(main.getByRole('slider').first()).toBeVisible();
  checks.push('browsing long profile list keeps the large slider fixed');

  async function dragAndCheck(source, target, value) {
    const slider = source.getByRole('slider').first(); await slider.scrollIntoViewIfNeeded();
    const handle = await slider.boundingBox(); const track = await source.locator('.style-blend-track').boundingBox();
    const persisted = (await call('book:get', { id: book.id })).writingSelection.styleWeights[a.id];
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
    await page.mouse.move(track.x + track.width * value / 100, handle.y + handle.height / 2, { steps: 4 });
    await expect(target.getByRole('spinbutton', { name: '克制叙述 参考占比', exact: true })).toHaveValue(String(value));
    assert.equal((await call('book:get', { id: book.id })).writingSelection.styleWeights[a.id], persisted, 'live preview does not save on every pointer move');
    await page.mouse.up();
    await expect.poll(async () => (await call('book:get', { id: book.id })).writingSelection.styleWeights[a.id]).toBe(value);
    await expect(mainInput).toHaveValue(String(value)); await expect(sideInput).toHaveValue(String(value));
    await expect(main.getByRole('slider').first()).toBeEnabled();
  }
  await dragAndCheck(main, side, 60);
  await dragAndCheck(side, main, 45);
  checks.push('dragging either side previews on the other before release and saves on release');
  await sideInput.fill('65'); await sideInput.press('Enter');
  await expect(mainInput).toHaveValue('65'); await expect(main.getByRole('slider').first()).toBeEnabled();
  await mainInput.fill('55'); await mainInput.press('Enter');
  await expect(sideInput).toHaveValue('55'); await expect(main.getByRole('slider').first()).toBeEnabled();
  checks.push('numeric changes synchronize both ways');
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const [width, height] of [[1464, 900], [1024, 600], [560, 800]]) {
      await page.setViewportSize({ width, height });
      if (await page.locator('.assistant-drawer-trigger').isVisible() && await page.locator('.assistant-drawer-trigger').getAttribute('aria-expanded') === 'true') await page.locator('.assistant-panel .assistant-drawer-close').click();
      await scroll.evaluate(el => { el.scrollTop = 0; });
      const area = await scroll.boundingBox(); assert.ok(area.height > 90, 'profile list has usable scrolling space');
      await expect(main.locator('.style-blend-track')).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: resolve(data, `sync-${theme}-${width}.png`), animations: 'disabled' });
    }
  }
  await page.setViewportSize({ width: 1464, height: 900 });
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(main.locator('.style-blend-track')).toBeVisible();
  assert.deepEqual(errors, []);
  await writeFile(resolve(data, 'result.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
  console.log(`Style sync desktop passed: ${data}`);
} finally { await app.close(); }
