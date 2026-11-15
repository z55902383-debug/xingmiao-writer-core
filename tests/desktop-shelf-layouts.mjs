import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('test-results/shelf-layouts'); await mkdir(root, { recursive: true });
const output = await mkdtemp(join(root, 'run-'));
const env = { ...process.env, XM_TEST: '1', XM_DATA_DIR: join(output, 'data') };
delete env.ELECTRON_RUN_AS_NODE; delete env.XM_DEV_URL;
let app = await electron.launch({ args: ['.'], env });
const checks = [], errors = [];
try {
  let page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  const ready = async () => { await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible(); await expect(page.locator('.startup-splash')).toHaveCount(0); };
  await ready();
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 400;
    const x = c.getContext('2d');
    const titles = ['雨夜的信件', '零温区：寄生纪元', '我看校花是兄弟，校花看我是闺蜜', '末班车上的失物招领'];
    for (let i = 0; i < 18; i++) {
      const result = await window.xingmiao.invoke('book:create', { title: titles[i % 4] + (i > 3 ? ` ${i + 1}` : ''), genre: '悬疑', premise: '一封寄自十年前的信，改变了旧书店主人的生活。'.repeat(5) });
      if (!result.ok) throw Error(result.error);
      if (i % 3 !== 0) {
        x.fillStyle = ['#354c51', '#51433c', '#344358'][i % 3]; x.fillRect(0, 0, 300, 400);
        x.fillStyle = '#ece0c9'; x.font = '28px serif'; x.fillText('雨夜的信件', 24, 90); x.fillRect(24, 260, 252, 2);
        await window.xingmiao.invoke('book:update', { id: result.data.id, patch: { cover: { src: c.toDataURL('image/jpeg'), zoom: 1, x: 50, y: 50 } } });
      }
    }
    localStorage.setItem('xm-shelf-view', JSON.stringify({ sort: 'title', compact: true }));
  });
  await page.reload(); await ready();
  await expect(page.locator('.book-grid')).toHaveClass(/layout-compact/);
  for (const [layout, name] of [['cards', '舒展卡片'], ['compact', '紧凑列表'], ['covers', '封面书墙'], ['dense', '密集图文']]) {
    await page.locator('.shelf-layout-picker summary').click();
    await expect(page.locator('.shelf-layout-option')).toHaveCount(4);
    await page.locator('.shelf-layout-option').filter({ hasText: name }).click();
    await expect(page.locator('.book-grid')).toHaveClass(new RegExp(`layout-${layout}`));
    await page.reload(); await ready();
    await expect(page.locator('.book-grid')).toHaveClass(new RegExp(`layout-${layout}`));
    for (const theme of ['dark', 'light']) for (const [width, height] of [[1464, 900], [1024, 600], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
      const measure = await page.evaluate(() => {
        const library = document.querySelector('.shelf-library');
        return { overflow: document.documentElement.scrollWidth - innerWidth,
          listOverflow: library.scrollWidth - library.clientWidth,
          ratios: [...document.querySelectorAll('.book-card .book-cover')].map(el => { const r = el.getBoundingClientRect(); return r.width / r.height; }) };
      });
      assert.ok(measure.overflow <= 1 && measure.listOverflow <= 2, `${layout} ${width}: overflow`);
      assert.ok(measure.ratios.every(r => Math.abs(r - .75) < .01), `${layout} ${width}: ratio`);
      if (width === 1464) await page.screenshot({ path: join(output, `${layout}-${theme}.png`) });
      checks.push({ layout, theme, width, height, passed: true });
    }
    await page.setViewportSize({ width: 1464, height: 900 });
    await page.locator('.book-head summary').first().click();
    await expect(page.getByRole('button', { name: '编辑封面', exact: true }).or(page.getByRole('button', { name: '上传封面', exact: true }))).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('.book-cover').first().click();
    await expect(page.getByRole('button', { name: '返回书架', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回书架', exact: true }).click();
    await expect(page.locator('.book-grid')).toHaveClass(new RegExp(`layout-${layout}`));
  }
  await app.evaluate(({ app }) => app.exit(0));
  app = await electron.launch({ args: ['.'], env }); page = await app.firstWindow(); await ready();
  await expect(page.locator('.book-grid')).toHaveClass(/layout-dense/);
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, restartPersistence: true, legacyPreference: true, errors }, null, 2));
  console.log('Four shelf layouts passed: ' + output);
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
