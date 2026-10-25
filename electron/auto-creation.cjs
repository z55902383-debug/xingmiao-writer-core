const controlsPath = require('node:path').join(__dirname,'../dist/auto-novel-preview/controls.js');
const controls = require(require('node:fs').existsSync(controlsPath) ? controlsPath : '../public/auto-novel-preview/controls.js');

function normalize(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('自动创作配置格式无效');
  const conflict = controls.conflict(value);
  if (conflict) throw Error(conflict);
  const config = JSON.parse(JSON.stringify(value));
  for (const [key, min, max, fallback] of [['chapterWords',100,20000,2000],['retries',0,5,2],['callLimit',10,1000,100]]) {
    config[key] = controls.number(config[key],min,max,fallback);
  }
  for (const key of ['world','characters','outline',...(config.gold ? ['cheat'] : [])]) {
    const mode = config.prepareModes?.[key];
    if (mode === '沿用已有资料') throw Error('请先选择真实资料来源；当前可改用自动准备或手动填写');
    if (mode === '手动填写' && (typeof config.prepareNotes?.[key] !== 'string' || !config.prepareNotes[key].trim())) throw Error('请补全手动填写的前期资料');
  }
  return {...config,run:false,playing:false,creating:false,issue:false,logs:[],tick:0};
}

function narrative(config) {
  return [config.pov && `叙事视角：${config.pov}`, config.tone && `语气：${config.tone}`,
    config.dialogue && `对白倾向：${config.dialogue}（软偏好）`, config.customStyle && `自定义写法：${config.customStyle}`,
    config.must && `必须写入（按指定章节安排，勿每章重复）：${config.must}`, config.avoid && `禁止出现：${config.avoid}`,
    config.freedom && `新增设定权限：${config.freedom}；不得改写已确认事实`
  ].filter(Boolean).join('\n');
}
module.exports = {normalize, narrative};
