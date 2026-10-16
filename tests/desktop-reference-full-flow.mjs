import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('test-results/reference-full-flow'); await mkdir(root, { recursive: true });
const dataDir = await mkdtemp(resolve(root, 'run-'));
const requests = [], checks = [], errors = [];
let replyMode = '', slowResponse;
function answer(input) {
  const text = input.messages.map(row => row.content).join('\n');
  if (text.includes('这是仿写对标分析')) return 'IM-DOSSIER：主角寻找失踪师傅，盟友目标冲突，按线索逐步揭密。';
  if (text.includes('蒸馏可复用的写作风格')) return 'STYLE-DOSSIER：短句白描、克制心理、限知视角，逐步揭露信息。';
  const user = input.messages.find(row => row.role === 'user').content;
  const payload = JSON.parse(user.split('以下 JSON 为资料数据：\n')[1]);
  if (user.includes('完整全书总纲')) return { title: payload.book.title, outline: '主角追查线索，与盟友合作并解决冲突。' };
  if (user.includes('规划分卷')) return { volumes: [{ title: '第一卷 线索' }] };
  if (user.includes('指定目标卷生成卷大纲')) return { id: payload.targetVolume.id, outline: '找出失踪原因，卷末确定调查方向。' };
  if (user.includes('指定卷的大纲生成更细')) return { id: payload.targetVolume.id, detail: '进入邮局，询问信使，发现信件线索。' };
  if (user.includes('规划短篇章节') || user.includes('生成本卷章节规划')) {
    const existing = payload.shortStory?.chapters || payload.storyStructure.chapters;
    return { ...(payload.targetVolume ? { volumeId: payload.targetVolume.id } : {}), chapters: [{ id: existing[0]?.id, title: '第1章 失落的信', summary: '主角进入邮局寻找师傅留下的信。' }, { title: '第2章 信使', summary: '信使交出线索，盟友做出选择。' }] };
  }
  if (user.includes('补全已有章节细纲') || user.includes('补全章节细纲')) return { ...(payload.targetVolume ? { volumeId: payload.targetVolume.id } : {}), chapters: (payload.shortStory?.chapters || payload.targetVolume.chapters).map(row => ({ id: row.id, title: row.title, outline: '主角进入邮局，对话后拿到线索，章末发现落款。' })) };
  if (user.includes('设计与故事简介')) return { characters: [{ name: '林晚', role: '主角', description: '寻找师傅，行事克制，只知道现有线索。' }] };
  if (user.includes('生成世界初始设定')) return '当代城市，邮局存放无人领取的信件。';
  if (user.includes('提出后续世界')) return { events: [{kind: 'world', title: '邮局维修计划', entity: '邮局', attribute: '维修安排', value: '计划下周维修', chapterId: payload.chapter.id, sequence: 1}] };
  if (user.includes('创作本章正文')) return '林晚推开邮局的门，把信封放在柜台上。';
  if (user.includes('续写当前正文')) return '信使接过信封，指了指背面的落款。';
  if (user.includes('润色当前整章')) return '林晚走进邮局，将信封放上柜台。信使翻过信封，指向落款。';
  if (user.includes('核对本章与资料')) return '未发现明确冲突，信封的来源仍待确认。';
  if (user.includes('只从本章正文抽取')) return { memories: [] };
  throw Error('Unexpected task: ' + user.slice(0, 100));
}
const server = createServer(async (req, res) => {
  let raw = ''; for await (const part of req) raw += part;
  const input = JSON.parse(raw); requests.push(input);
  const mode = replyMode; replyMode = '';
  if (mode === 'http-error') { res.writeHead(503); res.end('fixture service unavailable'); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const emit = (content, finish = 'stop') => res.write('data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] }) + '\n\n');
  if (mode === 'slow') { emit('已收到的部分分析', null); slowResponse = res; return; }
  let content;
  try { content = mode === 'malformed' ? '{}' : mode === 'empty' ? '' : mode === 'bad-evidence' ? {memories:[{subject:'主角',relation:'得到',object:'宝物',evidence:'正文不存在的证据'}]} : mode === 'wrong-id' ? {id:'other-book-chapter',outline:'错目标'} : mode === 'wrong-task' ? {characters:[]} : answer(input); }
  catch (error) { errors.push(error.message); content = 'unexpected fixture task'; }
  emit(typeof content === 'string' ? content : JSON.stringify(content), mode === 'length' ? 'length' : 'stop');
  res.end('data: [DONE]\n\n');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const env = { ...process.env, XM_TEST: '1', XM_DATA_DIR: dataDir }; delete env.ELECTRON_RUN_AS_NODE; delete env.XM_DEV_URL;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  const call = (action, args = {}) => page.evaluate(async ({ action, args }) => {
    const r = await window.xingmiao.invoke(action, args); if (!r.ok) throw Error(r.error); return r.data;
  }, { action, args });
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  await call('config:save', { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture', maxTokens: 4096 });
  await page.evaluate(() => { window.flowJobs = {}; window.xingmiao.onJob(job => { window.flowJobs[job.id] = job; }); });
  const getBook = id => call('book:get', { id });
  async function generate(book, kind, target = {}) {
    const index = requests.length;
    const job = await call('ai:generate', { bookId: book.id, chapterId: book.chapters[0].id, kind, skillIds: [], analyzeChanges: false, ...target });
    await expect.poll(async () => (await getBook(book.id)).candidates.find(row => row.id === job.id)?.status, { timeout: 10000 }).not.toBe('running');
    const done = (await getBook(book.id)).candidates.find(row => row.id === job.id);
    return { job: done, request: requests[index] };
  }
  async function apply(book, kind, target = {}) {
    const { job, request } = await generate(book, kind, target);
    assert.equal(job.status, 'done', job.error);
    const before = await getBook(book.id);
    assert.equal(before.chapters[0].body, book.chapters[0].body, 'generation does not auto-write prose');
    const next = await call('ai:adopt', { id: job.id, mode: kind === 'continue' ? 'append' : 'replace' });
    return { book: next, job, request };
  }
  let routingBook;
  for (const scenario of [{ name: '仅仿写长篇', imitation: true, style: false, creationMode: 'long' }, { name: '仅风格短篇', imitation: false, style: true, creationMode: 'short' }, { name: '双参考长篇', imitation: true, style: true, creationMode: 'long' }, { name: '仅仿写短篇', imitation: true, style: false, creationMode: 'short' }, { name: '仅风格长篇', imitation: false, style: true, creationMode: 'long' }, { name: '仿写与风格并用', imitation: true, style: true, creationMode: 'short' }]) {
    let book = await call('book:create', { title: scenario.name, premise: '林晚寻找师傅留下的信件。', target: 4000, creationMode: scenario.creationMode });
    for (const domain of ['imitation', 'style']) {
      if (!scenario[domain]) continue;
      const action = domain === 'imitation' ? 'imitation' : 'writing';
      book = await call(action + ':import-batch', { bookId: book.id, sources: ['A', 'B', 'C'].map(name => ({ title: domain + '-' + name, name: name + '.txt', body: 'PRIVATE-' + domain + '-' + name })) });
      const rows = domain === 'imitation' ? book.imitationProfiles : book.writingProfiles;
      for (const row of rows) {
        const { job, request } = await generate(book, 'style', { [domain === 'imitation' ? 'imitationProfileId' : 'writingProfileId']: row.id, instruction: '不要补齐未提供的结局' });
        const sent = JSON.stringify(request.messages); assert.match(sent, new RegExp('PRIVATE-' + domain + '-' + row.title.at(-1)));
        assert.equal((sent.match(/PRIVATE-/g) || []).length, 1); assert.match(sent, /不要补齐未提供的结局/);
        assert.equal(job.context.skills.length, 0);
        book = await call('ai:adopt', { id: job.id, mode: 'replace' });
        assert.equal(book.chapters[0].body, '');
      }
      assert.equal(domain === 'imitation' ? book.imitationSelection?.ids.length || 0 : book.writingSelection?.styleIds.length || 0, 0, 'adoption does not auto-select');
      const ids = rows.map(row => row.id), weights = { [ids[0]]: 60, [ids[1]]: 40, [ids[2]]: 0 };
      book = await call(action + ':select', { bookId: book.id, selection: domain === 'imitation' ? { ids, weights } : { styleIds: ids, requirementIds: [], styleWeights: weights } });
    }
    async function step(kind, target = {}) {
      const result = await apply(book, kind, target); book = result.book;
      const im = result.job.context.imitationReferences || [], styles = result.job.context.writingReferences.filter(row => row.kind === 'style');
      assert.deepEqual(im.map(row => row.weight), scenario.imitation ? [60, 40] : []);
      assert.deepEqual(styles.map(row => row.weight), scenario.style ? [60, 40] : []);
      const actualPayload = JSON.parse(result.request.messages.find(row=>row.role==='user').content.split('以下 JSON 为资料数据：\n')[1]);
      assert.equal(actualPayload.style, undefined);
      assert.equal(actualPayload.writingRequirements, undefined);
      assert.deepEqual(actualPayload.references?.writingReferences || [], result.job.context.writingReferences);
      assert.deepEqual(actualPayload.references?.imitationReferences || [], im);
      assert.equal(result.job.context.outputContract.task,kind);
      assert.doesNotMatch(result.request.messages[0].content,/IM-DOSSIER|STYLE-DOSSIER/);
      assert.doesNotMatch(JSON.stringify(result.request.messages), /PRIVATE-/);
      assert.ok(![...im, ...styles].some(row => row.title.endsWith('-C')));
      checks.push(scenario.name + ':' + kind); return result;
    }
    await step('bookOutline'); await step('characters'); await step('worldBuild');
    let targetVolumeId;
    if (scenario.creationMode === 'long') {
      await step('volumePlan'); targetVolumeId = book.volumes[0].id;
      await step('volumeOutline', { targetVolumeId }); await step('volumeDetail', { targetVolumeId });
    }
    await step('chapterPlan', { targetVolumeId }); await step('chapterDetails', { targetVolumeId });
    await step('timelinePlan'); assert.ok(book.timeline.every(row=>row.phase==='planned'&&!row.evidence));
    assert.equal(book.chapters.length, 2); assert.ok(book.chapters.every(row => row.summary && row.outline && !row.body));
    await step('write'); const firstBody = book.chapters[0].body;
    await step('continue'); assert.ok(book.chapters[0].body.startsWith(firstBody)); assert.match(book.chapters[0].body, /落款/);
    await step('polish'); assert.match(book.chapters[0].body, /将信封放上柜台/);
    const checked = await generate(book, 'check'); assert.equal(checked.job.status, 'done'); assert.equal((await getBook(book.id)).chapters[0].body, book.chapters[0].body);
    await call('chapter:finalize', { id: book.chapters[0].id, revision: book.chapters[0].revision }); book = await getBook(book.id);
    const memory = await generate(book, 'memory'); assert.equal(memory.job.status, 'done'); assert.doesNotMatch(JSON.stringify(memory.request.messages), /IM-DOSSIER|STYLE-DOSSIER|PRIVATE-/);
    book=await call('memory:accept',{id:memory.job.id});
    const second=book.chapters[1];const secondResult=await generate(book,'write',{chapterId:second.id});assert.equal(secondResult.job.status,'done');
    assert.doesNotMatch(JSON.stringify(secondResult.request.messages),/PRIVATE-/);
    book=await call('ai:adopt',{id:secondResult.job.id,mode:'replace'});
    await call('chapter:finalize',{id:book.chapters[1].id,revision:book.chapters[1].revision});
    book=await call('book:complete',{id:book.id});assert.ok(book.completedAt);assert.ok(book.chapters.every(row=>row.status==='final'&&row.body));
    const manuscript=resolve(dataDir,scenario.name+'.md');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},manuscript);
    await call('book:export',{id:book.id,format:'md'});const exported=await readFile(manuscript,'utf8');assert.match(exported,/第1章 失落的信/);assert.match(exported,/第2章 信使/);assert.doesNotMatch(exported,/PRIVATE-|IM-DOSSIER|STYLE-DOSSIER/);
    checks.push(scenario.name+':memory, second chapter, finalize, complete and export');
    if (scenario.name === '仿写与风格并用') routingBook = book;
  }
  const book = routingBook, im = book.imitationProfiles[0];
  for(const [mode,kind] of [['bad-evidence','memory'],['wrong-id','outline'],['wrong-task','bookOutline']]) {
    replyMode=mode; const before=await getBook(book.id), result=await generate(book,kind);
    assert.equal(result.job.status,'error'); assert.ok(result.job.output); assert.equal(result.job.adopted,false);
    const after=await getBook(book.id); assert.deepEqual(after.chapters,before.chapters);assert.deepEqual(after.memories,before.memories);assert.equal(after.outline,before.outline);
    checks.push('output contract rejects:'+mode);
  }

  for (const mode of ['http-error', 'empty', 'length', 'slow']) {
    const before = await getBook(book.id); replyMode = mode;
    let result;
    if (mode === 'slow') {
      const job = await call('ai:generate', { bookId: book.id, chapterId: book.chapters[0].id, kind: 'style', imitationProfileId: im.id, skillIds: [] });
      await expect.poll(() => page.evaluate(id => window.flowJobs[id]?.output || '', job.id)).toContain('部分分析');
      await call('ai:cancel', { id: job.id }); slowResponse?.end();
      await expect.poll(async () => (await getBook(book.id)).candidates.find(row => row.id === job.id)?.status).toBe('cancelled');
      result = { job: (await getBook(book.id)).candidates.find(row => row.id === job.id) };
    } else result = await generate(book, 'style', { imitationProfileId: im.id });
    assert.equal(result.job.status, mode === 'length' ? 'interrupted' : mode === 'slow' ? 'cancelled' : 'error');
    assert.equal(result.job.adopted, false); assert.deepEqual((await getBook(book.id)).imitationProfiles, before.imitationProfiles);
    checks.push('analysis failure isolation:' + mode);
  }
  replyMode = 'malformed'; const malformed = await generate(book, 'bookOutline');
  assert.equal(malformed.job.status, 'error'); assert.match(malformed.job.error, /全文大纲|结构/);
  await assert.rejects(() => call('ai:adopt', { id: malformed.job.id, mode: 'replace' }), /不能采用/);
  assert.equal((await getBook(book.id)).outline, book.outline);
  const stale = await generate(book, 'style', { imitationProfileId: im.id });
  await call('imitation:save', { bookId: book.id, profile: { ...im, source: im.source + '原文修订' } });
  await assert.rejects(() => call('ai:adopt', { id: stale.job.id, mode: 'replace' }), /已修改/);
  checks.push('invalid output and stale analysis do not overwrite');
  const oldProse=await generate(await getBook(book.id),'write');const ids=book.imitationSelection.ids;
  await call('imitation:select',{bookId:book.id,selection:{ids,weights:{[ids[0]]:30,[ids[1]]:70,[ids[2]]:0}}});
  await assert.rejects(()=>call('ai:adopt',{id:oldProse.job.id,mode:'replace'}),/已变化/);
  const recovery=await call('candidate:recovery',{id:oldProse.job.id});assert.equal(recovery.conflict,true);assert.ok(recovery.changes.some(row=>row.label==='仿写故事对标'));
  checks.push('changed story weights block stale prose and explain conflict');
  const exportPath = resolve(dataDir, 'imitation-export.json');
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, exportPath);
  await call('imitation:export', { bookId: book.id, id: im.id }); assert.doesNotMatch(await readFile(exportPath, 'utf8'), /PRIVATE-/);
  // Exercise the assistant target routing using the actual controls, rather than direct IPC.
  await page.reload(); await page.getByRole('button', { name: /继续.*仿写与风格并用/ }).click();
  await page.getByRole('tab', { name: '功能', exact: true }).click(); await page.getByRole('button', { name: '仿写对标', exact: true }).click();
  await page.locator('.compose-reference-trigger').click();
  const target = page.getByLabel('对标分析目标', { exact: true }); await expect(target).toHaveValue('imitation:' + im.id);
  await expect(target.locator('option')).toHaveCount(4);
  await page.getByRole('button', { name: '开始生成', exact: true }).click(); await expect(page.locator('.candidate-text')).toContainText('IM-DOSSIER');
  const last = requests.at(-1); assert.match(JSON.stringify(last.messages), /PRIVATE-imitation-A/); assert.doesNotMatch(JSON.stringify(last.messages), /PRIVATE-style-/);
  await page.getByRole('button', { name: '风格档案', exact: true }).click();
  await expect(page.getByLabel('蒸馏目标', { exact: true })).toHaveValue(book.writingProfiles[0].id);
  await expect(page.getByLabel('蒸馏目标', { exact: true }).locator('option')).toHaveCount(4);
  await page.getByRole('button',{name:'开始生成',exact:true}).click();await expect(page.locator('.candidate-text')).toContainText('STYLE-DOSSIER');assert.match(JSON.stringify(requests.at(-1).messages),/PRIVATE-style-A/);assert.doesNotMatch(JSON.stringify(requests.at(-1).messages),/PRIVATE-imitation-/);
  await page.getByRole('button', { name: '仿写对标', exact: true }).click(); await expect(target).toHaveValue('imitation:' + im.id);
  await target.selectOption(''); await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeDisabled();
  checks.push('page switching isolates targets; missing target cannot analyze legacy style');
  assert.deepEqual(errors, []);
  await writeFile(resolve(dataDir, 'requests.json'),JSON.stringify(requests,null,2));
  await writeFile(resolve(dataDir, 'report.json'), JSON.stringify({ status: 'passed', requests: requests.length, checks, errors }, null, 2));
  console.log('Reference full flow passed: ' + dataDir);
} finally { await app.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
