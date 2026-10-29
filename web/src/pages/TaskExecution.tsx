import { lazy, Suspense } from 'react';
import type { ChainState, Task } from '../domain/models';
import { taskProgress, formatDuration } from '../domain/task-rules';
import { taskDisplayStatus, type Clock } from '../domain/time';
import { Button, Icon } from '../shared/controls';
import { mountainScene } from '../shared/mountains';

// Optional test accessory: remove this declaration and its render site to detach it.
const EarlyFinishButton = __TEST_BUILD__ ? lazy(() => import('../testing/EarlyFinishButton')) : null;

export function TaskExecution({ task, state, now, busy, home, early, cancel, interrupt, resume, finish, process }: {
  task: Task; state: ChainState; now: number; busy: boolean; home(): void; early(): void; cancel(): void; interrupt(): void; resume(): void; finish(): void; process(): void;
}) {
  const clock: Clock = { now: () => now };
  const progress = taskProgress(task, clock);
  const status = task.status === 'interrupt-pending' ? '中断待判定' : task.status === 'cancel-pending' ? '取消待判定' : taskDisplayStatus(task, clock);
  return <main className="execution"><div className="landscape mountain-landscape" style={{ backgroundImage: `url("${mountainScene(state).image}")` }} aria-hidden="true" /><div className="landscape execution-shade" aria-hidden="true" />
    <Button variant="icon" className="execution-home" aria-label="返回首页" title="返回首页" onClick={home}><Icon name="home" /></Button>
    {EarlyFinishButton && task.status === 'focusing' && <Suspense fallback={null}><EarlyFinishButton task={task} busy={busy} finish={finish} /></Suspense>}
    <div className="timer-scene">
      <svg className="timer-arc" viewBox="0 0 620 620" aria-hidden="true"><path d="M 92.918 527.082 A 307 307 0 1 1 527.082 527.082" pathLength="100" fill="none" stroke="white" strokeOpacity="0.28" strokeWidth="5" />
        <path d="M 92.918 527.082 A 307 307 0 1 1 527.082 527.082" pathLength="100" fill="none" stroke="white" strokeWidth="5" strokeDasharray={`${progress.ratio * 100} 100`} /></svg>
      <p className="timer-status">{status}</p><p className="timer-digits" aria-label={progress.reserved ? '预约剩余时间' : '有效专注时间'}>{formatDuration(progress.milliseconds)}</p>
      <div className="timer-content"><p>{task.content}</p><p>计划专注{task.plannedMinutes}分钟</p></div>
      {!progress.reserved && <p className="timer-percent">{progress.percent}%</p>}
    </div>
    <div className="execution-actions">
      {task.status === 'reserved' && <><Button disabled={busy} onClick={early}>提前开始</Button><Button variant="secondary" disabled={busy} onClick={cancel}>取消预约</Button></>}
      {task.status === 'focusing' && <><Button disabled={busy} onClick={interrupt}>中断</Button>{progress.canFinish && <Button disabled={busy} onClick={finish}>完成</Button>}</>}
      {task.status === 'paused' && <Button disabled={busy} onClick={resume}>继续专注</Button>}
      {(task.status === 'interrupt-pending' || task.status === 'cancel-pending') && <Button disabled={busy} onClick={process}>{task.status === 'cancel-pending' ? '处理取消预约' : '处理本次中断'}</Button>}
    </div>
  </main>;
}
