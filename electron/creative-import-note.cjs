const { importTargets, fieldsFor } = require('./creative-import-schema.mjs');

// The complete structured result belongs to the import record, never to prose.
function formatImportNote(source, { target, rows, unassigned = [] }) {
  const spec = importTargets[target];
  if (!spec) return source;
  const destinations = rows.map(row => {
    const fields = row.fields || {};
    const name = [fields.name || fields.title, fields.powerName].filter(Boolean).join(' · ') || (row.type === 'shared' ? '共同规则' : spec.label);
    const schema = fieldsFor(target, row.type);
    const labels = Object.keys(fields).map(key => schema[key]?.label).filter(Boolean);
    return `- ${row.id || row.type === 'shared' ? '更新' : '新增'}：${name}${labels.length ? `（${labels.join('、')}）` : ''}`;
  });
  return source + '\n\n---\n\n## 导入记录\n\n' + `写入板块：${spec.label}\n\n` + destinations.join('\n') +
    (unassigned.length ? `\n\n有 ${unassigned.length} 段原文未归入目标字段，已完整保留在上方原文中。` : '');
}

function readableImportMemo(note) {
  if (note?.sourceToolName !== '工具箱分析导入' || note.category !== '导入来源' || typeof note.content !== 'string') return note;
  const marker = '\n\n---\n导入去向：\n';
  const index = note.content.lastIndexOf(marker);
  if (index < 0) return note;
  try {
    const record = JSON.parse(note.content.slice(index + marker.length));
    if (!record || typeof record.tool !== 'string' || !importTargets[record.target] || !Array.isArray(record.rows) || !Array.isArray(record.unassigned)) return note;
    if (!record.rows.every(row => row && importTargets[record.target].types.includes(row.type) && row.fields && typeof row.fields === 'object' && !Array.isArray(row.fields) && Array.isArray(row.sources))) return note;
    return { ...note, content: formatImportNote(note.content.slice(0, index), record) };
  } catch {
    // Never strip unrecognized/truncated JSON or user-authored content.
    return note;
  }
}

module.exports = { formatImportNote, readableImportMemo };
