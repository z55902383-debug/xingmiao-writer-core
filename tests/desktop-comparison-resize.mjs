import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('test-results/comparison-resize'); await mkdir(root, { recursive: true });
const data = await mkdtemp(resolve(root, 'run-'));
const env = { ...process.env, XM_TEST: '1', XM_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.XM_DEV_URL;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(10000);
  const call = (action, data = {}) => page.evaluate(async ({ action, data }) => { const r = await window.xingmiao.invoke(action, data); if (!r.ok) throw Error(r.error); return r.data; }, { action, data });
  const book = await call('book:create', { title: '长正文切换回归' }), chapter = book.chapters[0];
  const body = '晚上八点十七分，供热泵房突然停了。\n\n' + Array.from({ length: 55 }, (_, i) => `第${i + 1}段。陈砚沿着楼梯上楼，听见走廊尽头传来脚步声。他停下来，等那人走近。`).join('\n\n') + '\n\n正文末尾完整保留标记。';
  const saved = await call('chapter:save', { id: chapter.id, revision: chapter.revision, patch: { body } });
  await page.reload(); await page.getByRole('button', { name: /继续.*长正文切换回归/ }).click();
  const guide = page.locator('.creation-guide-close'); if (await guide.isVisible().catch(() => false)) await guide.click();
  const editor = page.getByRole('textbox', { name: '章节正文', exact: true });
  const verify = async label => {
    await expect(editor).toHaveValue(body);
    const bounds = await editor.evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight, height: el.getBoundingClientRect().height }));
    assert.ok(bounds.height >= 400 && bounds.scroll <= bounds.client + 2, `${label}: 正文不能被隐藏裁切 ${JSON.stringify(bounds)}`);
    const stored = (await call('book:get', { id: book.id })).chapters[0]; assert.equal(stored.body, body); assert.equal(stored.revision, saved.revision);
  };
  await verify('首次打开');
  for (const size of [{ width: 1464, height: 1100 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size);
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: '双列对照创作', exact: true }).click();
      await expect(page.getByRole('textbox', { name: '人工对照正文', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '退出对照创作', exact: true }).click();
      await verify(`退出对照 ${size.width} 第${i + 1}次`);
    }
    await editor.evaluate(el => { const s = el.closest('.editor-scroll'); s.scrollTop = s.scrollHeight; });
    await page.screenshot({ path: resolve(data, `restored-ending-${size.width}.png`) });
  }
  await writeFile(resolve(data, 'result.json'), JSON.stringify({ passed: true, characters: body.length, switches: 6, originalRevision: saved.revision }, null, 2));
  console.log('Long manuscript comparison resize passed: ' + data);
} finally { await app.close(); }
