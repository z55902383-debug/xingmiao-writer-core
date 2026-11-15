import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('test-results/studio-design');
await mkdir(root, { recursive: true });
const output = await mkdtemp(join(root, 'run-'));
const env = { ...process.env, XM_TEST: '1', XM_DATA_DIR: join(output, 'data') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
const app = await electron.launch({ args: ['.'], env });
const report = { errors: [], checks: [], output };
try {
  const page = await app.firstWindow();
  page.on('pageerror', e => report.errors.push(e.message));
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  const call = (action, args) => page.evaluate(async ({ action, args }) => {
    const result = await window.xingmiao.invoke(action, args);
    if (!result.ok) throw Error(result.error);
    return result.data;
  }, { action, args });
  for (let i = 0; i < 9; i++) await call('book:create', {
    title: i === 8 ? '这是一部书名很长的小说：在雨夜重逢之后我们终于找回了遗失的信件' : `工作室验收作品 ${i + 1}`,
    genre: i % 2 ? '悬疑' : '都市', premise: '旧书店的主人收到一封寄自十年前的信。'.repeat(12), target: 200000,
  });
  await page.reload();
  await expect(page.locator('.book-card')).toHaveCount(9);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const [width, height] of [[1464, 900], [1280, 720], [1024, 768], [1024, 600], [760, 800], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(180);
      const bounds = await page.evaluate(() => {
        const library = document.querySelector('.shelf-library');
        return { overflow: document.documentElement.scrollWidth - innerWidth,
          libraryWidth: library.clientWidth, libraryScrollWidth: library.scrollWidth,
          libraryHeight: library.clientHeight };
      });
      assert.ok(bounds.overflow <= 1, `${theme} ${width}x${height}: page overflow ${bounds.overflow}`);
      assert.ok(bounds.libraryScrollWidth <= bounds.libraryWidth + 2, `${theme} ${width}: library horizontal overflow`);
      assert.ok(bounds.libraryHeight >= 120, `${theme} ${width}x${height}: library too short`);
      await page.getByRole('button', { name: '新建作品', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '开始一个新的故事' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: '创建作品', exact: true })).toBeInViewport();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: '新建作品', exact: true })).toBeFocused();
      report.checks.push({ theme, width, height, ...bounds, modalAndFocus: 'passed' });
      if (width >= 1024) await page.screenshot({ path: join(output, `shelf-${theme}-${width}-${height}.png`) });
    }
  }
  await page.setViewportSize({ width: 1464, height: 900 });
  await page.getByRole('textbox', { name: '搜索作品' }).fill('没有这部小说');
  await expect(page.getByText('没有找到作品', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.locator('.book-card')).toHaveCount(9);
  await page.locator('.shelf-layout-picker summary').click();
  await page.locator('.shelf-layout-option').filter({ hasText: '紧凑列表' }).click();
  await expect(page.locator('.book-grid')).toHaveClass(/compact/);
  await page.locator('.shelf-layout-picker summary').click();
  await page.locator('.shelf-layout-option').filter({ hasText: '舒展卡片' }).click();
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
  report.status = 'passed';
} catch (e) {
  report.status = 'failed'; report.failure = e.stack; process.exitCode = 1;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  console.log(JSON.stringify(report, null, 2));
}
