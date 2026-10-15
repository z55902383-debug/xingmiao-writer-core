export type Character = {
  knowledgeStale?: boolean;
  secretStale?: boolean;
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
  staleSourceId?: string;
  stale?: boolean;
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
  proseSources?: { chapterId: string; revision: number }[];
  writingCard?: WritingCard;
  volumePlanIndex?: number;
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
  continuityCard?: ContinuityCard;
  relationSources?: { chapterId: string; revision: number }[];
  retrievedExcerpts?: RetrievedExcerpt[];
  referenceSections?: { key: string; group: "story" | "writing" | "task"; count?: number; titles?: string[] }[];
  writingReferences?: { id: string; kind: "style" | "requirement"; title: string; body: string }[];
  sourceChapters?: {
    revision?: number;
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
  progress?: { requestedAt?: string; firstOutputAt?: string; generationEndedAt?: string; analysisStartedAt?: string; analysisEndedAt?: string; endedAt?: string };
  planningBatch?: import('../electron/chapter-batches.mjs').ChapterBatch;
  lastOutputAt?: string;
  manualMerged?: boolean;
  analyzeChanges?: boolean;
  writingProfileSnapshot?: WritingProfile;
  manuscriptFormat?: import("../electron/manuscript-format.mjs").ManuscriptFormat;
  review?: {
    status: string;
    changes?: SyncChange[];
    error?: string;
    applied?: boolean;
    lastOutputAt?: string;
    revision?: number;
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
  planInBatches?: boolean;
  targetChapters?: number;
  id: string;
  title: string;
  outline: string;
  detail: string;
};
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
export type PlanningSelection = { index: number; title: string; summary?: string; outline?: string };
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
  includeContinuity?: boolean;
  relatedMemoryOnly?: boolean;
  techniques?: Technique[];
  importedSource?: { name: string; content: string; importedAt: string };
  creationMode?: 'short' | 'long';
  completedAt?: string;
  lastExportedAt?: string;
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
export type WritingSelection = { styleIds: string[]; requirementIds: string[] };
export type WritingCard = { must: string; avoid: string; knowledge: string; stop: string };
export type ContinuityCard = { asOfChapterId: string; asOfTitle: string; warning: string; sections: { key: string; title: string; items: { id: string; text: string; source: { chapterId: string; title: string; revision: number; evidence?: string; start?: number; end?: number } }[] }[] };
export type RetrievedExcerpt = { id: string; chapterId: string; revision: number; title: string; order?: number; start: number; end: number; text: string; selected?: boolean; reasons?: string[]; semanticReason?: string };
export type Technique = { id: string; title: string; method: string; useWhen: string; sourceName: string; source: string; evidence: string; enabled: boolean; note: string };
export type WritingProfile = {
  id: string; kind: "style" | "requirement"; title: string; body: string;
  source: string; sourceName: string; revision: number;
  createdAt?: string; updatedAt?: string;
  history?: { title: string; body: string; savedAt?: string }[];
};
export type MemoNote = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};
export type BrainstormEvent = {
  requestId: string;
  bookId: string | null;
  output: string;
  status: "running" | "done" | "interrupted" | "cancelled" | "error";
  error: string;
};
export type KnowledgeChange = {
  key: string; target: string; id: string; operation: "update" | "create" | "delete";
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
};
export type KnowledgeMessage = {
  id: string; role: "user" | "assistant"; content: string;
  status: "running" | "done" | "error" | "cancelled"; error?: string; received?: number;
  proposal?: { id: string; status: "pending" | "applied" | "undone"; changes: KnowledgeChange[]; appliedIds?: string[] };
};
export type KnowledgeSession = { bookId: string; revision: number; messages: KnowledgeMessage[] };
export type BookSummary = Omit<Book, "chapters" | "candidates"> & {
  words: number;
  chapterCount: number;
  finalizedCount?: number;
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
  toolTags?: string[];
  enabled: boolean;
  version?: number;
  source?: string;
};
export type TrashEntry = {
  cleanupAt?: string;
  remainingDays?: number | null;
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
      onKnowledgeChat: (fn: (value: KnowledgeSession) => void) => () => void;
      onClose: (fn: () => void) => () => void;
      onUpdate: (fn: (value: UpdateState) => void) => () => void;
      onAuthToken: (fn: (value: boolean) => void) => () => void;
    };
  }
}
