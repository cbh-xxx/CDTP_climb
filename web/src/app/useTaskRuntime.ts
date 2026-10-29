import { useCallback, useEffect, useRef, useState } from 'react';
import type { Repository } from '../data/repository';
import type { ChainState } from '../domain/models';
import type { TaskCommand, TaskEvent, TaskOutcome } from '../domain/task-commands';
import { activeTask } from '../domain/chains';
import { effectiveMs } from '../domain/time';
import { useClock } from './ClockContext';

export function useTaskRuntime({ repository, state, update, onEvents, onError, onAbort }: {
  repository: Repository; state: ChainState; update(state: ChainState): void; onEvents(events: TaskEvent[]): void; onError(error: unknown): void; onAbort(): void;
}) {
  const clock = useClock();
  const [now, setNow] = useState(clock.now());
  const [busy, setBusy] = useState(false);
  const committing = useRef(false);
  const handlers = useRef({ update, onEvents, onError, onAbort }); handlers.current = { update, onEvents, onError, onAbort };
  const execute = useCallback(async (command: TaskCommand): Promise<TaskOutcome | null> => {
    if (committing.current) return null;
    committing.current = true; setBusy(true);
    try {
      const outcome = await repository.executeTaskCommand(command);
      handlers.current.update(await repository.readChainState());
      if (outcome.aborted) handlers.current.onAbort();
      if (outcome.events.length) handlers.current.onEvents(outcome.events);
      setNow(clock.now());
      return outcome;
    } catch (error) { handlers.current.onError(error); return null; }
    finally { committing.current = false; setBusy(false); }
  }, [repository, clock]);
  useEffect(() => {
    const refresh = () => setNow(clock.now());
    // This timer invalidates the display; it never adds elapsed seconds to a task.
    const timer = setInterval(refresh, 250);
    window.addEventListener('focus', refresh); window.addEventListener('climb-clock-changed', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('climb-clock-changed', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [clock]);
  useEffect(() => {
    const task = activeTask(state);
    if (!task) return;
    const due = task.status === 'reserved' && now >= task.dueAt;
    const goal = task.status === 'focusing' && !task.goalNotified && effectiveMs(task, { now: () => now }) >= task.plannedMinutes * 60_000;
    if (due || goal) void execute({ type: 'tick', taskId: task.id });
  }, [now, state, execute]);
  return { now, busy, execute };
}
