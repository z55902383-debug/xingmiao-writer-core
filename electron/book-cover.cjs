function normalize(value) {
  if (value === null) return null;
  if (!value || typeof value.src !== 'string' || value.src.length > 4500000 ||
      !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.src)) {
    throw Error('封面图片无效，请重新上传 JPG、PNG 或 WebP 图片');
  }
  for (const [key, min, max] of [['zoom', 1, 3], ['x', 0, 100], ['y', 0, 100]]) {
    if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw Error('封面调整参数无效');
  }
  return { src: value.src, zoom: value.zoom, x: value.x, y: value.y };
}
module.exports = { normalize };
