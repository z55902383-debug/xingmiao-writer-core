// 深浅主题切换（仅 UI 层，不影响业务逻辑）
// 默认深色（:root 基础值）；浅色通过 data-theme="light" 覆盖同名 token。
const KEY = "xm-theme";

export type Theme = "light" | "dark";

export function applySavedTheme(): void {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
  } catch {
    /* localStorage 不可用时静默降级为默认深色 */
  }
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme): void {
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* 忽略持久化失败 */
  }
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "light" ? "dark" : "light";
  setTheme(next);
  return next;
}

/** Switch themes with the circular View Transition reveal used by beUI. */
export function toggleThemeFrom(element: HTMLElement): Theme {
  const next: Theme = currentTheme() === "light" ? "dark" : "light";
  const root = document.documentElement;
  const bounds = element.getBoundingClientRect();
  root.style.setProperty(
    "--theme-reveal-origin",
    `${bounds.left + bounds.width / 2}px ${bounds.top + bounds.height / 2}px`,
  );

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const startTransition = (document as Document & {
    startViewTransition?: (callback: () => void) => { finished: Promise<void> };
  }).startViewTransition;

  if (reduceMotion || !startTransition) {
    setTheme(next);
    return next;
  }

  root.dataset.themeReveal = "circle";
  let transition: { finished: Promise<void> };
  try {
    // Chromium implements this as a Document method and may require its receiver.
    transition = startTransition.call(document, () => setTheme(next));
  } catch {
    delete root.dataset.themeReveal;
    root.style.removeProperty("--theme-reveal-origin");
    setTheme(next);
    return next;
  }
  const cleanup = () => {
    delete root.dataset.themeReveal;
    root.style.removeProperty("--theme-reveal-origin");
  };
  void transition.finished.then(cleanup, cleanup);
  return next;
}
