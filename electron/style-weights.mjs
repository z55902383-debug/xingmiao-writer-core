// Largest-remainder allocation keeps integer percentages at exactly 100.
export function normalizeWeights(ids, weights = {}) {
  if (!ids.length) return {};
  const values = ids.map(id => Number.isFinite(weights[id]) && weights[id] >= 0 ? weights[id] : 0);
  const sum = values.reduce((a, b) => a + b, 0);
  const shares = values.map(value => sum ? value * 100 / sum : 100 / ids.length);
  const result = shares.map(Math.floor);
  const order = shares.map((value, i) => ({ i, fraction: value - result[i] })).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  const remaining = 100 - result.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remaining; i++) result[order[i].i]++;
  return Object.fromEntries(ids.map((id, i) => [id, result[i]]));
}

export function reselectWeights(ids, previousIds, weights = {}) {
  const old = normalizeWeights(previousIds, weights);
  const added = ids.filter(id => !previousIds.includes(id));
  if (!added.length) return normalizeWeights(ids, old);
  const seed = Object.fromEntries(ids.map(id => [id, added.includes(id) ? 100 / Math.max(1, previousIds.length) : old[id] || 0]));
  return normalizeWeights(ids, seed);
}
