const tags = require('./creative-tags.cjs');
const reverse = {
  opening: ['write', 'continue', 'polish'],
  outline: ['bookOutline', 'volumePlan', 'volumeOutline'],
  detail: ['volumeDetail', 'chapterPlan', 'chapterDetails', 'outline', 'summary'],
  character: ['characters'], world: ['worldBuild'],
};
function tasksFor(skill, toolTags) {
  const tasks = Array.isArray(skill.tasks) ? skill.tasks : [];
  const explicit = skill.toolTagsMode === 'explicit' || (skill.toolTagsMode !== 'auto' && tags.normalize(skill.toolTags).length);
  return [...new Set([...tasks, ...(explicit ? toolTags.flatMap(tag => reverse[tag] || []) : []),
    ...(tasks.includes('outline') && !explicit ? ['bookOutline', 'volumePlan', 'volumeOutline', 'volumeDetail', 'chapterPlan', 'chapterDetails', 'summary'] : [])])];
}
function reconcile(store) {
  const items = store.setting('plaza-items', []);
  if (!items.some(item => item.installed && !store.setting('writing-skills', []).some(s => s.id === item.installedSkillId))) return;
  store.transaction(() => {
    for (const item of items) {
      if (!item.installed || store.setting('writing-skills', []).some(s => s.id === item.installedSkillId)) continue;
      const scope = tags.fromTasks(item.tasks);
      const chapterTasks = (item.tasks || []).filter(task => !task.startsWith('tool:') && !tags.TOOL_IDS.includes(task) || task === 'outline');
      if (!chapterTasks.length && !scope.length) continue;
      const skill = store.saveSkill({ name: item.title, body: item.body, description: item.description || '', tasks: chapterTasks,
        toolTags: scope, toolTagsMode: tags.normalize(item.tasks).length ? 'explicit' : 'auto', enabled: item.enabled !== false, source: `广场 · ${item.title}` });
      item.installedSkillId = skill.id;
    }
    store.putSetting('plaza-items', items);
  });
}
module.exports = { tasksFor, reconcile };
