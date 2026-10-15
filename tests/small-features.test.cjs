const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Store } = require('../electron/store.cjs');
const retention = require('../electron/trash-retention.cjs');
const DAY = 86400000;
function setup(t) { const dir=mkdtempSync(join(tmpdir(),'xm-small-')), store=new Store(join(dir,'test.sqlite')); t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});}); return store; }
test('自动清理默认关闭；开启和修改周期给旧条目完整保留期，同值保存不续期', t => {
  const s=setup(t), b=s.createBook({title:'旧资料'}); const e=s.recycle('memory',b.id,{subject:'记忆'}); e.deletedAt='2000-01-01T00:00:00Z';s.putSetting('recycle-bin',[e]);
  const now=Date.parse('2026-10-15T00:00:00Z'); assert.equal(retention.sweep(s,now).removed,0);
  retention.configure(s,7,now); assert.equal(retention.list(s,now)[0].remainingDays,7); assert.equal(retention.sweep(s,now+7*DAY-1).removed,0);
  retention.configure(s,7,now+DAY); assert.equal(retention.sweep(s,now+7*DAY).removed,1);
  assert.throws(()=>retention.configure(s,1),/保留天数/);
});
test('到期章节、历史和对应候选永久删除，活跃正文及归档作品保留',t=>{
  const s=setup(t),b=s.createBook({title:'清理'}),other=s.createBook({title:'归档作品'});s.updateBook(other.id,{archived:true});
  const c=s.updateChapter(b.chapters[0].id,{body:'将删除的正文'},1);s.putJob({id:'old-job',bookId:b.id,chapterId:c.id,output:'旧候选'});s.deleteChapter(c.id);
  const now=Date.parse(s.trash()[0].deletedAt);retention.configure(s,7,now);assert.equal(retention.sweep(s,now+7*DAY).removed,1);
  assert.equal(s.chapters(b.id,true).length,0);assert.equal(s.db.prepare('SELECT count(*) AS n FROM versions').get().n,0);assert.equal(s.db.prepare('SELECT count(*) AS n FROM candidates').get().n,0);
  assert.equal(s.book(other.id).archived,true);assert.equal(s.book(other.id).chapters.length,1);
});
test('删除作品到期清理，归档作品不因时间流逝而删除，恢复的内容不受旧条目影响',t=>{
  const s=setup(t),b=s.createBook({title:'删除作品'}),a=s.createBook({title:'长期归档'});s.updateBook(a.id,{archived:true});s.deleteBook(b.id);
  const now=Date.parse(s.trash()[0].deletedAt);retention.configure(s,7,now);retention.sweep(s,now+7*DAY);
  assert.throws(()=>s.rawBook(b.id),/找不到/);assert.equal(s.rawBook(a.id).archived,true);
  const c=s.deleteChapter(a.chapters[0].id),entry=s.trash()[0];s.restoreTrash(entry.id);s.putSetting('recycle-bin',[entry]);retention.sweep(s,Date.parse(entry.deletedAt)+100*DAY);assert.equal(s.chapter(a.chapters[0].id).deletedAt,undefined);
});
test('清理作品前等待同书较新回收条目到期，任一错误整批回滚',t=>{
  const s=setup(t),b=s.createBook({title:'等待恢复条目'});s.deleteBook(b.id);const start=Date.parse(s.trash()[0].deletedAt);retention.configure(s,7,start);
  const later=s.recycle('memory',b.id,{subject:'较新条目'});later.deletedAt=new Date(start+DAY).toISOString();s.putSetting('recycle-bin',[later,...s.trash().filter(e=>e.id!==later.id)]);
  retention.sweep(s,start+7*DAY);assert.ok(s.rawBook(b.id).deletedAt);retention.sweep(s,start+8*DAY);assert.equal(s.trash().length,0);assert.throws(()=>s.rawBook(b.id));
  const active=s.createBook({title:'回滚'}),entry=s.recycle('memory',active.id,{subject:'记录'});const bad={...entry,id:'bad',bookId:'missing'};s.putSetting('recycle-bin',[entry,bad]);const before=s.trash();assert.throws(()=>retention.sweep(s,Date.parse(entry.deletedAt)+100*DAY));assert.deepEqual(s.trash(),before);
});
