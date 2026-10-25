export const MEMO_CATEGORIES: string[];
export function defaultMemoCategory(toolId: string): string;
export function memoCategory(note: { category?: string }): string;
export function normalizeMemoMetadata(input: { category?: unknown; sourceToolId?: unknown; sourceToolName?: unknown }, current?: { category?: string; sourceToolId?: string; sourceToolName?: string }): { category: string; sourceToolId: string; sourceToolName: string };
export function suggestMemoTitle(toolName: string, brief: string, result: string, existing?: {title:string}[]): string;
