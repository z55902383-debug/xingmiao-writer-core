export const MEMO_CATEGORIES = ['未分类', '脑洞灵感', '书名简介', '故事大纲', '章节正文', '人物设定', '世界设定', '金手指', '写作风格', '其他'];
const toolCategories = { cheat:'金手指', brainstorm:'脑洞灵感', bookName:'书名简介', nameTest:'书名简介', intro:'书名简介', outline:'故事大纲', detail:'故事大纲', opening:'章节正文', continuation:'章节正文', characters:'人物设定', character:'人物设定', names:'人物设定', world:'世界设定', style:'写作风格', glossary:'世界设定', matchIdea:'脑洞灵感', matchName:'书名简介', matchIntro:'书名简介' };
export function defaultMemoCategory(toolId) { return toolCategories[toolId] || '其他'; }
export function memoCategory(note) { return note.category?.trim() || '未分类'; }
export function normalizeMemoMetadata(input, current = {}) {
  const read = (key, limit, fallback) => {
    const value = input[key] ?? current[key] ?? fallback;
    if (typeof value !== 'string' || value.length > limit) throw Error('备忘录分类或来源格式无效');
    return value.trim();
  };
  return { category: read('category',40,'未分类') || '未分类', sourceToolId: read('sourceToolId',100,''), sourceToolName: read('sourceToolName',160,'') };
}
export function suggestMemoTitle(toolName, brief, result, existing = []) {
  const clean = value => String(value || '').split(/\r?\n/).map(s=>s.trim()).find(Boolean)?.replace(/^[#*\s\d、.）)\-]+/,'').replace(/[*`]/g,'').replace(/\s+/g,' ').trim() || '';
  const topic = clean(brief) || clean(result) || '创意草稿';
  const base = `${toolName || '创意草稿'} · ${Array.from(topic).slice(0,42).join('')}`;
  const names = new Set(existing.map(note=>note.title));
  let title=base, index=2; while(names.has(title)) title=`${base}（${index++}）`;
  return title;
}
