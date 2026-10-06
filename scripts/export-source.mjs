import { mkdir, cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve('.');
const version=JSON.parse(await readFile('package.json','utf8')).version;
const output=resolve('发布源码',`xingmiao-writer-core-${version}`);
await mkdir(output,{recursive:true});
const items=['.github','.editorconfig','.gitattributes','.gitignore','.nvmrc','src','electron','public','build/icon.ico','scripts','tests','docs','package.json','package-lock.json','electron-builder.config.cjs','index.html','tsconfig.json','vite.config.mjs','release.json','README.md','README.en.md','LICENSE','CHANGELOG.md','CONTRIBUTING.md','SECURITY.md','THIRD_PARTY_NOTICES.md'];
for(const item of items)await cp(join(root,item),join(output,item),{recursive:true,filter:src=>!/^_/.test(src.split(/[\\/]/).at(-1))});
const inventory=[];
async function visit(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const file=join(dir,entry.name);
    if(entry.isSymbolicLink())throw Error('Unexpected symlink: '+relative(output,file));
    if(entry.isDirectory()){if(/^(node_modules|dist|release|test-results|supabase|\.local-data|\.git)$/.test(entry.name))throw Error('Unexpected private/generated folder');await visit(file);}
    else{
      if(/\.(sqlite|db)(-|\.|$)|^\.env|membership-wechat/i.test(entry.name))throw Error('Unexpected personal file: '+relative(output,file));
      const bytes=await readFile(file);
      if(/\.(md|json|[cm]?js|tsx?|yml|yaml)$/.test(entry.name)&&/(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY)/.test(bytes.toString()))throw Error('Possible credential: '+relative(output,file));
      inventory.push(`${createHash('sha256').update(bytes).digest('hex')}  ${relative(output,file).replaceAll('\\','/')}`);
    }
  }
}
await visit(output);
await writeFile(join(output,'SOURCE-MANIFEST.sha256'),inventory.sort().join('\n')+'\n');
console.log(`Clean source prepared: ${output} (${inventory.length} files)`);
