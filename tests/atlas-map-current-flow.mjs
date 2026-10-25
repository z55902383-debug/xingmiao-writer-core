import {_electron as electron,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve('test-results/atlas-map-current');await mkdir(root,{recursive:true});
const data=await mkdtemp(join(root,'run-'));
const env={...process.env,XM_TEST:'1',XM_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;delete env.XM_DEV_URL;
const app=await electron.launch({args:['.'],env});const checks=[],errors=[];let page;
try {
  page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  const call=(action,args={})=>page.evaluate(async({action,args})=>{const r=await window.xingmiao.invoke(action,args);if(!r.ok)throw Error(r.error);return r.data;},{action,args});
  await expect(page.getByRole('heading',{name:'我的书架',exact:true})).toBeVisible();
  let book=await call('book:create',{title:'蓝图当前界面验收'});
  await call('book:update',{id:book.id,patch:{characters:[{id:'person-a',name:'陈默',role:'主角',description:'修伞匠'}]}});
  const current=()=>call('book:get',{id:book.id}),atlas=page.locator('.knowledge-atlas'),dialog=()=>page.getByRole('dialog');
  const node=id=>atlas.locator(`[data-atlas-node-id="${id}"]`);
  async function tools(label){const details=atlas.locator('.ka-tools').filter({has:page.locator('summary').filter({hasText:label})});if(!await details.evaluate(el=>el.open))await details.locator('summary').click();}
  async function enter(){await page.getByRole('button',{name:'打开 蓝图当前界面验收',exact:true}).click();const close=page.locator('.creation-guide-close');if(await close.isVisible())await close.click();await page.getByRole('tab',{name:'功能',exact:true}).click();await page.getByRole('button',{name:'知识蓝图',exact:true}).click();}
  async function save(name,kind){await expect(dialog()).toBeVisible();await dialog().getByLabel('名称',{exact:true}).fill(name);if(kind)await dialog().getByLabel('类型',{exact:true}).selectOption(kind);await dialog().getByRole('button',{name:'保存',exact:true}).click();await expect(dialog()).toHaveCount(0);}
  await page.reload();await enter();
  await expect(atlas.locator('.ka-empty strong')).toHaveText('还没有地图');await expect(atlas.locator('.ka-empty')).toBeVisible();await expect(atlas.locator('.ka-svg')).toBeHidden();
  await atlas.getByRole('button',{name:'新建第一张地图',exact:true}).click();await save('雾港世界','world');
  book=await current();assert.equal(book.atlasMaps.length,1);const world=book.atlasMaps[0].id;
  checks.push('combined empty view exposes creation, not a hidden legacy SVG');
  await atlas.getByRole('button',{name:'地点',exact:true}).click();await expect(atlas.locator('.ka-svg')).toBeVisible();
  await tools('添加与整理');await atlas.getByRole('button',{name:'新建节点',exact:true}).click();await save('旧钟楼','landmark');
  await atlas.getByRole('button',{name:'新建节点',exact:true}).click();await save('修伞铺','building');
  book=await current();assert.equal(book.atlasNodes.length,2);const tower=book.atlasNodes.find(n=>n.name==='旧钟楼').id,shop=book.atlasNodes.find(n=>n.name==='修伞铺').id;
  await expect(node(tower)).toBeVisible();await expect(node(shop)).toBeVisible();checks.push('map and two nodes created through visible current controls');
  const before=book.atlasNodes.find(n=>n.id===tower),box=await node(tower).boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+45,box.y+box.height/2+20,{steps:8});await page.mouse.up();
  await expect.poll(async()=>{const n=(await current()).atlasNodes.find(n=>n.id===tower);return n.x!==before.x||n.y!==before.y;}).toBe(true);checks.push('dragged node coordinates persist');
  await atlas.getByRole('button',{name:'新建边',exact:true}).click();await node(tower).click();await node(shop).click();await expect(dialog()).toBeVisible();await dialog().getByRole('button',{name:'保存',exact:true}).click();await expect.poll(async()=>(await current()).atlasEdges.length).toBe(1);checks.push('edge selection and save');
  await atlas.getByRole('button',{name:'添加物品',exact:true}).click();await dialog().getByLabel('名称',{exact:true}).fill('铜钥匙');await dialog().getByLabel('所在地点',{exact:true}).selectOption(tower);await dialog().getByLabel('保管人',{exact:true}).selectOption('person-a');await dialog().getByRole('button',{name:'保存',exact:true}).click();
  await atlas.getByRole('button',{name:'添加人物位置',exact:true}).click();await dialog().getByLabel('人物',{exact:true}).selectOption('person-a');await dialog().getByLabel('所在地点',{exact:true}).selectOption(tower);await dialog().getByRole('button',{name:'保存',exact:true}).click();
  book=await current();assert.equal(book.atlasItems[0].nodeId,tower);assert.equal(book.atlasPositions[0].characterId,'person-a');checks.push('item custody and character location reference stable IDs');
  await tools('地图管理');await atlas.getByRole('button',{name:'新建地图',exact:true}).click();await dialog().getByLabel('名称',{exact:true}).fill('钟楼内部');await dialog().getByLabel('上级地图',{exact:true}).selectOption(world);await dialog().getByRole('button',{name:'保存',exact:true}).click();
  book=await current();assert.equal(book.atlasMaps.find(m=>m.name==='钟楼内部').parentMapId,world);
  await atlas.locator('.ka-breadcrumb').getByRole('button',{name:'雾港世界',exact:true}).click();await atlas.locator('.ka-child-nav').getByRole('button',{name:/钟楼内部/}).click();await expect(atlas.locator('.ka-breadcrumb')).toContainText('钟楼内部');checks.push('parent breadcrumb and child entry navigate current hierarchy');
  await atlas.locator('.ka-breadcrumb').getByRole('button',{name:'雾港世界',exact:true}).click();await node(tower).click();
  await atlas.locator('.ka-inspector').getByRole('button',{name:'删除节点',exact:true}).click();await dialog().getByRole('button',{name:'取消',exact:true}).click();assert.equal((await current()).atlasNodes.length,2);
  await atlas.locator('.ka-inspector').getByRole('button',{name:'删除节点',exact:true}).click();await dialog().getByRole('button',{name:'确认删除',exact:true}).click();
  book=await current();assert.equal(book.atlasNodes.length,1);assert.equal(book.atlasEdges.length,0);assert.equal(book.atlasPositions.length,0);assert.equal(book.atlasItems[0].nodeId,'');assert.equal(book.atlasItems[0].ownerCharacterId,'person-a');checks.push('delete confirmation and cascades preserve other nodes, maps and item ownership');
  await page.reload();await enter();book=await current();assert.equal(book.atlasMaps.length,2);assert.equal(book.atlasNodes[0].id,shop);assert.deepEqual(errors,[]);checks.push('reload persistence and no page errors');
  await writeFile(join(data,'report.json'),JSON.stringify({status:'passed',checks,errors},null,2));console.log('Current atlas map passed: '+data);
}catch(error){if(page)await page.screenshot({path:join(data,'failure.png')}).catch(()=>{});await writeFile(join(data,'report.json'),JSON.stringify({status:'failed',checks,errors,error:error.stack},null,2));throw error;}
finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
