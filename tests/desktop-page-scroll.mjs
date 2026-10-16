import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';

const folder = resolve('test-results/page-scroll'); await mkdir(folder, { recursive: true });
const data = await mkdtemp(resolve(folder, 'run-'));
const env = { ...process.env, XM_TEST: '1', XM_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.XM_DEV_URL;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow(), errors = []; page.on('pageerror', e => errors.push(e.message));
  const call = (action, data = {}) => page.evaluate(async ({ action, data }) => {
    const result = await window.xingmiao.invoke(action, data); if (!result.ok) throw Error(result.error); return result.data;
  }, { action, data });
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  const controls = async selectors => Promise.all(selectors.map(async selector => ({ selector, y: (await page.locator(selector).boundingBox()).y })));
  async function verifyScroll(region, selectors, label) {
    await expect(region).toBeVisible();
    const measure = await region.evaluate(el => ({ height: el.clientHeight, scrollHeight: el.scrollHeight }));
    assert.ok(measure.height >= 120, `${label}: list area too small: ${measure.height}`);
    assert.ok(measure.scrollHeight > measure.height + 20, `${label}: fixture must overflow`);
    await expect.poll(() => page.locator('.plaza-page, .toolbox-shell').evaluateAll(nodes => nodes.flatMap(node => node.getAnimations()).filter(animation => animation.playState === 'running').length)).toBe(0);
    const before = await controls(selectors);
    await region.hover(); await page.mouse.wheel(0, 1500);
    await expect.poll(() => region.evaluate(el => el.scrollTop)).toBeGreaterThan(50);
    for (const item of before) assert.ok(Math.abs((await page.locator(item.selector).boundingBox()).y - item.y) < 1, `${label}: ${item.selector} moved from ${item.y} to ${(await page.locator(item.selector).boundingBox()).y}`);
    await region.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await region.hover(); await page.mouse.wheel(0, 2500);
    const root = await page.evaluate(() => ({ page: document.scrollingElement.scrollTop, parent: document.querySelector('.shelf-main')?.scrollTop || 0, toolbox: document.querySelector('.toolbox-shell')?.scrollTop || 0 }));
    assert.deepEqual(root, { page: 0, parent: 0, toolbox: 0 }, `${label}: scroll escaped collection`);
    await region.evaluate(el => { el.scrollTop = 0; });
  }
  for (let i = 0; i < 24; i++) {
    const b = await call('book:create', { title: '滚动验证作品 ' + i });
    if (i >= 12) await call('book:update', { id: b.id, patch: { archived: true } });
  }
  await page.reload();
  await verifyScroll(page.locator('.shelf-library'), ['.shelf-heading', '.shelf-tools', '.shelf-top'], 'shelf');
  await page.getByRole('button', { name: /已归档/ }).click();
  await verifyScroll(page.locator('.shelf-library'), ['.shelf-heading', '.shelf-tools', '.shelf-top'], 'archive');
  await page.getByRole('button', { name: '模型与设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '模型与本地设置', exact: true });
  await settings.getByRole('button', { name: '写作 Skill', exact: true }).click();
  await verifyScroll(settings.locator('.settings-content'), ['.modal-head', '.settings-nav'], 'settings');
  await settings.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: /人工码字板/ }).click();
  const manual = page.locator('.mt-textarea');
  await manual.fill(Array.from({ length: 120 }, (_, i) => `第${i}段：风穿过长街，灯光照着窗边的稿纸。`).join('\n\n'));
  await manual.evaluate(el => { el.scrollTop = 0; });
  await verifyScroll(manual, ['.mt-header', '.mt-document-head'], 'manual writing');
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log('Page scroll regions passed: fixed controls, content-only wheel and boundary containment for shelf/archive/settings/manual. ' + data);
} finally { await app.close(); }
