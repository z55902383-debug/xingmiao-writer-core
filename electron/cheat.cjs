const fields = ['name', 'owner', 'ability', 'limits', 'cost', 'growth', 'reveal', 'notes'];
function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('金手指设定格式无效');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw Error('金手指启用状态无效');
  const result = { enabled: input.enabled === true };
  for (const key of fields) {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || value.length > (['name','owner'].includes(key) ? 160 : 30000)) throw Error('金手指设定字段格式无效或过长');
    result[key] = value;
  }
  if (input.document !== undefined) {
    if (typeof input.document !== 'string' || input.document.length > 300000) throw Error('金手指完整方案格式无效或过长');
    result.document = input.document;
  }
  if (input.holders !== undefined) {
    if (!Array.isArray(input.holders) || input.holders.length > 30) throw Error('金手指持有者列表无效，最多30项');
    const ids = new Set();
    result.holders = input.holders.map(holder => {
      if (!holder || typeof holder !== 'object' || Array.isArray(holder) || typeof holder.id !== 'string' || !holder.id.trim() || holder.id.length > 100 || ids.has(holder.id)) throw Error('金手指持有者标识无效或重复');
      ids.add(holder.id);
      const row = {id:holder.id};
      for (const key of ['name','powerName','ability','trigger','limits','cost','growth','reveal']) {
        const value = holder[key] ?? '';
        if (typeof value !== 'string' || value.length > (['name','powerName'].includes(key) ? 160 : 30000)) throw Error('金手指持有者字段无效或过长');
        row[key] = value;
      }
      return row;
    });
  }
  return result;
}
function active(book) { return book.cheat?.enabled === true ? normalize(book.cheat) : null; }
module.exports = { normalize, active };
