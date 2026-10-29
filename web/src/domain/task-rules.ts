import type { ChainState, Task } from './models';
import { characterCount, normalizeText, unfinished } from './chains';
import { effectiveMs, type Clock } from './time';

export const RESERVATION_MINUTES = [5, 10, 15, 30, 45, 60] as const;
export function preparationError(content: string, plannedMinutes: number | null, reservationMinutes: number | null, reserved: boolean): string {
  if (!normalizeText(content)) return '请输入任务内容';
  if (characterCount(normalizeText(content)) > 15) return '任务内容最多15个字符';
  if (plannedMinutes === null) return '请选择专注时长';
  if (!Number.isInteger(plannedMinutes) || plannedMinutes < 5 || plannedMinutes > 1435 || plannedMinutes % 5) return '专注时长须为5分钟至23小时55分钟，按5分钟选择';
  if (reserved && !RESERVATION_MINUTES.some(value => value === reservationMinutes)) return '请选择预约时长';
  return '';
}
export function effectivePrecedents(state: ChainState, roundId: string) {
  const round = state.rounds.find(item => item.id === roundId);
  if (!round) return [];
  const links = state.roundPrecedents.filter(link => link.roundId === roundId);
  return state.precedents.filter(item => item.chainId === round.chainId && links.some(link => link.precedentId === item.id))
    .sort((a, b) => Math.max(...links.filter(link => link.precedentId === b.id).map(link => link.createdAt)) - Math.max(...links.filter(link => link.precedentId === a.id).map(link => link.createdAt)) || a.id.localeCompare(b.id));
}
export function taskContentCandidates(state: ChainState, chainId: string) {
  const byText = new Map<string, ChainState['taskContents'][number]>();
  for (const item of state.taskContents.filter(item => item.chainId === chainId)) {
    const key = normalizeText(item.content);
    if (!byText.has(key) || byText.get(key)!.lastUsedAt < item.lastUsedAt) byText.set(key, item);
  }
  return [...byText.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt || a.id.localeCompare(b.id));
}
export type DecisionInput = { outcome: 'violation'; reason: string } | { outcome: 'allowed'; source: 'existing'; precedentId: string } | { outcome: 'allowed'; source: 'new'; situation: string; precedentId: string };
export function decisionError(state: ChainState, task: Task, input: DecisionInput): string {
  if (input.outcome === 'violation') return characterCount(normalizeText(input.reason)) > 15 ? '违规原因最多15个字符' : '';
  const precedents = effectivePrecedents(state, task.roundId);
  if (input.source === 'existing') return precedents.some(item => item.id === input.precedentId) ? '' : '请选择允许判例';
  const situation = normalizeText(input.situation);
  if (!situation) return '请输入新的允许情境';
  if (characterCount(situation) > 15) return '允许情境最多15个字符';
  if (precedents.some(item => normalizeText(item.situation) === situation)) return '情境已存在，请修改或选择已有判例';
  return '';
}
export function taskProgress(task: Task, clock: Clock) {
  const reserved = task.status === 'reserved' || task.status === 'cancel-pending';
  const milliseconds = task.status === 'cancel-pending' ? task.remainingMs : task.status === 'reserved' ? Math.max(0, task.dueAt - clock.now()) : effectiveMs(task, clock);
  const ratio = reserved ? 0 : Math.min(1, effectiveMs(task, clock) / (task.plannedMinutes * 60_000));
  const percent = reserved ? 0 : Math.min(100, Math.floor(effectiveMs(task, clock) / (task.plannedMinutes * 600)));
  return { reserved, milliseconds, percent, ratio, canFinish: task.status === 'focusing' && effectiveMs(task, clock) >= task.plannedMinutes * 60_000 };
}
export function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
}
export function taskIsRecoverable(state: ChainState, task: Task): boolean {
  const timestamp = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const chain = state.chains.find(item => item.id === task.chainId);
  const round = state.rounds.find(item => item.id === task.roundId && item.chainId === task.chainId);
  if (!chain || chain.status !== 'available' || chain.currentRoundId !== task.roundId || !round || round.status !== 'active') return false;
  if (typeof task.content !== 'string' || preparationError(task.content, task.plannedMinutes, null, false) || typeof task.id !== 'string' || typeof task.ownerId !== 'string' || !timestamp(task.createdAt) || !timestamp(task.updatedAt)) return false;
  if (![round.nodes, round.remainderMinutes, round.successfulMinutes].every(timestamp) || round.remainderMinutes >= 30 || round.successfulMinutes !== round.nodes * 30 + round.remainderMinutes) return false;
  if (task.status === 'reserved') return timestamp(task.dueAt);
  if (task.status === 'cancel-pending') return timestamp(task.remainingMs) && typeof task.pendingDecisionId === 'string';
  if (task.status === 'focusing') return timestamp(task.accumulatedMs) && timestamp(task.runningSince);
  if (task.status === 'interrupt-pending') return timestamp(task.accumulatedMs) && timestamp(task.pauseStartedAt) && typeof task.pendingDecisionId === 'string' && typeof task.pendingInterruptionId === 'string';
  if (task.status === 'paused') return timestamp(task.accumulatedMs) && (!task.pendingInterruptionId || state.interruptions.some(item => item.id === task.pendingInterruptionId && item.taskId === task.id && item.resumedAt === null));
  return !unfinished(task);
}
