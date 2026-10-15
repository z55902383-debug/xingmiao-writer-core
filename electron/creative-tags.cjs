const tools = require('./creative-tool-tags.json');
const TOOL_IDS = tools.map(item => item.id);
function normalize(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(id => TOOL_IDS.includes(id)))];
}
// Shared resources transport tool tags in the existing tasks array. Namespaced
// tags distinguish chapter outline rules from the toolbox outline generator.
function fromTasks(tasks) {
  return normalize((Array.isArray(tasks) ? tasks : []).filter(task => typeof task === "string").map(task => task.startsWith('tool:') ? task.slice(5) : task));
}
function matches(tasks, toolId) { return fromTasks(tasks).includes(toolId); }
module.exports = { TOOL_IDS, normalize, fromTasks, matches };
