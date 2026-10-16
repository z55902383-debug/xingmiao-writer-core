import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('test-results/imitation-layout');
await mkdir(root, { recursive: true });
const data = await mkdtemp(resolve(root, 'run-'));
const env = { ...process.env, XM_TEST: '1', XM_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE; delete env.XM_DEV_URL;
const app = await electron.launch({ args: ['.'], env });
const errors = [];
try {
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  const call = (action, args = {}) => page.evaluate(async ({ action, args }) => {
    const r = await window.xingmiao.invoke(action, args); if (!r.ok) throw Error(r.error); return r.data;
  }, { action, args });
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  let book = await call('book:create', { title: '新增界面审查', creationMode: 'short' });
  book = await call('book:update', { id: book.id, patch: { style: '本书文风：克制叙述', reference: '旧风格参考小说' } });
  async function openBook() {
    await page.reload(); await page.getByRole('button', { name: /继续.*新增界面审查/ }).click();
    await page.getByRole('tab', { name: '功能', exact: true }).click();
    await page.getByRole('button', { name: '仿写对标', exact: true }).click();
  }
  await openBook();
  const library = page.getByRole('region', { name: '仿写对标管理', exact: true });
  const side = page.getByRole('region', { name: '仿写参考', exact: true });
  const toggle = side.getByRole('button', { name: /仿写故事对标/ });
  await expect(side.getByText('尚未添加故事对标', { exact: true })).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(library.getByLabel('本书创作方式',{exact:true})).toHaveCount(0);
  await expect(library.getByRole('region',{name:'本书使用的对标',exact:true})).toContainText('尚未选用故事对标');
  await side.getByRole('button', { name: '添加对标', exact: true }).click();
  await expect(library).toBeVisible();
  await toggle.focus(); await page.keyboard.press('Enter'); await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.press('Space'); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const snapshot = async name => page.screenshot({ path: resolve(data, name + '.png'), animations: 'disabled' });
  await snapshot('empty-desktop');
  for (const title of ['故事冲突与人物关系', '这是一篇名称很长的仿写对标参考小说用于检查换行和按钮拥挤问题', '待分析原文']) {
    book = await call('imitation:save', { bookId: book.id, profile: { title, source: '参考原文内容', sourceName: title + '.txt', body: title === '待分析原文' ? '' : '原作故事骨架与人物关系：主角寻找线索，与盟友产生目标冲突。\n对标建议：改变事件因果与人物选择，保留逐步揭密的推进方式。'.repeat(4) } });
  }
  const [a, b] = book.imitationProfiles;
  await call('imitation:select', { bookId: book.id, selection: { ids: [a.id, b.id], weights: { [a.id]: 60, [b.id]: 40 } } });
  await openBook();
  await page.locator('.compose-reference-trigger').click();
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await expect(page.getByRole('region',{name:'风格参考',exact:true}).locator('.writing-picker-toggle')).toHaveAttribute('aria-expanded','true');
  await page.locator('.compose-reference-trigger').click();
  const main = library.getByRole('region', { name: '仿写对标融合', exact: true });
  const sideBlend = side.getByRole('region', { name: '仿写对标融合', exact: true });
  // Collapsing source choices must retain both mixing controls.
  await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await expect(sideBlend.getByRole('slider')).toBeVisible();
  await toggle.click(); await expect(side.getByRole('button', { name: '待分析原文', exact: true })).toBeDisabled();
  await expect(side.getByRole('button', { name: a.title, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await toggle.click(); await expect(sideBlend.getByRole('slider')).toBeVisible();
  const statusFilter=library.getByLabel('资料状态',{exact:true});
  await statusFilter.selectOption('pending');await expect(library.locator('.imitation-profile-row')).toHaveCount(1);await expect(library.getByRole('checkbox',{name:'待分析原文',exact:true})).toBeDisabled();
  await library.getByRole('button',{name:'选择对标',exact:true}).click();await expect(statusFilter).toHaveValue('all');
  await statusFilter.selectOption('selected');await expect(library.locator('.imitation-profile-row')).toHaveCount(2);
  const query=library.getByLabel('搜索仿写对标',{exact:true});await query.fill('没有这篇小说');await expect(library.locator('.imitation-profile-row')).toHaveCount(0);await library.getByRole('button',{name:'清除筛选',exact:true}).click();await expect(query).toHaveValue('');await expect(statusFilter).toHaveValue('all');
  await library.getByRole('button',{name:/1 篇待分析或填写/}).click();await expect(statusFilter).toHaveValue('pending');await library.getByRole('button',{name:'选择对标',exact:true}).click();
  await expect(library.getByRole('heading',{name:'仿写对标库',exact:true})).toBeVisible();
  await page.getByRole('button', { name: /^选择写作风格与要求/ }).click();
  const style = page.getByRole('region', { name: '风格参考', exact: true });
  const styleBlend = style.getByRole('region', { name: '本书风格融合', exact: true });
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const [width, height] of [[1464, 900], [1024, 650], [560, 800]]) {
      await page.setViewportSize({ width, height });
      const trigger = page.locator('.assistant-drawer-trigger');
      if (await trigger.isVisible() && await trigger.getAttribute('aria-expanded') === 'true') await page.locator('.assistant-drawer-close').click();
      await library.locator('.imitation-materials').evaluate(el=>{el.scrollTop=0;});
      await expect(main.locator('.style-blend-track')).toBeVisible();
      const bounds=await main.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width,'main blend fits the viewport');
      const card = library.locator('.imitation-profile-row').first();
      const rect = await card.boundingBox(); const title = await card.locator('h4').boundingBox();
      assert.ok(title.x - rect.x >= 14, 'profile title has content padding');
      await snapshot(`main-${theme}-${width}`);
      if (await trigger.isVisible()) await trigger.click();
      await styleBlend.scrollIntoViewIfNeeded();
      const inset = await styleBlend.evaluate(el => { const outer = el.closest('.reference-disclosure').getBoundingClientRect(); const label = el.querySelector('.style-blend-legend').getBoundingClientRect(); const input = el.querySelector('input').getBoundingClientRect(); return { left: label.left - outer.left, right: outer.right - input.right }; });
      assert.ok(inset.left >= 12 && inset.right >= 12, 'style blend content stays inside disclosure padding');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow');
      await snapshot(`assistant-${theme}-${width}`);
    }
  }
  await page.setViewportSize({ width: 1464, height: 900 });
  await library.getByRole('button', { name: '新建仿写对标', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑仿写对标', exact: true });
  await expect(editor.getByLabel('对标名称', { exact: true })).toBeVisible();
  await snapshot('editor-desktop');
  await page.setViewportSize({ width: 560, height: 800 }); await snapshot('editor-narrow');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 1464, height: 900 });
  await library.getByRole('button', { name: '从现有风格原文复制', exact: true }).click();
  const batch = page.getByRole('dialog', { name: '核对仿写参考', exact: true });
  await expect(batch.getByLabel('对标名称', { exact: true })).toBeVisible(); await snapshot('batch-preview');
  await batch.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(errors, []);
  await writeFile(resolve(data, 'result.json'), JSON.stringify({ status: 'passed', checks: ['empty state and management', 'keyboard disclosure', 'collapsed blend visible', 'pending source state', 'profile padding', 'long titles', 'assistant blend padding', 'themes and widths', 'editor and batch preview'], errors }, null, 2));
  console.log('Imitation layout passed: ' + data);
} finally { await app.close(); }
