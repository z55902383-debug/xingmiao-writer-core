export type TextMatch = { start: number; end: number };

/** Return textarea-compatible UTF-16 offsets for literal, non-overlapping matches. */
export function findTextMatches(
  text: string,
  query: string,
  caseSensitive = false,
): TextMatch[] {
  if (!query) return [];
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(literal, caseSensitive ? "gu" : "giu");
  return Array.from(text.matchAll(pattern), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/** Replace literal matches without interpreting dollar signs in replacement text. */
export function replaceTextMatches(
  text: string,
  query: string,
  replacement: string,
  caseSensitive = false,
): { text: string; count: number } {
  const matches = findTextMatches(text, query, caseSensitive);
  if (!matches.length) return { text, count: 0 };
  const parts: string[] = [];
  let offset = 0;
  for (const match of matches) {
    parts.push(text.slice(offset, match.start), replacement);
    offset = match.end;
  }
  parts.push(text.slice(offset));
  return { text: parts.join(""), count: matches.length };
}

export { formatManuscript } from "../electron/manuscript-format.mjs";
