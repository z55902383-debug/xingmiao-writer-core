function fragmentHash(raw) {
  let first = 2166136261;
  let second = 5381;
  for (let i = 0; i < raw.length; i++) {
    const unit = raw.charCodeAt(i);
    first = Math.imul(first ^ unit, 16777619);
    second = Math.imul(second, 33) ^ unit;
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}
function readableLabel(raw) {
  const first = raw.split(/\r\n|\r|\n/).find((line) => line.trim()) || "";
  const clean = first.trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^(?:[-+*]|\d+[.)、]|[一二三四五六七八九十]+[、.)）])\s*/, "")
    .replace(/\s+#+\s*$/, "")
    .replace(/\s+/g, " ");
  const characters = Array.from(clean);
  return characters.length > 72 ? `${characters.slice(0, 72).join("")}…` : clean;
}
function sourceLines(content) {
  return Array.from(content.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g))
    .filter((match) => match[0].length > 0)
    .map((match) => ({ start: match.index, end: match.index + match[1].length, text: match[1] }));
}
const headingOf = (line) => /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
const listOf = (line) => /^(\s*)(?:[-+*]|\d+[.)]|[一二三四五六七八九十]+[、.)）])[ \t]+\S/.exec(line);
const labelledLine = (line) => /^[^：:\r\n]{1,30}[：:][ \t]*\S/.test(line.trim()) ||
  /^(?:\d+[.)、]|[一二三四五六七八九十]+[、.)）])[ \t]*\S/.test(line.trim());
const completeLine = (line) => /[。！？!?；;.…][）)\]”’」』"' \t]*$/.test(line.trim());

/** Parse source offsets only; CSS wrapping never changes memo reference boundaries. */
export function splitMemoSections(content) {
  if (typeof content !== "string" || !content) return [];
  const lines = sourceLines(content);
  const blocks = [];
  const headings = [];
  const occurrences = new Map();
  let pending = null;
  const section = () => headings.map((item) => item.title).join(" / ");
  const push = (start, end, label, currentSection = section()) => {
    const raw = content.slice(start, end);
    if (!raw.trim()) return;
    const occurrence = (occurrences.get(raw) || 0) + 1;
    occurrences.set(raw, occurrence);
    blocks.push({ id: `memo-block:${fragmentHash(raw)}:${occurrence}`, start, end,
      label: label || readableLabel(raw), section: currentSection });
  };
  const flush = () => {
    if (pending) push(pending.start, pending.end, "", pending.section);
    pending = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.text.trim()) { flush(); continue; }
    const fence = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line.text);
    if (fence) {
      flush();
      const marker = fence[1][0];
      const close = new RegExp(`^[ \\t]*${marker}{${fence[1].length},}[ \\t]*$`);
      let last = i;
      while (last + 1 < lines.length) {
        last++;
        if (close.test(lines[last].text)) break;
      }
      push(line.start, lines[last].end, fence[2].trim() ? `代码：${fence[2].trim()}` : "代码片段");
      i = last;
      continue;
    }
    const heading = headingOf(line.text);
    const setext = !heading && i + 1 < lines.length && /^ {0,3}(?:=+|-{3,})[ \t]*$/.test(lines[i + 1].text);
    if (heading || setext) {
      flush();
      const level = heading ? heading[1].length : lines[i + 1].text.trim()[0] === "=" ? 1 : 2;
      const title = (heading ? heading[2] : line.text).trim().replace(/[ \t]+#+[ \t]*$/, "");
      while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
      headings.push({ level, title });
      push(line.start, setext ? lines[++i].end : line.end, title);
      continue;
    }
    const list = listOf(line.text);
    if (list) {
      flush();
      pending = { start: line.start, end: line.end, kind: "list",
        indent: list[1].replace(/\t/g, "    ").length, section: section(), last: line.text };
      continue;
    }
    const indent = (line.text.match(/^[ \t]*/)?.[0] || "").replace(/\t/g, "    ").length;
    if (pending?.kind === "list" && indent > pending.indent) {
      pending.end = line.end;
      pending.last = line.text;
      continue;
    }
    // An explicit note field or completed source line is a separate information item.
    // Unfinished hard-wrapped prose stays together until its paragraph is complete.
    if (pending && (pending.kind === "list" || labelledLine(line.text) ||
      labelledLine(pending.last) || completeLine(pending.last))) flush();
    if (!pending) pending = { start: line.start, end: line.end, kind: "paragraph",
      indent, section: section(), last: line.text };
    else { pending.end = line.end; pending.last = line.text; }
  }
  flush();
  return blocks;
}
