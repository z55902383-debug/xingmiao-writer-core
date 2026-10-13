const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Store } = require('../electron/store.cjs');
const { buildContext } = require('../electron/context.cjs');
const { taskGuidance } = require('../electron/writing-prompts.cjs');
const builtins = require('../electron/builtin-writing-skills.cjs');
const { tasks } = require('../electron/planning.cjs');
const { KINDS } = require('../electron/extensions.cjs');
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'xm-prompt-'));
  const db = new Store(join(directory, 'fixture.sqlite'));
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const book = db.createBook({ title: '因果测试', premise: '侦探调查钟楼。' });
  return { db, book };
}
test('新用户获得14项可编辑内置写法且默认全部关闭，任务有效且启动不重复添加', t => {
  const { db, book } = fixture(t);
  db.initSkills();
  const initial = db.skills();
  assert.equal(initial.length, 14);
  assert.equal(initial.filter(s => s.enabled).length, 0);
  assert.ok(initial.every(s => s.tasks.every(kind => KINDS.includes(kind))));
  assert.equal(buildContext(book, book.chapters[0], 'write', '', initial).skills.length, 0);
  db.initSkills();
  assert.deepEqual(db.skills(), initial);
  db.deleteSkill(initial[3].id);
  db.initSkills();
  assert.equal(db.skills().length, 13);
});
test('旧内置升级保留编号与启用状态，人工修改的正文说明和任务均不覆盖', t => {
  const { db } = fixture(t);
  const old = builtins.previous.map((s, i) => db.saveSkill({ ...s, enabled: i === 0, source: '星喵内置' }));
  db.saveSkill({ ...old[1], body: old[1].body + '\n作者自定限制' });
  db.saveSkill({ ...old[2], description: '作者自定说明' });
  const before = db.skills();
  db.initSkills();
  const after = db.skills();
  assert.equal(after[0].id, before[0].id);
  assert.equal(after[0].enabled, true);
  assert.equal(after[0].version, before[0].version + 1);
  assert.match(after[0].body, /人物选择及结果/);
  assert.deepEqual(after[1], before[1]);
  assert.deepEqual(after[2], before[2]);
  assert.ok(after.slice(3).every(s => !s.enabled));
});
test('旧用户删除的基础内置不重建，自定义同名及修改过的任务不覆盖', t => {
  const { db } = fixture(t);
  const custom = db.saveSkill({ ...builtins.previous[0], tasks: ['write'], enabled: true, source: '星喵内置' });
  const sameName = db.saveSkill({ name: builtins.items[3].name, body: '自定义内容', enabled: true, tasks: ['write'] });
  db.initSkills();
  assert.deepEqual(db.skills().find(s => s.id === custom.id), custom);
  assert.deepEqual(db.skills().find(s => s.id === sameName.id), sameName);
  assert.ok(!db.skills().some(s => s.name === '自然叙事' || s.name === '人物连续性'));
  assert.equal(db.skills().filter(s => s.name === sameName.name).length, 1);
});
test('旧用户100条资料上限不会阻止启动或删除人工条目', t => {
  const { db } = fixture(t);
  for (let i = 0; i < 100; i++) db.saveSkill({ name: `人工${i}`, body: '保留', tasks: ['write'] });
  const before = db.skills();
  db.initSkills();
  assert.deepEqual(db.skills(), before);
  assert.equal(db.setting('builtin-writing-skills-revision', 0), builtins.revision);
});
test('题材Skill仅明确启用后进入适用任务，记忆及风格蒸馏不混入题材创作规则', t => {
  const { db, book } = fixture(t);
  db.initSkills();
  const genre = db.skills().find(s => s.name === '玄幻战斗与成长');
  db.saveSkill({ ...genre, enabled: true });
  assert.deepEqual(buildContext(book, book.chapters[0], 'write', '', db.skills()).skills.map(s => s.id), [genre.id]);
  assert.deepEqual(buildContext(book, book.chapters[0], 'bookOutline', '', db.skills()).skills.map(s => s.id), [genre.id]);
  let chapter = db.updateChapter(book.chapters[0].id, { body: '侦探交出钥匙。' }, 1);
  chapter = db.finalize(chapter.id, chapter.revision);
  let saved = db.book(book.id);
  assert.equal(buildContext(saved, chapter, 'memory', '', db.skills()).skills.length, 0);
  saved = db.saveWritingProfile(book.id, { kind: 'style', title: '分析原文', source: '侦探交出钥匙。' });
  assert.equal(buildContext(saved, chapter, 'style', '', db.skills(), { writingProfileId: saved.writingProfiles[0].id }).skills.length, 0);
});
test('各规划步骤沿用JSON任务与目标，仅增加该步骤规则，未来计划仍是计划', t => {
  const { db, book } = fixture(t);
  db.updateBook(book.id, { outline: '查明钟楼真相。' });
  const saved = db.saveVolume(book.id, { title: '第一卷 钟楼', outline: '调查异常。', detail: '发现钟声规律。' });
  const volume = saved.volumes[0];
  db.organizeChapter(book.chapters[0].id, { volumeId: volume.id });
  const full = db.book(book.id), chapter = full.chapters[0];
  for (const kind of Object.keys(tasks).filter(kind => kind !== 'timelinePlan')) {
    const context = buildContext(full, chapter, kind, '', [], { volumeId: volume.id });
    assert.ok(context.messages[1].content.includes(tasks[kind]), kind + ' retains exact task schema');
    assert.ok(context.messages[1].content.includes(taskGuidance(kind)), kind + ' carries task-specific guidance');
    const data = JSON.parse(context.messages[1].content.split('以下 JSON 为资料数据：\n')[1]);
    assert.equal(data.chapter.id, chapter.id);
    if (data.targetVolume) assert.equal(data.targetVolume.id, volume.id);
    assert.match(context.messages[0].content, /不要把未来章纲当成已发生事实/);
  }
});
test('正文续写润色保持不同输出合同、作者风格优先且不机械封禁常用词', t => {
  const { db, book } = fixture(t);
  const chapter = db.updateChapter(book.chapters[0].id, { body: '“我知道。”侦探说。', outline: '钟楼调查。' }, 1);
  const saved = db.book(book.id);
  for (const kind of ['write', 'continue', 'polish']) {
    const context = buildContext(saved, chapter, kind, '第一人称，舒缓叙事，保留必要比喻。');
    assert.match(context.messages[0].content, /本次作者补充要求优先/);
    assert.match(context.messages[1].content, /第一人称，舒缓叙事/);
    assert.match(context.messages[1].content, /不擅自设固定套路/);
    assert.match(context.messages[1].content, /对白体现说话者的意图与策略/);
    assert.match(context.messages[1].content, /进入与离开时的实际变化/);
    assert.ok(!context.messages[1].content.includes('<正文>'));
    assert.ok(!context.messages[1].content.includes('对话占比≥70%'));
  }
  assert.match(buildContext(saved, chapter, 'continue').messages[1].content, /只输出新增部分/);
  assert.match(buildContext(saved, chapter, 'continue').messages[1].content, /实际停笔处/);
  assert.match(buildContext(saved, chapter, 'polish').messages[1].content, /输出完整修改后的正文/);
  assert.match(buildContext(saved, chapter, 'polish').messages[1].content, /不自行增删关键情节/);
  assert.equal(taskGuidance('memory'), '');
  assert.match(taskGuidance('check'), /建议而非事实错误/);
});
test('风格与要求蒸馏区分观察和硬性要求，只分析目标原文，不凭书名补全小说', t => {
  const { db, book } = fixture(t);
  for (const kind of ['style', 'requirement']) {
    const saved = db.saveWritingProfile(book.id, { kind, title: kind, source: 'SOURCE-' + kind });
    const entry = saved.writingProfiles.at(-1);
    const context = buildContext(saved, saved.chapters[0], 'style', '', [], { writingProfileId: entry.id });
    const text = context.messages[1].content;
    assert.match(text, /未覆盖的卷章、结局/);
    assert.match(text, /不宣称保证平台推荐/);
    assert.ok(text.includes('SOURCE-' + kind));
    assert.ok(!text.includes('SOURCE-' + (kind === 'style' ? 'requirement' : 'style')));
    if (kind === 'requirement') assert.match(text, /原文偶发写法不是硬性禁令/);
    else assert.match(text, /适用题材与不适用情形/);
  }
  const legacy = db.updateBook(book.id, { reference: 'LEGACY-SOURCE' });
  assert.match(buildContext(legacy, legacy.chapters[0], 'style').messages[1].content, /不凭书名补齐/);
});
