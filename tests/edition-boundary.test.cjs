const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
test('open core excludes complete-edition implementation and private assets',()=>{
 for(const name of ['src/Account.tsx','src/Plaza.tsx','src/CreativeToolbox.tsx','src/ImageApiSettings.tsx','electron/auth.cjs','electron/desktop-updates.cjs','electron/updates.cjs','supabase','public/membership-wechat.jpg']) assert.equal(fs.existsSync(path.join(root,name)),false,name);
 for(const name of ['electron/main.cjs','electron/settings-actions.cjs','src/App.tsx','src/Shelf.tsx']) {
  const source=fs.readFileSync(path.join(root,name),'utf8');
  assert.doesNotMatch(source,/supabase\.co|authActions|handleAuthToken|plaza:|creative:generate|cover:generate|image-api:get|updates:install/);
 }
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).license,'MIT');
 assert.match(fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8'),/app\.setName\("星喵写作开源版"\)/);
});
