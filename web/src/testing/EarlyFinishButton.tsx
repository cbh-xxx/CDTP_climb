import { useState } from 'react';
import { useClock } from '../app/ClockContext';
import type { Task } from '../domain/models';
import { effectiveMs } from '../domain/time';
import { Button } from '../shared/controls';
import { BrowserTestClock } from './browser-clock';

/** Detachable test-only control. It advances the injected clock, never changes task data. */
export default function EarlyFinishButton({ task, busy, finish }: {
  task: Task; busy: boolean; finish(): void;
}) {
  const clock = useClock();
  const [error, setError] = useState('');
  if (!(clock instanceof BrowserTestClock) || task.status !== 'focusing') return null;

  return <aside aria-label="专注测试操作" style={{ position: 'fixed', top: 24, right: 24, zIndex: 2, maxWidth: 240 }}>
    <Button variant="secondary" disabled={busy} title="推进测试时钟至达标，再按正常流程完成任务" onClick={() => {
      setError('');
      try {
        clock.advance(Math.max(0, task.plannedMinutes * 60_000 - effectiveMs(task, clock)));
        finish();
      } catch {
        setError('测试时钟推进失败，请重试');
      }
    }}>提前完成（测试）</Button>
    {error && <p role="alert" style={{ background: 'white', color: '#20323d', padding: 8, borderRadius: 8 }}>{error}</p>}
  </aside>;
}
