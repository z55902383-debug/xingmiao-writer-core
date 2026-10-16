import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('test-results/reference-disclosures'); await mkdir(root, { recursive: true });
const data = await mkdtemp(resolve(root, 'run-'));
const env = { ...process.env, XM_TEST: '1', XM_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.XM_DEV_URL;
const app = await electron.launch({ args: ['.'], env });
const errors = [], checks = [];
try {
  const page = await app.firstWindow(); await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  const call = (action, args = {}) => page.evaluate(async ({ action, args }) => { const r = await window.xingmiao.invoke(action, args); if (!r.ok) throw Error(r.error); return r.data; }, { action, args });
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  let book = await call('book:create', { title: '隐藏内容与次要操作审查' });
  book = await call('book:update', { id: book.id, patch: { reference: '旧参考文章', style: '旧风格', premise: '追查失踪的信件' } });
  for (let i = 0; i < 5; i++) {
    await call('imitation:save', { bookId: book.id, profile: { title: i===0?'对标0 · '+'角色关系与冲突推进'.repeat(6):`对标${i}`, source: '对标原文'.repeat(100), body: '故事骨架与人物关系。'.repeat(24), sourceName: '很长的来源文件名称'.repeat(5) + '.txt' } });
    await call('writing:save', { bookId: book.id, profile: { kind: 'style', title: i===0?'风格0 · '+'限知视角与短句白描'.repeat(6):`风格${i}`, source: '风格原文'.repeat(100), body: '语感、节奏和对白。'.repeat(24), sourceName: 'style.txt' } });
  }
  book=await call('book:get',{id:book.id});
  const im=book.imitationProfiles.slice(0,2), styles=book.writingProfiles.slice(0,2);
  await call('imitation:select',{bookId:book.id,selection:{ids:im.map(row=>row.id),weights:{[im[0].id]:70,[im[1].id]:30}}});
  await call('writing:select',{bookId:book.id,selection:{styleIds:styles.map(row=>row.id),requirementIds:[],styleWeights:{[styles[0].id]:70,[styles[1].id]:30}}});
  await page.reload(); await page.getByRole('button', { name: /继续.*隐藏内容与次要操作审查/ }).click(); await page.getByRole('tab', { name: '功能', exact: true }).click();
  for (const view of [{ name: '仿写对标', region: '仿写对标管理', scroll: '.imitation-materials' }, { name: '风格档案', region: '写作资料库', scroll: '.writing-materials-scroll' }]) {
    await page.getByRole('button', { name: view.name, exact: true }).click();
    const library = page.getByRole('region', { name: view.region, exact: true }), scroll = library.locator(view.scroll);
    const help = library.getByRole('button', { name: '参考范围与数据说明', exact: true });
    const panel = library.getByRole('region', { name: '参考范围与数据说明', exact: true });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const [width, height] of [[1464, 900], [1024, 650], [560, 800]]) {
        await page.setViewportSize({ width, height });
        await scroll.evaluate(el => { el.scrollTop = 0; });
        const tools = library.locator('.writing-source-tools > .button');
        for (let i = 0; i < await tools.count(); i++) {
          const measured = await tools.nth(i).evaluate(el => { const r = el.getBoundingClientRect(); return { height: r.height, font: parseFloat(getComputedStyle(el).fontSize), width: el.clientWidth, content: el.scrollWidth }; });
          assert.ok(measured.height >= 32 && measured.font >= 12 && measured.content <= measured.width + 1, 'secondary controls stay readable and do not crop their text');
        }
        await help.focus(); await help.press('Enter'); await expect(help).toHaveAttribute('aria-expanded', 'true');
        await expect(panel).toBeVisible();
        const bounds = await panel.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
        assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth));
        await page.screenshot({ path: resolve(data, `${view.name}-${theme}-${width}.png`), animations: 'disabled' });
        await help.press('Space'); await expect(help).toHaveAttribute('aria-expanded', 'false'); await expect(panel).toHaveCount(0);
      }
    }
    checks.push(view.name + ': secondary controls and keyboard disclosure at three sizes and both themes');
    for (const [width,height] of [[1464,900],[560,520]]) {
      await page.setViewportSize({width,height});
      const row = library.locator('.writing-profile-row').last(), more = row.locator('.menu-trigger');
      await more.scrollIntoViewIfNeeded();
      await scroll.evaluate((el, title) => { const cards = [...el.querySelectorAll('.writing-profile-row')]; const card = cards.find(c => c.querySelector('h4')?.textContent === title); const r = card.querySelector('.menu-trigger').getBoundingClientRect(), outer = el.getBoundingClientRect(); el.scrollTop += r.bottom - (outer.bottom - 8); }, await row.locator('h4').innerText());
      await more.click();
      const remove = row.locator('.menu-panel > button').last();
      await expect(remove).toBeVisible();
      await expect.poll(()=>remove.evaluate(el=>{const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!top&&el.contains(top);})).toBe(true);
      await expect(more).toHaveAttribute('title',/更多操作/);
      await page.keyboard.press('Tab');await expect(row.locator('.menu-panel > button').first()).toBeFocused();
      await page.screenshot({ path: resolve(data, `${view.name}-bottom-menu-${width}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape'); await expect(row.locator('.menu')).not.toHaveAttribute('open', ''); await expect(more).toBeFocused();
      await more.click();await page.locator('.document-page .page-heading').click();await expect(row.locator('.menu')).not.toHaveAttribute('open','');
      await more.click();await scroll.evaluate(el=>{el.scrollTop=0;});await expect(row.locator('.menu')).not.toHaveAttribute('open','');
    }
    await page.setViewportSize({width:1464,height:900});
    checks.push(view.name + ': menu remains clickable at both scroll boundaries, supports keyboard and dismisses outside or when its anchor leaves view');
  }
  await page.getByRole('button',{name:'章节正文',exact:true}).click();
  const context=page.getByRole('region',{name:'本次参考资料',exact:true});
  const contextToggle=context.locator('.context-toggle');
  if(await contextToggle.getAttribute('aria-expanded')!=='true')await contextToggle.click();
  const names=context.locator('.reference-titles').filter({has:page.locator('summary[title*="风格0"]')}).first();
  await expect(names).toBeVisible();const summary=names.locator('summary');
  await summary.scrollIntoViewIfNeeded();assert.ok((await summary.boundingBox()).height>=32&&(await summary.boundingBox()).height<=40,'long names do not expand the collapsed reference row');
  await summary.focus();await summary.press('Enter');await expect(names).toHaveAttribute('open','');await expect(names.getByRole('list',{name:'引用名称清单',exact:true})).toContainText(styles[0].title);
  await names.getByRole('list',{name:'引用名称清单',exact:true}).focus();await expect(names.getByRole('list',{name:'引用名称清单',exact:true})).toBeFocused();
  await page.screenshot({path:resolve(data,'reference-names-expanded.png'),animations:'disabled'});
  await summary.focus();await summary.press('Space');await expect(names).not.toHaveAttribute('open','');
  checks.push('long reference titles stay compact, expand to full names and support keyboard focus');
  assert.deepEqual(errors, []); await writeFile(resolve(data, 'result.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
  console.log('Reference disclosures passed: ' + data);
} finally { await app.close(); }
