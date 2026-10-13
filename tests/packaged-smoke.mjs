import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
const exe = resolve(process.argv[2]);
const output = resolve('test-results/packaged-review');
await mkdir(output,{recursive:true});
const data = await mkdtemp(join(output,'run-'));
const netServer=createServer();
await new Promise(r=>netServer.listen(0,'127.0.0.1',r));
const port=netServer.address().port;
await new Promise(r=>netServer.close(r));
let log='';
async function open() {
  const env={...process.env,XM_TEST:'1',XM_DATA_DIR:data};
  delete env.ELECTRON_RUN_AS_NODE;delete env.XM_DEV_URL;
  const child=spawn(exe,[`--remote-debugging-port=${port}`],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',s=>log+=s);child.stderr.on('data',s=>log+=s);
  let browser;
  for(let i=0;i<40;i++){
    try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000});break;}catch{await new Promise(r=>setTimeout(r,250));}
  }
  if(!browser){child.kill();throw Error('Packaged browser unavailable: '+log.slice(-1500));}
  const page=browser.contexts()[0].pages()[0];
  const closed=new Promise(r=>child.once('exit',r));
  const close=async()=>{
    try {await page.evaluate(()=>window.xingmiao.invoke('app:close'));}
    catch(e) {if(!e.message.includes('has been closed'))throw e;}
    await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('close timeout')),10000))]);
  };
  return {page,close,child};
}
let current;
try{
  current=await open();const {page}=current;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await expect(page.getByRole('heading',{name:'我的书架',exact:true})).toBeVisible();
  const call=async(action,data={})=>page.evaluate(async({action,data})=>{const r=await window.xingmiao.invoke(action,data);if(!r.ok)throw Error(r.error);return r.data;},{action,data});
  const book=await call('book:create',{title:'安装包隔离测试'});
  const chapter=book.chapters[0];
  await call('chapter:save',{id:chapter.id,patch:{body:'打包后的正文持久化验证。'},revision:chapter.revision});
  const info=await call('app:info');expect(info.version).toBe(process.argv[3] || '0.6.10');
  await page.screenshot({path:join(data,'shelf.png')});
  await current.close();current=await open();
  await expect(current.page.getByRole('heading',{name:'我的书架',exact:true})).toBeVisible();
  const persisted=await current.page.evaluate(async id=>(await window.xingmiao.invoke('book:get',{id})).data,book.id);
  expect(persisted.chapters[0].body).toBe('打包后的正文持久化验证。');
  expect(errors).toEqual([]);await current.close();current=null;
  await writeFile(join(data,'result.json'),JSON.stringify({exe,data,version:info.version,status:'passed',checks:['launch','isolated database','chapter persistence','restart','version','no renderer errors']},null,2));
  console.log('Packaged smoke passed: '+exe);
}finally{if(current)current.child.kill();await writeFile(join(data,'launch.log'),log);}
