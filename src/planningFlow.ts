import type { Book, Kind } from "./types";
export const ROUTED_PLANNING: Kind[] = ["bookOutline", "volumePlan", "volumeOutline", "volumeDetail", "chapterPlan", "chapterDetails", "summary", "outline"];
export const VOLUME_TASKS: Kind[] = ["volumeOutline", "volumeDetail", "chapterPlan", "chapterDetails"];
export type PlanningStep = { label: string; kind?: Kind; chapterId?: string; volumeId?: string; target: string };
export function nextPlanningStep(book: Book, preferredVolume?: string, preferredChapter?: string): PlanningStep {
  if (!book.premise.trim()) return { label: "写下故事想法", target: "foundation" };
  if (!book.outline.trim()) return { label: "生成全文大纲", kind: "bookOutline", target: "foundation" };
  if (!book.volumes?.length) return { label: "生成分卷规划", kind: "volumePlan", target: "volumes" };
  const volumes = [...book.volumes].sort((a,b) => Number(b.id === preferredVolume) - Number(a.id === preferredVolume));
  for (const volume of volumes) {
    const target = "volume-" + volume.id;
    if (!volume.outline.trim()) return { label: "生成卷大纲", kind: "volumeOutline", volumeId: volume.id, target };
    if (!volume.detail.trim()) return { label: "生成卷细纲", kind: "volumeDetail", volumeId: volume.id, target };
    const chapters = book.chapters.filter(c => c.volumeId === volume.id);
    if (!chapters.length || chapters.some(c => !c.summary?.trim())) return { label: "生成本卷章节规划", kind: "chapterPlan", volumeId: volume.id, target };
    if (chapters.some(c => !c.outline.trim())) return { label: "补全本卷章节细纲", kind: "chapterDetails", volumeId: volume.id, target };
    const unwritten = chapters.find(c => c.id === preferredChapter && !c.body.trim()) || chapters.find(c => !c.body.trim());
    if (unwritten) return { label: "按细纲写正文", kind: "write", chapterId: unwritten.id, volumeId: volume.id, target: "plan-" + unwritten.id };
  }
  const unassigned = book.chapters.find(c => !c.volumeId && !c.body.trim());
  if (unassigned) return { label: "继续规划未分卷章节", chapterId: unassigned.id, target: "plan-" + unassigned.id };
  const draft = book.chapters.find(c => c.status !== "final");
  if (draft) return { label: "核对正文并定稿", chapterId: draft.id, target: "editor" };
  return { label: "全书章节已完成", target: "complete" };
}
