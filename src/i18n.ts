import { useSyncExternalStore } from "react";
import { english } from "./locales/en";

export type Language = "zh-CN" | "en";
const KEY = "xm-language";
const listeners = new Set<() => void>();
const englishUnits: Record<string, [string, string]> = {
  "章": [" chapter", " chapters"], "天": [" day", " days"],
  "部进行中的作品": ["active story", "active stories"],
  "部达到目标": ["story reached its target", "stories reached their target"],
};
const builtInGenres = new Set(["都市", "悬疑", "玄幻", "仙侠", "科幻", "言情", "历史", "奇幻", "其他"]);
function readLanguage(): Language {
  try { return localStorage.getItem(KEY) === "en" ? "en" : "zh-CN"; }
  catch { return "zh-CN"; }
}
let language = readLanguage();
function applyLanguage() {
  document.documentElement.lang = language;
  document.documentElement.dataset.language = language;
  document.title = language === "en" ? "Xingmiao Writer" : "星喵写作";
}
export function currentLanguage() { return language; }
export function setLanguage(next: Language) {
  if (next !== "zh-CN" && next !== "en") return;
  language = next;
  try { localStorage.setItem(KEY, next); } catch { /* Session-only fallback. */ }
  applyLanguage();
  listeners.forEach(listener => listener());
}
export function useLanguage() {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, currentLanguage, currentLanguage);
}
/** Only interface strings explicitly call this; manuscript and user data stay untouched. */
export function tr(source: string | null | undefined, params: Record<string, string | number | null | undefined> = {}): string {
  if (source == null) return "";
  const unit = language === "en" && params.count != null ? englishUnits[source] : undefined;
  const template = unit ? unit[Number(params.count) === 1 ? 0 : 1] : language === "en" ? english[source] ?? source : source;
  return template.replace(/\{(\d+|[a-zA-Z]\w*)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key] ?? "") : match,
  );
}
export function genreLabel(value: string) { return builtInGenres.has(value) ? tr(value) : value; }
applyLanguage();
window.addEventListener("storage", event => {
  if (event.key === KEY) setLanguage(readLanguage());
});
