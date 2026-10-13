import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const parent = resolve('test-results/writing-prompts');
await mkdir(parent, { recursive: true });
const output = await mkdtemp(resolve(parent, 'run-'));
const env = { ...process.env, XM_TEST: '1', XM_DATA_DIR: resolve(output, 'data') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
let app;
const errors = [];
async function launch() {
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  // The renderer must mount its close/save handler before a restart or shutdown.
  await expect(page.getByRole('button', { name: '模型与设置', exact: true })).toBeVisible();
  const call = (action, data = {}) => page.evaluate(async ({ action, data }) => {
    const response = await window.xingmiao.invoke(action, data);
    if (!response.ok) throw Error(response.error);
    return response.data;
  }, { action, data });
  return { page, call };
}
try {
  let { page, call } = await launch();
  const initial = await call('skills:list');
  assert.equal(initial.length, 14);
  assert.ok(initial.every(skill => !skill.enabled));
  await page.getByRole('button', { name: '模型与设置', exact: true }).click();
  await page.getByRole('button', { name: '写作 Skill', exact: true }).click();
  await page.getByLabel('搜索 Skill', { exact: true }).fill('玄幻');
  const row = page.locator('.skill-row').filter({ hasText: '玄幻战斗与成长' });
  await expect(row).toHaveCount(1);
  await row.getByRole('checkbox', { name: '启用 玄幻战斗与成长', exact: true }).click();
  await expect.poll(async () => (await call('skills:list')).find(skill => skill.name === '玄幻战斗与成长').enabled).toBe(true);
  await expect(row.getByRole('checkbox', { name: '启用 玄幻战斗与成长', exact: true })).toBeChecked();
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑 Skill', exact: true });
  const area = dialog.getByLabel('指令内容', { exact: true });
  await area.fill('作者自定：本书战斗以逃脱为目标，保留既有能力限制。');
  await dialog.getByRole('button', { name: '保存 Skill', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = (await call('skills:list')).find(skill => skill.name === '玄幻战斗与成长');
  assert.equal(saved.body, '作者自定：本书战斗以逃脱为目标，保留既有能力限制。');
  const removed = (await call('skills:list')).find(skill => skill.name === '仙侠情感与留白');
  await call('skill:delete', { id: removed.id });
  await app.close();
  ({ page, call } = await launch());
  const restarted = await call('skills:list');
  assert.deepEqual(restarted.find(skill => skill.id === saved.id), saved);
  assert.ok(!restarted.some(skill => skill.id === removed.id));
  assert.equal(restarted.length, 13);
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ passed: true, initialized: 14, editedAndEnabledPersisted: true, deletedNotReseeded: true, rendererErrors: errors }, null, 2));
  console.log('Built-in writing prompts desktop checks passed: discovery, opt-in, editing and restart preservation. ' + output);
} finally {
  if (app) await app.close().catch(() => {});
}
