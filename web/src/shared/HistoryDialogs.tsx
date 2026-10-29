import type { ChainState, Round, Task } from '../domain/models';
import { Dialog } from './controls';

export const dateText = (time?: number | null) => time == null ? '未记录' : new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(time);
const timeText = (time: number | null) => time === null ? '未记录' : new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(time);
export function RecordDialog({ task, state, close, feedback }: { task: Task; state: ChainState; close(): void; feedback: string }) {
  const success = task.status === 'succeeded';
  const settlement = state.settlements.find(item => item.taskId === task.id);
  const cancelled = state.decisions.find(item => item.taskId === task.id && item.kind === 'reservation-cancel' && item.outcome === 'allowed');
  const situation = state.precedents.find(item => item.id === cancelled?.precedentId)?.situation ?? '未记录';
  const interruptions = state.interruptions.filter(item => item.taskId === task.id).sort((a, b) => a.startedAt - b.startedAt);
  return <Dialog title={success ? '成功详情' : '预约取消详情'} width={640} onClose={close} feedback={feedback}>
    <div className="history-body"><section><h3>任务内容</h3><p>{task.content}</p></section>
      <section><h3>{success ? '完成日期' : '确认日期'}</h3><p>{dateText('endedAt' in task ? task.endedAt : null)}</p></section>
      {success ? <><div className="history-columns"><section><h3>计划分钟数</h3><p>{task.plannedMinutes}分钟</p></section><section><h3>实际计入分钟数</h3><p>{settlement ? `${settlement.creditedMinutes}分钟` : '未记录'}</p></section></div>
        <section className="interruptions"><h3>中断记录</h3>{interruptions.map(item => <article key={item.id}><p>{state.precedents.find(precedent => precedent.id === item.precedentId)?.situation ?? '未记录'}</p>
          <p className="muted">暂停{item.resumedAt === null ? '未记录' : `${Math.floor(Math.max(0, item.resumedAt - item.startedAt) / 60_000)}分钟`}<br />开始{timeText(item.startedAt)}　恢复{timeText(item.resumedAt)}</p></article>)}</section></>
        : <><section><h3>采用的允许判例</h3><p>{situation}</p></section><p>预约已允许取消</p></>}
    </div>
  </Dialog>;
}
export function RoundSummaryDialog({ rounds, close, feedback }: { rounds: Round[]; close(): void; feedback: string }) {
  return <Dialog title="往轮摘要" width={640} onClose={close} feedback={feedback}><div className="round-summaries">
    {rounds.map(round => <article key={round.id}><h3>第{round.number}轮</h3><p className="muted">{dateText(round.failedAt)}　失效前{round.nodesBeforeFailure == null ? '节点未记录' : `${round.nodesBeforeFailure}节点`}</p>
      <h4>{round.failureReason?.trim() ? '原因' : '违约环节'}</h4><p>{round.failureReason?.trim() || (round.failureStage === 'reservation' ? '预约期间违约' : round.failureStage === 'focus' ? '专注期间违约' : '未记录')}</p></article>)}
  </div></Dialog>;
}
