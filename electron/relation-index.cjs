// Derived from confirmed records; never writes or replaces the author's history.
const { resolveTimeline } = require('./timeline.cjs');
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const ownership = /^(?:归属|归属人|所有者|持有者|持有人|保管|保管人|持有|所属)$/;
const terms = text => [...new Set([...segmenter.segment(String(text).toLowerCase())].filter(p => p.isWordLike && p.segment.length >= 2 && !['一个','这个','那个','本章','他们','自己','已经','然后','什么'].includes(p.segment)).map(p => p.segment))];
function sourceFor(book, chapter, id, revision, evidence = '') {
  if (!id) return { chapterId: '', title: '作者确认资料', revision: 0, evidence: '' };
  const c = book.chapters.find(c => c.id === id);
  if (!c || c.deletedAt || c.status !== 'final' || c.order >= chapter.order || c.revision !== revision || (evidence && !c.body.includes(evidence))) return null;
  const start = evidence ? c.body.indexOf(evidence) : -1;
  return { chapterId: c.id, title: c.title, revision: c.revision, evidence, ...(start >= 0 ? { start, end: start + evidence.length } : {}) };
}
function records(book, chapter) {
  const names = new Map((book.characters || []).map(c => [c.id, c.name]));
  const rows = [];
  for (const m of book.memories || []) {
    if (m.stale || (m.sourceChapterId && (!m.evidence?.trim() || !Number.isInteger(m.sourceRevision)))) continue;
    const source = sourceFor(book, chapter, m.sourceChapterId, m.sourceRevision, m.evidence);
    if (source) rows.push({ id: m.id, kind: 'memory', subject: m.subject, relation: m.relation, object: m.object, source, order: book.chapters.find(c => c.id === m.sourceChapterId)?.order || 0, state: 'history' });
  }
  const temporal = resolveTimeline(book, chapter.id, false);
  for (const e of temporal.events.filter(e => ['active', 'superseded'].includes(e.state))) {
    const source = sourceFor(book, chapter, e.chapterId, e.sourceRevision, e.evidence || '');
    if (source) rows.push({ id: e.id, kind: 'timeline', subject: e.entity || names.get(e.characterId) || '', relation: e.attribute, object: `${e.targetId ? names.get(e.targetId) + ' · ' : ''}${e.value}`, source, order: e.order, state: e.state === 'active' ? 'current' : 'history' });
  }
  // Only explicit, exclusive ownership dimensions can be collapsed. Ordinary facts stay historical.
  const groups = new Map();
  for (const row of rows.filter(r => ownership.test(r.relation.trim()))) {
    const group = groups.get(row.subject) || []; group.push(row); groups.set(row.subject, group);
  }
  for (const group of groups.values()) {
    const latestOrder = Math.max(...group.map(r => r.order));
    const latest = group.filter(r => r.order === latestOrder && (r.kind !== 'timeline' || r.state === 'current'));
    const values = new Set(latest.map(r => r.object));
    for (const r of group) r.state = r.order < latestOrder || (r.kind === 'timeline' && r.state !== 'current') ? 'history' : values.size > 1 ? 'conflict' : 'latest';
  }
  return rows;
}
function inspect(book, chapter, options = {}) {
  const all = records(book, chapter);
  const focus = options.focusId ? all.find(r => r.id === options.focusId) : null;
  const query = focus ? `${focus.subject}\n${focus.object}` : `${options.query || ''}\n${chapter.title}\n${chapter.outline || ''}\n${chapter.summary || ''}\n${Object.values(chapter.writingCard || {}).join('\n')}\n${chapter.body.slice(-1200)}`;
  const queryTerms = terms(query);
  const seeds = new Set(focus ? [focus.subject, focus.object] : []);
  for (const c of book.characters || []) {
    if (c.introducedOrder && c.introducedOrder >= chapter.order) continue;
    const aliases = [c.name, ...[...(c.description || '').matchAll(/(?:别名|又名|化名|绰号|外号)[：:为叫\s]*[“「"]?([\p{Script=Han}A-Za-z0-9·]{2,12})/gu)].map(m => m[1])];
    if (aliases.some(name => name && query.includes(name))) seeds.add(c.name);
  }
  const direct = new Set();
  for (const row of all) {
    const text = `${row.subject} ${row.relation} ${row.object}`;
    if (seeds.has(row.subject) || seeds.has(row.object) || query.includes(row.subject) || queryTerms.some(t => text.includes(t))) direct.add(row.id);
  }
  const neighbors = new Set(seeds);
  for (const row of all.filter(r => direct.has(r.id))) { neighbors.add(row.subject); if (row.object.length <= 40) neighbors.add(row.object); }
  const hasSignal = direct.size > 0;
  const related = all.filter(r => !r.source.chapterId || direct.has(r.id) || neighbors.has(r.subject) || neighbors.has(r.object));
  const selected = book.relatedMemoryOnly === true && hasSignal ? related : all;
  const relatedIds = new Set(related.map(r => r.id));
  const ordered = [...(options.focusId ? focus ? related : [] : selected)].sort((a, b) => Number(direct.has(b.id)) - Number(direct.has(a.id)) || b.order - a.order);
  return { rows: ordered.map(r => ({ ...r, reason: direct.has(r.id) ? '本章或查询直接相关' : !r.source.chapterId ? '作者固定设定' : relatedIds.has(r.id) ? '关联人物或物品' : '完整历史记录' })), selectedIds: selected.map(r => r.id), total: all.length, selectedCount: selected.length, filtered: selected.length < all.length, fallback: book.relatedMemoryOnly === true && !hasSignal, conflicts: ownershipConflicts(selected, chapter.body) };
}
function ownershipConflicts(rows, body) {
  const result = [];
  for (const row of rows) {
    if (row.state === 'conflict') { result.push({ id: row.id, text: `${row.subject}存在同章不同归属记录，请核对交接顺序。`, source: row.source }); continue; }
    if (!ownership.test(row.relation.trim()) || !['latest', 'current'].includes(row.state)) continue;
    // A narrow literal check only; quotes, questions, negation and transfers are deliberately skipped.
    for (const sentence of body.matchAll(/[^。！？\n]+[。！？]?/g)) {
      const text = sentence[0];
      if (/[“”「」"？?]|曾经|原来|过去|以为|假如|如果|梦|不在|并非|不是|交给|转交|递给|归还|收回|抢走/.test(text)) continue;
      const start = text.indexOf(row.subject + '现在在');
      const prefix = start >= 0 ? row.subject + '现在在' : row.subject + '在';
      const offset = text.indexOf(prefix); if (offset < 0) continue;
      const holder = text.slice(offset + prefix.length).match(/^([\p{Script=Han}A-Za-z·]{2,12}?)(?:手中|手里|身上)/u)?.[1];
      if (holder && holder !== row.object) result.push({ id: row.id + ':' + sentence.index, text: `${text.trim()} 与前文记录「${row.subject} · ${row.relation}：${row.object}」可能不一致；若本章发生交接，请核对交接依据。`, source: row.source });
    }
  }
  return result;
}
module.exports = { inspect, records, ownershipConflicts };
