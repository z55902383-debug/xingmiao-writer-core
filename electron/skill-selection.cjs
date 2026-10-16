function resolveSkills(skills, kind, skillIds) {
  if (skillIds === undefined) return skills.filter(skill => skill.enabled && skill.tasks.includes(kind));
  if (!Array.isArray(skillIds) || new Set(skillIds).size !== skillIds.length || skillIds.some(id => typeof id !== 'string'))
    throw Error('本次 Skill 选择无效，请重新选择。');
  const selected = skillIds.map(id => {
    const skill = skills.find(item => item.id === id);
    if (!skill) throw Error('所选 Skill 已删除，请刷新列表后重新选择。');
    return skill;
  });
  return selected.filter(skill => skill.tasks.includes(kind));
}
module.exports = { resolveSkills };
