export type Character = {
  introducedOrder?: number;
  authorNotes?: string;
  readerKnown?: string;
  characterKnown?: string;
  knowledgeFromChapterId?: string;
  secretFromChapterId?: string;
  id: string;
  name: string;
  role: string;
  description: string;
};
export type Foreshadow = {
  id: string;
  title: string;
  plantedChapterId: string;
  payoffChapterId?: string;
  status: "open" | "resolved" | "abandoned";
  note: string;
};
export type WorldRecord = {
  id: string;
  category: string;
  title: string;
  description: string;
  certainty: "fixed" | "provisional";
};
export type WritingDay = { date: string; netWords: number };
export type Memory = {
  id: string;
  subject: string;
  relation: string;
  object: string;
  evidence: string;
  sourceChapterId: string;
  sourceRevision: number;
  stale: boolean;
  createdAt: string;
};
export type Chapter = {
  volumeId?: string;
  summary?: string;
  targetWords?: number;
  id: string;
  bookId: string;
  title: string;
  outline: string;
  body: string;
  status: "draft" | "final";
  revision: number;
  order: number;
  updatedAt: string;
};
export type Kind =
  | "write"
  | "continue"
  | "polish"
  | "outline"
  | "memory"
  | "check"
  | "style"
  | "bookOutline"
  | "volumePlan"
  | "chapterPlan"
  | "chapterDetails"
  | "worldBuild"
  | "characters"
  | "volumeOutline"
  | "volumeDetail"
  | "summary"
  | "timelinePlan";
export type ContextInfo = {
  referenceSections?: { key: string; group: "story" | "writing" | "task"; count?: number; titles?: string[] }[];
  writingReferences?: { id: string; kind: "style" | "requirement"; title: string; body: string }[];
  sourceChapters?: {
    id: string;
    title: string;
    order: number;
    selected: boolean;
    relevance: number;
    matchedTerms: number;
  }[];
  chapterTitles?: string[];
  contextChapters?: number;
  targetWords?: number;
  timelineCount?: number;
  skills?: { id: string; name: string; version: number }[];
  warnings: string[];
  memoryCount: number;
  chapterCount: number;
  characterCount: number;
  characters: number;
};
export type SyncChange = {
  id: string;
  kind: string;
  subject: string;
  target: string;
  attribute: string;
  value: string;
  role: string;
  evidence: string;
};
export type Job = {
  writingProfileSnapshot?: WritingProfile;
  manuscriptFormat?: import("../electron/manuscript-format.mjs").ManuscriptFormat;
  review?: {
    status: string;
    changes?: SyncChange[];
    error?: string;
    applied?: boolean;
  };
  targetVolumeId?: string;
  targetLabel?: string;
  model?: string;
  provider?: string;
  profileName?: string;
  id: string;
  bookId: string;
  chapterId: string;
  kind: Kind;
  instruction: string;
  output: string;
  status: string;
  error: string;
  adopted: boolean;
  createdAt: string;
  baseRevision: number;
  context: ContextInfo;
  usage?: { total_tokens: number };
};
export type Volume = {
  id: string;
  title: string;
  outline: string;
  detail: string;
};
export type TimelineEvent = {
  id?: string;
  kind: "world" | "character" | "relation";
  title: string;
  entity: string;
  characterId: string;
  targetId: string;
  attribute: string;
  value: string;
  chapterId: string;
  phase: "planned" | "confirmed";
  sequence: number;
  storyTime: string;
  evidence: string;
  sourceRevision?: number;
  state?: string;
  chapterTitle?: string;
  order?: number;
};
export type TimelineSnapshot = {
  cutoff?: number;
  events: TimelineEvent[];
  world: TimelineEvent[];
  characters: TimelineEvent[];
  relations: TimelineEvent[];
};
export type Book = {
  writingProfiles?: WritingProfile[];
  writingProfileTrash?: WritingProfile[];
  writingSelection?: WritingSelection;
  foreshadows?: Foreshadow[];
  worldRecords?: WorldRecord[];
  writingActivity?: WritingDay[];
  contextChapters?: number;
  volumes?: Volume[];
  timeline?: TimelineEvent[];
  chapterTargetWords?: number;
  id: string;
  title: string;
  genre: string;
  premise: string;
  outline: string;
  world: string;
  style: string;
  reference: string;
  referenceName: string;
  target: number;
  characters: Character[];
  memories: Memory[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  chapters: Chapter[];
  candidates: Job[];
  memos?: MemoNote[];
};
export type MemoNote = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};
export type BookSummary = Omit<Book, "chapters" | "candidates"> & {
  words: number;
  chapterCount: number;
  recentChapterId?: string;
  recentChapterTitle?: string;
};
export type Config = {
  profileId?: string | null;
  name?: string;
  provider?: "api" | "codex";
  cliPath?: string;
  profiles?: Config[];
  baseUrl: string;
  model: string;
  hasKey: boolean;
  temperature: number | null;
  maxTokens: number;
  tokenParam?: string;
  dataPath: string;
  dataPathSource?: "env" | "custom" | "default";
};
export type Skill = {
  id?: string;
  name: string;
  description: string;
  body: string;
  tasks: Kind[];
  enabled: boolean;
  version?: number;
  source?: string;
};
export type TrashEntry = {
  id: string;
  type: string;
  title: string;
  bookTitle: string;
  deletedAt: string;
};
export type Version = {
  id: string;
  chapterId: string;
  title: string;
  body: string;
  outline: string;
  label: string;
  createdAt: string;
  revision: number;
};
export type UpdateState = {
  status: "idle" | "unconfigured" | "unsupported" | "checking" | "latest" | "available" | "downloading" | "ready" | "installing" | "error";
  currentVersion: string;
  supported: boolean;
  configured: boolean;
  version: string;
  notes: string;
  publishedAt: string;
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
  error: string;
  message: string;
};
declare global {
  interface Window {
    xingmiao?: {
      invoke: (
        action: string,
        data?: unknown,
      ) => Promise<{ ok: boolean; data: unknown; error?: string }>;
      onJob: (fn: (job: Job) => void) => () => void;
      onBrainstorm: (fn: (value: BrainstormEvent) => void) => () => void;
      onClose: (fn: () => void) => () => void;
    };
  }
}

export type PlanningRow = {
  type: "book" | "volume" | "chapter";
  id?: string;
  title: string;
  destination: string;
  volumeId?: string;
  action: "create" | "update";
  preservesBody?: boolean;
  fields: { title?: string; outline?: string; detail?: string; summary?: string };
};

export type BrainstormEvent = {
  requestId: string;
  bookId: string | null;
  output: string;
  status: "running" | "done" | "interrupted" | "cancelled" | "error";
  error: string;
};

export type WritingSelection = { styleIds: string[]; requirementIds: string[] };
export type WritingProfile = {
  id: string; kind: "style" | "requirement"; title: string; body: string;
  source: string; sourceName: string; revision: number;
  createdAt?: string; updatedAt?: string;
  history?: { title: string; body: string; savedAt?: string }[];
};
