export type ManuscriptFormat = {
  indent: 0 | 2;
  paragraphSpacing: "blank" | "compact";
  autoIndent: boolean;
  formatAi: boolean;
};
export type ManuscriptJob = {
  kind: string;
  output: string;
  manuscriptFormat?: ManuscriptFormat;
};
export const DEFAULT_MANUSCRIPT_FORMAT: Readonly<ManuscriptFormat>;
export function normalizeManuscriptFormat(value: unknown): ManuscriptFormat;
export function isProseKind(kind: string): boolean;
export function formatManuscript(
  text: string,
  prefs?: ManuscriptFormat,
): string;
export function appendManuscript(
  base: string,
  output: string,
  prefs?: ManuscriptFormat,
): string;
export function formatJobOutput(
  job: ManuscriptJob,
  fallbackPrefs?: ManuscriptFormat,
): string;
export function candidateManuscriptBody(
  base: string,
  job: ManuscriptJob,
  mode?: "replace" | "append",
  fallbackPrefs?: ManuscriptFormat,
): string;
export function manuscriptPrompt(prefs?: ManuscriptFormat): string;
