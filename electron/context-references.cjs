// Describe only nonempty fields in the actual model payload, without duplicating their bodies.
function describeReferences(data, writingReferences = [], skills = [], instruction = '') {
  const rows = [];
  const add = (key, group, present, count, titles) => {
    if (present) rows.push({ key, group, ...(count == null ? {} : { count }), ...(titles?.length ? { titles } : {}) });
  };
  const text = value => typeof value === 'string' && !!value.trim();
  const records = value => typeof value === 'string' ? JSON.parse(value) : value || [];
  add('book', 'story', data.book?.title, undefined, [data.book?.title]);
  for (const [key, field] of [['premise','premise'], ['bookOutline','outline'], ['world','world']]) add(key,'story',text(data.book?.[field]));
  for (const [key, field] of [['characters','characters'], ['worldRecords','worldRecords'], ['foreshadows','openForeshadows'], ['memories','facts']]) {
    const entries = records(data[field]); add(key,'story',entries.length,entries.length,entries.map(row => row.name || row.title).filter(Boolean));
  }
  const temporal = data.timelineState ? JSON.parse(data.timelineState) : {};
  const states = Object.values(temporal).flat(); add('timeline','story',states.length,states.length);
  const plans = records(data.currentChapterPlans); add('chapterPlans','story',plans.length,plans.length);
  add('volume','story',data.volumePlan,undefined,[data.volumePlan?.title]);
  add('structure','story',data.storyStructure, (data.storyStructure?.volumes.length || 0) + (data.storyStructure?.chapters.length || 0));
  add('targetVolume','task',data.targetVolume,undefined,[data.targetVolume?.title]);
  add('chapterOutline','task',text(data.chapter?.outline)); add('chapterBody','task',text(data.chapter?.body));
  add('chapterSummary','task',text(data.chapter?.summary));
  add('availableIds','task',data.availableIds, (data.availableIds?.characters.length || 0) + (data.availableIds?.chapters.length || 0));
  add('recent','story',data.recent?.length,data.recent?.length,data.recent?.map(row => row.title));
  for (const [key, kind] of [['writingStyles','style'], ['writingRequirements','requirement']]) {
    const selected = writingReferences.filter(row => row.kind === kind); add(key,'writing',selected.length,selected.length,selected.map(row => row.title));
  }
  add('skills','writing',skills.length,skills.length,skills.map(row => row.name));
  add('source','task',text(data.reference),undefined,data.referenceName ? [data.referenceName] : []);
  add('instruction','task',text(instruction));
  return rows;
}
module.exports = { describeReferences };
