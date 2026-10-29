import type { Task } from './models';

export interface Clock { now(): number }
export const systemClock: Clock = { now: () => Date.now() };
export function effectiveMs(task: Task, clock: Clock): number {
  if (task.status === 'reserved') return Math.max(0, clock.now() - task.dueAt);
  if (task.status === 'cancel-pending') return 0;
  if (task.status === 'focusing') {
    return task.accumulatedMs + Math.max(0, clock.now() - task.runningSince);
  }
  return task.accumulatedMs;
}
export function taskDisplayStatus(task: Task, clock: Clock): string {
  if (task.status === 'reserved' && clock.now() < task.dueAt) return '预约中';
  if (['cancel-pending', 'interrupt-pending', 'paused'].includes(task.status)) return '暂停中';
  if (['succeeded', 'failed', 'cancelled'].includes(task.status)) return '已结束';
  return effectiveMs(task, clock) >= task.plannedMinutes * 60_000 ? '待结算' : '专注中';
}
