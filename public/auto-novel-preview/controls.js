(function(root) {
  function number(value, min, max, fallback) {
    const parsed = value === '' || value == null ? NaN : Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
  }
  function conflict(config) {
    const body = config.customStyle || '';
    const required = body.match(/(?:只能|必须|仅用|采用|使用)\s*(第一人称|第三人称全知|第三人称限知|第三人称)/)?.[1];
    const forbidden = [...body.matchAll(/(?:禁止|不用|不使用|不得使用)\s*(第一人称|第三人称全知|第三人称限知|第三人称)/g)].map(m => m[1]);
    if (config.pov && ((required && !config.pov.startsWith(required)) || forbidden.some(p => config.pov.startsWith(p)))) {
      return '叙事视角与自定义写法冲突，请统一视角后继续。';
    }
    return '';
  }
  const controls = { number, conflict };
  if (typeof module !== 'undefined') module.exports = controls;
  else root.autoNovelControls = controls;
})(globalThis);
