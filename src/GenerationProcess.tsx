import { tr } from './i18n';
import { Modal, Button } from './ui';
import ReferenceOverview from './ReferenceOverview';
import type { Job } from './types';

export default function GenerationProcess({ job, preparing, now, onClose }: { job?: Job; preparing: boolean; now: number; onClose: () => void }) {
  const duration = (start?: string, end?: string, live = false) => {
    const from = Date.parse(start || ''), to = Date.parse(end || '');
    if (!Number.isFinite(from) || (!Number.isFinite(to) && !live)) return tr('耗时未记录');
    return tr('耗时 {0} 秒', { 0: (Math.max(0, (Number.isFinite(to) ? to : now) - from) / 1000).toFixed(1) });
  };
  const active = job?.status === 'running';
  const prose = !!job && ['write', 'continue', 'polish'].includes(job.kind);
  const review = job?.review;
  const generationState = !job ? '等待开始' : active ? '进行中' : job.status === 'done' ? '已完成' : job.status === 'cancelled' ? '已停止' : job.status === 'interrupted' ? '已中断' : '失败';
  const analysisState = !prose ? '不适用' : review?.status === 'analyzing' ? '进行中' : review?.status === 'error' ? /^已停止/.test(review.error || '') ? '已停止' : '失败' : review ? '已完成' : job?.analyzeChanges === false ? '本次未启用' : active ? '等待开始' : '未记录';
  const confirmation = !job || active ? '等待结果' : job.adopted ? review?.status === 'ready' && !review.applied ? '正文已采用，变化待核对' : '结果已采用' : ['done', 'interrupted', 'cancelled'].includes(job.status) && job.output ? '等待作者核对' : '暂无可确认结果';
  return <Modal title={tr('本次生成过程')} wide onClose={onClose}>
    <div className="modal-body generation-process">
      <p>{tr('仅展示软件实际记录的阶段和本次请求资料。旧记录缺少的时间不作推算。')}</p>
      {job && <p className="generation-process-model">{job.targetLabel || ''} · {job.model || tr('模型未记录')}</p>}
      <ol className="generation-process-steps">
        <li data-stage="references"><div><strong>{tr('整理参考资料')}</strong><span>{tr(preparing ? '进行中' : job?.context ? '资料快照已保存' : '等待开始')}</span></div>
          {job?.context && !preparing && <details><summary>{tr('查看本次发送的资料')}</summary><ReferenceOverview context={job.context} snapshot/>{!!job.context.warnings?.length && <ul>{job.context.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}</details>}
        </li>
        <li data-stage="generation"><div><strong>{tr('请求模型与生成内容')}</strong><span>{tr(preparing ? '等待开始' : generationState)}</span></div>
          {!preparing && job && <><p>{duration(job.progress?.requestedAt, job.progress?.generationEndedAt || job.progress?.endedAt, active)}</p><p>{tr('已接收 {0} 字符', { 0: job.output.replace(/\s/g, '').length.toLocaleString() })}{job.progress?.firstOutputAt ? ' · ' + tr('首次响应：{0}', { 0: duration(job.progress.requestedAt, job.progress.firstOutputAt) }) : ''}</p>{job.error && <p className="generation-process-error">{job.error}</p>}</>}
        </li>
        <li data-stage="analysis"><div><strong>{tr('分析故事变化')}</strong><span>{tr(preparing ? '等待开始' : analysisState)}</span></div>
          {!preparing && prose && review && <><p>{duration(job?.progress?.analysisStartedAt, job?.progress?.analysisEndedAt, review.status === 'analyzing')}</p>{review.status === 'ready' && <p>{tr('发现 {0} 条变化，需在变化清单中核对后同步。', { 0: review.changes?.length || 0 })}</p>}{review.status === 'empty' && <p>{tr('本次分析未发现新增变化。')}</p>}{review.applied && <p>{tr('本章变化已确认同步')}</p>}{review.error && <p className="generation-process-error">{review.error}</p>}</>}
        </li>
        <li data-stage="confirmation"><div><strong>{tr('作者核对与采用')}</strong><span>{tr(preparing ? '等待结果' : confirmation)}</span></div><p>{tr('生成和分析完成不会自动写入正文，也不会自动确认记忆。')}</p></li>
      </ol>
    </div><div className="modal-footer"><Button onClick={onClose}>{tr('返回写作')}</Button></div>
  </Modal>;
}
