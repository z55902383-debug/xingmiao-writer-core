export type InstructionOverrides = Record<string, boolean>;
export function readOverrides(key: string): InstructionOverrides {
  try { const value = JSON.parse(localStorage.getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([, enabled]) => typeof enabled === 'boolean')) as InstructionOverrides : {}; } catch { return {}; }
}
export function writeOverrides(key: string, value: InstructionOverrides) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep session overrides. */ }
}
export function selectedInstructions<T extends { id?: string; enabled?: boolean }>(items: T[], choices: InstructionOverrides) {
  return items.filter(item => choices[item.id!] ?? item.enabled !== false).map(item => item.id!);
}
