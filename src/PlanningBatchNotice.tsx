import type { ChapterBatch } from '../electron/chapter-batches.mjs';
import {tr} from './i18n';
export default function PlanningBatchNotice({batch,candidate=false}:{batch:ChapterBatch|null|undefined;candidate?:boolean}) {
  if (!batch) return null;
  return <div className="planning-batch-notice" role="status">
    <strong>{batch.complete ? tr('本卷计划 {0} 章，章节规划已全部采用',{0:batch.total}) : tr('本卷计划 {0} 章，本次生成第 {1}–{2} 章',{0:batch.total,1:batch.start,2:batch.end})}</strong>
    {!batch.complete && <p>{tr('本批待规划 {0} 章；核对并采用后，再继续下一批。',{0:batch.positions.length})}</p>}
    <small>{tr(candidate ? '本批按生成时的范围核对，采用后更新分批进度。' : '每批最多10章，自动参考已采用的章节规划；已有正文保留。')}</small>
    {batch.estimated && <small>{tr('总章数按目标字数估算，首次采用后保存为本卷计划；可先调整章数。')}</small>}
  </div>;
}
