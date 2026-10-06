const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {Store} = require('../electron/store.cjs');

async function fixture(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(),'xingmiao-data-review-'));
  const current = path.join(root,'appData','ReviewWriter');
  await fsp.mkdir(current,{recursive:true});
  const locations={appData:path.join(root,'appData'),userData:current};
  const app={getName:()=> 'ReviewWriter',getPath:k=>locations[k],setPath:(k,v)=>locations[k]=v,getAppPath:()=>path.join(root,'program')};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/data-dir.cjs'),'utf8'),{
    module,process:{env:{}},require:n=>n==='electron'?{app,dialog:{}}:require(n==='./store.cjs'?'../electron/store.cjs':n)
  });
  const store=new Store(path.join(current,'xingmiao.sqlite'));
  try {await run({root,current,store,api:module.exports,actions:module.exports.dataDirActions({store,running:new Map()})});}
  finally {
    store.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    await fsp.rm(root,{recursive:true,force:true});
  }
}

test('数据目录迁移保存未 checkpoint 的作品，保留目标旧库和原库',async()=>fixture(async f=>{
  f.store.createBook({title:'迁移测试'});
  const target=path.join(f.root,'target');await fsp.mkdir(target);
  await fsp.writeFile(path.join(target,'xingmiao.sqlite'),'old-target');
  const result=await f.actions['data:apply']({dir:target,migrate:true});
  assert.equal(result.migrated,1);
  const db=new Store(path.join(target,'xingmiao.sqlite'));
  try {assert.equal(db.list()[0].title,'迁移测试');}finally{db.close();}
  const names=await fsp.readdir(target);
  const old=names.find(n=>n.startsWith('xingmiao.sqlite.before-'));
  assert.equal(await fsp.readFile(path.join(target,old),'utf8'),'old-target');
  assert.equal(f.store.list()[0].title,'迁移测试');
  assert.equal(JSON.parse(await fsp.readFile(f.api.pointerPath(),'utf8')).dir,target);
}));

test('数据目录拒绝程序内部、磁盘根和同目录迁移',async()=>fixture(async f=>{
  await assert.rejects(f.api.inspectDir(path.parse(f.root).root));
  await assert.rejects(f.api.inspectDir(path.join(f.root,'program','data')));
  await assert.rejects(f.actions['data:apply']({dir:f.current,migrate:true}),/无需更改/);
}));

test('自定义位置不可达保留指针并报告，位置恢复后可重新使用',async()=>fixture(async f=>{
  const target=path.join(f.root,'offline');
  await fsp.writeFile(f.api.pointerPath(),JSON.stringify({dir:target}));
  assert.equal(f.api.resolveDataDir().unreachable,target);
  assert.equal(JSON.parse(await fsp.readFile(f.api.pointerPath(),'utf8')).dir,target);
  await fsp.mkdir(target);
  assert.equal(f.api.resolveDataDir().source,'custom');
}));
