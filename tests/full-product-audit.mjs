import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve('test-results/full-product-audit');await mkdir(root,{recursive:true});
const output=await mkdtemp(join(root,'run-'));
const cases=[];
const excluded=new Map([
  ['desktop-auto-novel-live.mjs','本次发布不调用真实付费模型，使用隔离模拟验证'],
  ['desktop-plaza.mjs','旧版上传测试没有本地服务拦截，避免向外部广场提交测试内容；由新版desktop-plaza-browser覆盖'],
]);
const fixes=["desktop-ai.mjs", "desktop-timeline.mjs", "desktop-book-features.mjs", "desktop-knowledge-review.mjs", "desktop-atlas-map.mjs", "desktop-manual-ideas.mjs", "desktop-manual-panel-state.mjs", "desktop-page-scroll.mjs", "desktop-i18n.mjs", "desktop-chapter-submit-sync.mjs", "desktop-atlas-navigation.mjs", "desktop-memo-library.mjs", "desktop-startup.mjs"];
const names=process.argv.includes('--fixes')?fixes:[...(await readdir('tests')).filter(n=>/^desktop.*\.mjs$/.test(n)).sort(),'product-navigation-edges.mjs','product-exploratory-audit.mjs'];
await writeFile(join(root,'latest-run.txt'),output);
async function run(name,args){
  const start=Date.now();let stdout='',stderr='';
  const child=spawn(process.execPath,args,{cwd:resolve('.'),env:{...process.env},windowsHide:true});
  child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true});},120000);
  const code=await new Promise(r=>{child.once('error',e=>{stderr+=e.message;r(-1)});child.once('exit',r)});clearTimeout(timer);
  const result={name,status:code===0?'passed':timedOut?'timeout':'failed',code,seconds:Math.round((Date.now()-start)/100)/10,log:join(output,name+'.log')};
  await writeFile(result.log,stdout+'\n'+stderr);cases.push(result);
  await writeFile(join(output,'results.json'),JSON.stringify({output,cases,excluded:[...excluded].map(([name,reason])=>({name,reason}))},null,2));
  console.log(`${cases.length}: ${name} ${result.status} ${result.seconds}s`);
}
if(!process.argv.includes('--ui-only'))await run('unit-tests',['--test',...((await readdir('tests')).filter(n=>n.endsWith('.test.cjs')).map(n=>'tests/'+n))]);
for(const name of names){if(excluded.has(name))continue;const args=['tests/'+name];if(name==='desktop-auto-novel-design.mjs')args.push(pathToFileURL(resolve('public/auto-novel-preview/index.html')).href);await run(name,args);}
console.log(JSON.stringify({output,passed:cases.filter(r=>r.status==='passed').length,failed:cases.filter(r=>r.status!=='passed').length,excluded:[...excluded.keys()]}));
if(cases.some(r=>r.status!=='passed'))process.exitCode=1;
