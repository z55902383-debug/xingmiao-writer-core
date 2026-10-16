import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const folder = resolve('test-results/style-layout'); await mkdir(folder, { recursive: true });
const data = await mkdtemp(resolve(folder, 'run-'));
const env = { ...process.env, XM_TEST: '1', XM_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE; delete env.XM_DEV_URL;
const errors = [], checks = [];
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  const call = (action, args = {}) => page.evaluate(async ({ action, args }) => { const result = await window.xingmiao.invoke(action, args); if (!result.ok) throw Error(result.error); return result.data; }, { action, args });
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  let book = await call('book:create', { title: '风格板块布局专项', writingMode: 'imitate' });
  const names = ['克制叙述 · 以行动呈现人物心理', '生活化对白 · 关系反差与轻喜剧节奏', '环境氛围与信息揭露的长名称参考'.repeat(3)];
  for (const name of names) book = await call('writing:save', { bookId: book.id, profile: { title: name, kind: 'style', body: '限知视角，简洁叙述，以行动与对白推进场景。', source: '参考原文，仅供独立分析。', sourceName: `${name}.txt` } });
  book = await call('writing:save', { bookId: book.id, profile: { title: '待分析的对标小说', kind: 'style', body: '', source: '新的参考原文', sourceName: '参考.txt' } });
  const ids = book.writingProfiles.slice(0, 3).map(row => row.id);
  await call('writing:select', { bookId: book.id, selection: { styleIds: ids, requirementIds: [], styleWeights: { [ids[0]]: 50, [ids[1]]: 30, [ids[2]]: 20 } } });
  await page.reload(); await page.getByRole('button', { name: /继续.*风格板块布局专项/ }).click();
  await page.getByRole('tab', { name: '功能', exact: true }).click(); await page.getByRole('button', { name: '风格档案', exact: true }).click();
  const library = page.getByRole('region', { name: '写作资料库', exact: true });
  const blend = library.getByRole('region', { name: '本书风格融合', exact: true });
  await expect(library.getByLabel('本书创作方式', { exact: true })).toHaveCount(0);
  const tags = library.getByRole('group', { name: '快速选择风格', exact: true });
  await expect(tags.getByRole('button')).toHaveCount(4);
  await expect(tags.getByRole('button', { name: '待分析的对标小说', exact: true })).toBeDisabled();
  await expect(tags.getByRole('button', { name: names[0], exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(library.getByRole('button', { name: /1 篇参考待蒸馏或填写/ })).toBeVisible();
  await library.getByRole('button', { name: /1 篇参考待蒸馏或填写/ }).click();
  await expect(library.getByLabel('资料状态', { exact: true })).toHaveValue('pending');
  await expect(library.locator('.writing-profile-row')).toHaveCount(1);
  await library.getByRole('button', { name: '选择风格', exact: true }).click();
  await expect(library.getByLabel('资料状态', { exact: true })).toHaveValue('all');
  await expect(library.locator('.writing-profile-row')).toHaveCount(4);
  assert.equal(await library.getByRole('checkbox', { name: names[0], exact: true }).count(), 1);
  checks.push('pending filter and choose-style destination', 'one selectable row per style');

  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const [width, height] of [[1464, 900], [1024, 768], [560, 800]]) {
      await page.setViewportSize({ width, height });
      if (await page.locator('.assistant-drawer-trigger').isVisible() && await page.locator('.assistant-drawer-trigger').getAttribute('aria-expanded') === 'true') await page.locator('.assistant-panel .assistant-drawer-close').click();
      await blend.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await blend.locator('.style-blend-legend').evaluate(element => element.scrollWidth <= element.clientWidth));
      await page.screenshot({ path: resolve(data, `layout-${theme}-${width}.png`) });
    }
  }
  checks.push('long names without overflow', 'themes and narrow windows');
  await page.setViewportSize({ width: 1464, height: 900 });
  assert.ok((await library.getByRole('region', { name: '本书使用的风格', exact: true }).boundingBox()).height <= 180, 'three-style configuration stays compact');
  await expect(library.getByRole('heading', { name: '从参考小说提炼风格', exact: true })).toBeVisible();
  assert.deepEqual((await call('book:get', { id: book.id })).writingSelection.styleIds, ids);
  await blend.scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(data, 'original.png') });

  await tags.getByRole('button', { name: names[1], exact: true }).click();
  await expect(library.getByRole('checkbox', { name: names[1], exact: true })).not.toBeChecked();
  await tags.getByRole('button', { name: names[2], exact: true }).click();
  await expect(blend.getByRole('slider')).toHaveCount(0);
  await expect(blend.getByRole('spinbutton', { name: `${names[0]} 参考占比`, exact: true })).toHaveValue('100');
  await expect(blend.locator('.style-blend-track')).toHaveCount(1);
  assert.ok((await library.getByRole('region', { name: '本书使用的风格', exact: true }).boundingBox()).height <= 140, 'single-style configuration leaves room for profiles');
  await blend.scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(data, 'single-style.png') });
  checks.push('single style retains a visible 100% track');
  await tags.getByRole('button', { name: names[1], exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(tags.getByRole('button', { name: names[1], exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(library.getByRole('checkbox', { name: names[1], exact: true })).toBeChecked();
  await expect(blend.getByRole('slider')).toHaveCount(1);
  await tags.getByRole('button', { name: names[1], exact: true }).click();
  await tags.getByRole('button', { name: names[0], exact: true }).click();
  checks.push('title tags support click, keyboard, deselection, pending state and synchronized blend');
  await expect(library).toContainText('尚未选择参考风格');
  await expect(library.getByRole('region', { name: '本书风格融合', exact: true })).toHaveCount(0);
  checks.push('no-selection state');
  assert.deepEqual(errors, []);
  await writeFile(resolve(data, 'result.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
  console.log(`Style layout desktop passed: ${data}`);
} finally { await app.close(); }
