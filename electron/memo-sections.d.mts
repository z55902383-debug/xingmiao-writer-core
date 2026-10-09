export type MemoSection = {
  id: string;
  start: number;
  end: number;
  label: string;
  section: string;
};
/** Returns stable information blocks using offsets in the unchanged UTF-16 source. */
export function splitMemoSections(content: string): MemoSection[];
