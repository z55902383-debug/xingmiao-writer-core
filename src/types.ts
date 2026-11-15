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
  /** 本章手动勾选的出场人物 ID 列表；存在时优先生成上下文，覆盖按 order 自动推断。 */
  localCast?: string[];
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
  cheat?: CheatConfig;
  continuityCard?: ContinuityCard;
  relationSources?: { chapterId: string; revision: number }[];
  retrievedExcerpts?: RetrievedExcerpt[];
  referenceSections?: { key: string; group: "story" | "writing" | "task"; count?: number; titles?: string[] }[];
  writingReferences?: { id: string; kind: "style" | "requirement"; title: string; body: string; weight?: number }[];
  imitationReferences?: { id: string; kind: 'imitation'; title: string; body: string; weight: number; revision: number }[];
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
  atlasCount?: number;
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
  chapterSync?: boolean;
  progress?: { requestedAt?: string; firstOutputAt?: string; generationEndedAt?: string; analysisStartedAt?: string; analysisEndedAt?: string; endedAt?: string };
  planningBatch?: import('../electron/chapter-batches.mjs').ChapterBatch;
  lastOutputAt?: string;
  manualMerged?: boolean;
  analyzeChanges?: boolean;
  writingProfileSnapshot?: WritingProfile;
  imitationProfileSnapshot?: ImitationProfile;
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
/* ---------------------------------------------------------------------------
 * 知识蓝图（Atlas）：可切换的多张代码渲染地图。
 * 世界 / 区域 / 地点 / 建筑 / 楼层都是 map（parentMapId 形成从属链，可切换但关联）。
 * 地图上放 node（区域、聚落、地标、建筑、房间、物件），node 之间是 edge。
 * 人物位置（atlasPositions）与物品归属（atlasItems）按章节记录，便于时间线回看。
 * 所有状态都来自作者资料或已定稿正文；不推断、不把计划当成已发生事实。
 * ------------------------------------------------------------------------- */
export type AtlasMapKind = "world" | "region" | "site" | "building" | "floor";
export type AtlasNodeKind = "region" | "settlement" | "landmark" | "building" | "room" | "object";
export type AtlasEdgeKind = "contain" | "route" | "portal" | "link";
export type AtlasStatus = "fixed" | "provisional" | "planned";
export type AtlasPositionStatus = "present" | "mentioned" | "planned";
export type AtlasMap = {
  /** 此地图在上级地图中的入口地点，按编号绑定。 */
  entryNodeId?: string;
  id: string;
  name: string;
  kind: AtlasMapKind;
  /** 所属的上一级地图；空字符串表示根地图（一个世界或一个独立板块）。 */
  parentMapId: string;
  description: string;
  /** 代码渲染的主题：ink | parchment | nocturne | frost。不保存图片。 */
  theme: string;
  status: AtlasStatus;
  /** 来源章节；空字符串表示作者固定设定。 */
  chapterId: string;
  order: number;
  stale?: boolean;
};
export type AtlasNode = {
  id: string;
  mapId: string;
  /** 同地图内的从属节点（例如某个房间属于某座建筑）。 */
  parentId: string;
  kind: AtlasNodeKind;
  name: string;
  description: string;
  /** 地图坐标，0–1000 的画布空间；由代码渲染，可拖动。 */
  x: number;
  y: number;
  status: AtlasStatus;
  chapterId: string;
  stale?: boolean;
  /** 章节变化分析写入的正文逐字证据。 */
  evidence?: string;
};
export type AtlasEdge = {
  id: string;
  mapId: string;
  source: string;
  target: string;
  kind: AtlasEdgeKind;
  label: string;
  status: AtlasStatus;
  chapterId: string;
  stale?: boolean;
  evidence?: string;
};
export type AtlasItem = {
  id: string;
  name: string;
  description: string;
  /** 所在节点；空字符串表示尚未定位。 */
  nodeId: string;
  /** 保管人；空字符串表示无明确归属。 */
  ownerCharacterId: string;
  status: AtlasStatus;
  chapterId: string;
  stale?: boolean;
  evidence?: string;
};
export type AtlasPosition = {
  id: string;
  characterId: string;
  nodeId: string;
  chapterId: string;
  status: AtlasPositionStatus;
  note: string;
  stale?: boolean;
  evidence?: string;
};
export type BookCover = { src: string; zoom: number; x: number; y: number };
export type Book = {
  cover?: BookCover | null;
  atlasMaps?: AtlasMap[];
  atlasNodes?: AtlasNode[];
  atlasEdges?: AtlasEdge[];
  atlasItems?: AtlasItem[];
  atlasPositions?: AtlasPosition[];
  cheat?: CheatConfig;
  includeContinuity?: boolean;
  relatedMemoryOnly?: boolean;
  techniques?: Technique[];
  importedSource?: { name: string; content: string; importedAt: string };
  creationMode?: 'short' | 'long';
  /** Legacy backup field. Selected imitation profiles determine generation references. */
  writingMode?: 'original' | 'imitate';
  imitationProfiles?: ImitationProfile[];
  imitationTrash?: ImitationProfile[];
  imitationSelection?: { ids: string[]; weights: Record<string, number> };
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
export type WritingSelection = { styleIds: string[]; requirementIds: string[]; styleWeights?: Record<string, number> };
export type ImitationProfile = Omit<WritingProfile, 'kind'> & { kind: 'imitation' };
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
  category?: string;
  sourceToolId?: string;
  sourceToolName?: string;
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};
export type CheatHolder = { id: string; name: string; powerName: string; ability: string; trigger: string; limits: string; cost: string; growth: string; reveal: string };
export type CheatConfig = { enabled: boolean; name: string; owner: string; ability: string; limits: string; cost: string; growth: string; reveal: string; notes: string; document?: string; holders?: CheatHolder[] };
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
  toolTagsMode?: 'auto' | 'explicit';
  instructionKind?: "skill" | "prompt";
  plazaItemId?: string;
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
      onCreativeImportProgress: (fn: (value: { requestId: string; outputLength: number }) => void) => () => void;
    };
  }
}
