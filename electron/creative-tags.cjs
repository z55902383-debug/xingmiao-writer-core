const tools = require('./creative-tool-tags.json');
const TOOL_IDS = tools.map(item => item.id);
function normalize(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(id => typeof id === 'string').map(id => {
    const key = id.startsWith('tool:') ? id.slice(5) : id;
    return TOOL_IDS.includes(key) ? key : tools.find(tool => tool.label === key || tool.label.replace(/生成器$/, '') === key)?.id;
  }).filter(Boolean))];
}
const CHAPTER_TOOLS = require('./creative-task-map.json');
// Shared resources transport tool tags in the existing tasks array. Namespaced
// tags distinguish chapter outline rules from the toolbox outline generator.
function fromTasks(tasks) {
  const values = (Array.isArray(tasks) ? tasks : []).filter(task => typeof task === 'string');
  const explicit = normalize(values.filter(task => task.startsWith('tool:')));
  if (explicit.length) return explicit;
  return normalize([...values, ...values.flatMap(task => CHAPTER_TOOLS[task] || [])]);
}
function skillTags(skill, linkedTasks = []) {
  if (skill.toolTagsMode === 'explicit' || (skill.toolTagsMode !== 'auto' && normalize(skill.toolTags).length)) return normalize(skill.toolTags);
  if (linkedTasks.some(task => typeof task === 'string' && task.startsWith('tool:') && normalize([task]).length)) return fromTasks(linkedTasks);
  return normalize([...fromTasks(skill.tasks), ...fromTasks(linkedTasks)]);
}
function matches(tasks, toolId) { return fromTasks(tasks).includes(toolId); }
module.exports = { TOOL_IDS, normalize, fromTasks, skillTags, matches };
