import type { Chain, ChainState } from '../domain/models';
import { activeTask } from '../domain/chains';
import { taskDisplayStatus } from '../domain/time';
import { useClock } from '../app/ClockContext';
import { Button, Icon } from './controls';
import { useTaskActions } from '../app/TaskActionsContext';

export function ChainActions({ chain, state, notify, newRound }: { chain: Chain; state: ChainState; notify(message: string): void; newRound(): void }) {
  const actions = useTaskActions();
  const task = activeTask(state);
  if (chain.status === 'needs-round') return <Button onClick={newRound}>设置新一轮</Button>;
  if (chain.status === 'archived') return null;
  if (task?.chainId === chain.id) return <Button onClick={actions.returnTask}>返回任务</Button>;
  return <><Button unavailableReason={task ? '请先处理当前任务' : undefined} onFeedback={notify} onClick={() => actions.prepare(chain.id, false)}>开始</Button>
    <Button variant="secondary" unavailableReason={task ? '请先处理当前任务' : undefined} onFeedback={notify} onClick={() => actions.prepare(chain.id, true)}>预约</Button></>;
}
export function ChainRow({ chain, state, open, notify, newRound, more, compact = false }: {
  chain: Chain; state: ChainState; open(): void; notify(message: string): void; newRound(): void;
  more?(anchor: HTMLButtonElement): void; compact?: boolean;
}) {
  const clock = useClock();
  const task = activeTask(state);
  return <div className={`chain-row ${compact ? 'chain-row--compact' : ''}`} onClick={event => {
    if (!(event.target instanceof Element) || !event.target.closest('button')) open();
  }}>
    <button className="chain-row__name" onClick={open} title={chain.name}>
      {chain.status === 'needs-round' && <img className="failed-stamp" src="/icons/failed.svg" alt="" aria-hidden="true" width="46.5" height="42" />}
      <span>{chain.name}</span>{task?.chainId === chain.id && <small>{taskDisplayStatus(task, clock)}</small>}
    </button>
    <div className="chain-row__actions"><ChainActions chain={chain} state={state} notify={notify} newRound={newRound} />
      {more && <Button variant="icon" aria-label={`管理${chain.name}`} onClick={event => more(event.currentTarget)}><Icon name="more" /></Button>}</div>
  </div>;
}
