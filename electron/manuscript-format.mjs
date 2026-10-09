/** Shared by the renderer and main process; no I/O or browser dependencies. */
export const DEFAULT_MANUSCRIPT_FORMAT = Object.freeze({
  indent: 2,
  paragraphSpacing: "blank",
  autoIndent: true,
  formatAi: true,
});

export function normalizeManuscriptFormat(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    indent: input.indent === 0 ? 0 : 2,
    paragraphSpacing:
      input.paragraphSpacing === "compact" ? "compact" : "blank",
    autoIndent: input.autoIndent !== false,
    formatAi: input.formatAi !== false,
  };
}

export function isProseKind(kind) {
  return ["write", "continue", "polish"].includes(kind);
}

/** Adjust paragraph boundaries only; never alter punctuation or internal spaces. */
export function formatManuscript(text, prefs = DEFAULT_MANUSCRIPT_FORMAT) {
  const format = normalizeManuscriptFormat(prefs);
  const indent = "\u3000".repeat(format.indent);
  const separator = format.paragraphSpacing === "compact" ? "\n" : "\n\n";
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => indent + line)
    .join(separator);
}

/** Existing body bytes are retained; only the new prose and its join are formatted. */
export function appendManuscript(
  base,
  output,
  prefs = DEFAULT_MANUSCRIPT_FORMAT,
) {
  const format = normalizeManuscriptFormat(prefs);
  const added = formatManuscript(output, format);
  if (!added) return base;
  if (!base) return added;
  const needed = format.paragraphSpacing === "compact" ? 1 : 2;
  const present = base.match(/\n*$/)[0].length;
  return base + "\n".repeat(Math.max(0, needed - present)) + added;
}

export function formatJobOutput(
  job,
  fallbackPrefs = DEFAULT_MANUSCRIPT_FORMAT,
) {
  if (!isProseKind(job.kind)) return job.output;
  const prefs = normalizeManuscriptFormat(
    job.manuscriptFormat ?? fallbackPrefs,
  );
  return prefs.formatAi ? formatManuscript(job.output, prefs) : job.output;
}

/** Use this same builder for adoption and evidence review so their hashes agree. */
export function candidateManuscriptBody(
  base,
  job,
  mode = "replace",
  fallbackPrefs = DEFAULT_MANUSCRIPT_FORMAT,
) {
  const prefs = normalizeManuscriptFormat(
    job.manuscriptFormat ?? fallbackPrefs,
  );
  if (!isProseKind(job.kind) || !prefs.formatAi) {
    return mode === "append"
      ? base + (base ? "\n\n" : "") + job.output
      : job.output;
  }
  return mode === "append"
    ? appendManuscript(base, job.output, prefs)
    : formatManuscript(job.output, prefs);
}

export function manuscriptPrompt(prefs = DEFAULT_MANUSCRIPT_FORMAT) {
  const format = normalizeManuscriptFormat(prefs);
  if (!format.formatAi) return "";
  return `正文排版：${format.indent ? "每个自然段首行缩进两个全角空格（　　），换行后的续行不要重复缩进" : "每个自然段顶格，不添加首行空格"}；${format.paragraphSpacing === "blank" ? "自然段之间空一行，不连续留多个空行" : "自然段之间仅换行，不额外留空行"}。保持正文文字与标点，不附排版说明、Markdown 标记或章节标题。`;
}
