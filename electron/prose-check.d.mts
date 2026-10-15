export type ProseFinding = { id: string; kind: string; start: number; end: number; excerpt: string; line: number; message: string };
export function checkProse(text: string): ProseFinding[];
