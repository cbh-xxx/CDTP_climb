import type { ChainState, Entity, Task } from './models';
import type { RecordWrite } from './chain-commands';
import { normalizeText, unfinished, totalNodes } from './chains';
import { creditSuccess, reachedLevel } from './climb';
import { effectiveMs } from './time';
import { decisionError, preparationError, taskIsRecoverable, type DecisionInput } from './task-rules';

export type TaskCommand =
  | { type: 'start'; taskId: string; chainId: string; expectedRoundId: string; content: string; plannedMinutes: number; reservationMinutes: number | null }
  | { type: 'tick'; taskId: string }
  | { type: 'early-start'; taskId: string }
  | { type: 'cancel-request'; taskId: string; decisionId: string }
  | { type: 'interrupt'; taskId: string; decisionId: string; interruptionId: string }
  | { type: 'close-decision'; taskId: string; decisionId: string }
  | { type: 'decide'; taskId: string; decisionId: string; input: DecisionInput }
  | { type: 'resume'; taskId: string }
  | { type: 'finish'; taskId: string };
export interface TaskEvent { taskId: string; kind: 'reservation-due' | 'goal-reached' }
export interface TaskOutcome { taskId?: string; settlementId?: string; events: TaskEvent[]; aborted?: boolean }
export interface TaskChanges extends TaskOutcome { writes: RecordWrite[]; deletes: { store: keyof ChainState; id: string }[] }
export const emptyTaskChanges = (): TaskChanges => ({ writes: [], deletes: [], events: [] });
const ended = (state: ChainState, id: string) => state.settlements.find(item => item.taskId === id);

export function planTaskCommand(state: ChainState, command: TaskCommand, now: number): TaskChanges {
  const changes = emptyTaskChanges();
  changes.taskId = command.taskId;
  const settled = ended(state, command.taskId);
  if (settled) { changes.settlementId = settled.id; return changes; }
  const ownerId = state.metadata.find(item => item.id === 'local-owner')?.ownerId;
  if (!ownerId) throw new Error('本地归属缺失，任务未保存');
  const entity = (id: string): Entity => ({ id, ownerId, accountId: null, createdAt: now, updatedAt: now });
  if (command.type === 'start') {
    const existing = state.tasks.find(item => item.id === command.taskId);
    if (existing) {
      if (existing.chainId !== command.chainId || existing.roundId !== command.expectedRoundId) throw new Error('任务请求标识冲突');
      return changes;
    }
    if (state.occupancy.length || state.tasks.some(task => unfinished(task) && !ended(state, task.id))) throw new Error('请先处理当前任务');
    const chain = state.chains.find(item => item.id === command.chainId);
    const round = state.rounds.find(item => item.id === command.expectedRoundId && item.chainId === command.chainId);
    if (!chain || chain.currentRoundId !== command.expectedRoundId || chain.status !== 'available' || !round || round.status !== 'active') throw new Error('链条状态已变化，请重新准备任务');
    const invalid = preparationError(command.content, command.plannedMinutes, command.reservationMinutes, command.reservationMinutes !== null);
    if (invalid) throw new Error(invalid);
    const base = { ...entity(command.taskId), chainId: chain.id, roundId: round.id, content: normalizeText(command.content), plannedMinutes: command.plannedMinutes,
      focusStartedAt: command.reservationMinutes === null ? now : null, pauseStartedAt: null, pendingDecisionId: null, pendingInterruptionId: null, dueNotified: command.reservationMinutes === null, goalNotified: false };
    const task: Task = command.reservationMinutes === null ? { ...base, status: 'focusing', accumulatedMs: 0, runningSince: now } : { ...base, status: 'reserved', dueAt: now + command.reservationMinutes * 60_000 };
    if (!taskIsRecoverable(state, task)) throw new Error('当前链条数据无法可靠读取，未建立任务');
    const previous = state.taskContents.find(item => item.chainId === chain.id && normalizeText(item.content) === base.content);
    changes.writes.push({ store: 'tasks', kind: 'add', value: task }, { store: 'occupancy', kind: 'add', value: { id: 'active', taskId: task.id } },
      { store: 'chains', kind: 'put', value: { ...chain, lastStartedAt: now, updatedAt: now } },
      { store: 'taskContents', kind: previous ? 'put' : 'add', value: { ...(previous ?? entity(`${task.id}:content`)), chainId: chain.id, content: base.content, lastUsedAt: now, updatedAt: now } });
    return changes;
  }
  const stored = state.tasks.find(item => item.id === command.taskId);
  if (!stored) return cleanupTask(state, command.taskId);
  let task: Task = stored;
  if (!unfinished(task)) throw new Error('任务已经结束');
  if (!taskIsRecoverable(state, task)) return cleanupTask(state, task.id);
  const originalStatus = task.status;
  const putTask = (next: Task) => { task = next; changes.writes.push({ store: 'tasks', kind: 'put', value: next }); };
  if (task.status === 'reserved' && now >= task.dueAt) {
    const start = task.dueAt;
    const dueNotified = task.dueNotified;
    putTask({ ...task, status: 'focusing', accumulatedMs: 0, runningSince: start, focusStartedAt: start, dueNotified: true, updatedAt: now });
    if (!dueNotified) changes.events.push({ taskId: task.id, kind: 'reservation-due' });
  }
  if (command.type === 'tick') {
    if (task.status === 'focusing' && !task.goalNotified && effectiveMs(task, { now: () => now }) >= task.plannedMinutes * 60_000) {
      putTask({ ...task, goalNotified: true, updatedAt: now }); changes.events.push({ taskId: task.id, kind: 'goal-reached' });
    }
    return changes;
  }
  if (command.type === 'early-start') {
    if (task.status === 'reserved') putTask({ ...task, status: 'focusing', accumulatedMs: 0, runningSince: now, focusStartedAt: now, dueNotified: true, updatedAt: now });
    return changes;
  }
  if (command.type === 'cancel-request') {
    if (task.status === 'cancel-pending') return changes;
    if (task.status !== 'reserved') { if (originalStatus === 'reserved') return changes; throw new Error('预约已经结束，请按正式中断处理'); }
    putTask({ ...task, status: 'cancel-pending', remainingMs: Math.max(0, task.dueAt - now), pendingDecisionId: command.decisionId, updatedAt: now });
    return changes;
  }
  if (command.type === 'interrupt') {
    if (task.status === 'interrupt-pending') return changes;
    if (task.status !== 'focusing') throw new Error('当前任务不能发起正式中断');
    putTask({ ...task, status: 'interrupt-pending', accumulatedMs: effectiveMs(task, { now: () => now }), pauseStartedAt: now, pendingDecisionId: command.decisionId, pendingInterruptionId: command.interruptionId, updatedAt: now });
    return changes;
  }
  if (command.type === 'close-decision') {
    if (task.pendingDecisionId !== command.decisionId) return changes;
    if (task.status === 'cancel-pending') putTask({ ...task, status: 'reserved', dueAt: now + task.remainingMs, pendingDecisionId: null, updatedAt: now });
    // Formal interruption deliberately remains pending and frozen.
    return changes;
  }
  if (command.type === 'resume') {
    if (task.status === 'focusing') return changes;
    if (task.status !== 'paused') throw new Error('请先处理本次中断判定');
    const interruption = state.interruptions.find(item => item.id === task!.pendingInterruptionId && item.taskId === task!.id && item.resumedAt === null);
    if (interruption) changes.writes.push({ store: 'interruptions', kind: 'put', value: { ...interruption, resumedAt: now, updatedAt: now } });
    putTask({ ...task, status: 'focusing', runningSince: now, pendingInterruptionId: null, pauseStartedAt: null, updatedAt: now });
    return changes;
  }
  let outcome: 'succeeded' | 'failed' | 'cancelled';
  let reason: string | null = null;
  if (command.type === 'decide') {
    if (task.status !== 'cancel-pending' && task.status !== 'interrupt-pending') {
      if (state.decisions.some(item => item.id === command.decisionId && item.taskId === task!.id)) return changes;
      throw new Error('当前没有待处理的判定');
    }
    if (task.pendingDecisionId !== command.decisionId) throw new Error('判定状态已变化，请重新打开');
    const invalid = decisionError(state, task, command.input); if (invalid) throw new Error(invalid);
    const input = command.input;
    let precedentId: string | null = null;
    if (input.outcome === 'allowed') {
      precedentId = input.precedentId;
      if (input.source === 'new') changes.writes.push({ store: 'precedents', kind: 'add', value: { ...entity(input.precedentId), chainId: task.chainId, situation: normalizeText(input.situation) } },
        { store: 'roundPrecedents', kind: 'add', value: { ...entity(`${task.roundId}:${input.precedentId}`), roundId: task.roundId, precedentId: input.precedentId } });
    } else reason = normalizeText(input.reason) || null;
    changes.writes.push({ store: 'decisions', kind: 'add', value: { ...entity(command.decisionId), taskId: task.id, kind: task.status === 'cancel-pending' ? 'reservation-cancel' : 'focus-interrupt', outcome: input.outcome, precedentId, reason } });
    if (input.outcome === 'allowed' && task.status === 'interrupt-pending') {
      changes.writes.push({ store: 'interruptions', kind: 'add', value: { ...entity(task.pendingInterruptionId!), chainId: task.chainId, taskId: task.id, precedentId: precedentId!, startedAt: task.pauseStartedAt!, resumedAt: null } });
      putTask({ ...task, status: 'paused', pendingDecisionId: null, updatedAt: now });
      return changes;
    }
    outcome = input.outcome === 'violation' ? 'failed' : 'cancelled';
  } else {
    if (task.status !== 'focusing' || effectiveMs(task, { now: () => now }) < task.plannedMinutes * 60_000) throw new Error('须在专注执行状态下达到计划有效时长后才能完成');
    outcome = 'succeeded';
  }
  const round = state.rounds.find(item => item.id === task!.roundId)!;
  const chain = state.chains.find(item => item.id === task!.chainId)!;
  const duration = effectiveMs(task, { now: () => now });
  const credit = creditSuccess(round.successfulMinutes, duration);
  let resultNodes = round.nodes;
  if (outcome === 'succeeded') {
    resultNodes = credit.nodes;
    changes.writes.push({ store: 'rounds', kind: 'put', value: { ...round, successfulMinutes: credit.totalMinutes, nodes: credit.nodes, remainderMinutes: credit.remainderMinutes, updatedAt: now } });
    const currentTotal = totalNodes(state) - round.nodes + credit.nodes;
    const highest = Math.max(currentTotal, ...state.climbRecords.map(item => item.highestTotalNodes));
    const highestLevel = Math.max(reachedLevel(currentTotal), ...state.climbRecords.map(item => item.highestLevel));
    const record = state.climbRecords.find(item => item.id === 'climb-history');
    changes.writes.push({ store: 'climbRecords', kind: 'put', value: { ...(record ?? entity('climb-history')), highestTotalNodes: highest, highestLevel, updatedAt: now } });
  } else if (outcome === 'failed') {
    resultNodes = 0;
    changes.writes.push({ store: 'rounds', kind: 'put', value: { ...round, status: 'failed', successfulMinutes: 0, nodes: 0, remainderMinutes: 0, failedAt: now, nodesBeforeFailure: round.nodes, failureReason: reason, failureStage: task.status === 'cancel-pending' ? 'reservation' : 'focus', updatedAt: now } },
      { store: 'chains', kind: 'put', value: { ...chain, status: 'needs-round', updatedAt: now } });
  }
  const settlementId = `${task.id}:settlement`;
  putTask({ ...task, status: outcome, endedAt: now, accumulatedMs: duration, pendingDecisionId: null, pendingInterruptionId: null, updatedAt: now });
  changes.writes.push({ store: 'settlements', kind: 'add', value: { ...entity(settlementId), taskId: task.id, chainId: task.chainId, roundId: task.roundId, outcome, creditedMinutes: outcome === 'succeeded' ? credit.creditedMinutes : 0, effectiveMs: duration, resultNodes, ...(outcome === 'succeeded' ? { addedNodes: credit.nodes - round.nodes } : {}) } });
  changes.deletes.push({ store: 'occupancy', id: 'active' });
  changes.settlementId = settlementId;
  return changes;
}

function cleanupTask(state: ChainState, id: string): TaskChanges {
  const changes = emptyTaskChanges(); changes.aborted = true;
  changes.deletes.push({ store: 'tasks', id });
  for (const item of state.decisions.filter(item => item.taskId === id)) changes.deletes.push({ store: 'decisions', id: item.id });
  for (const item of state.interruptions.filter(item => item.taskId === id)) changes.deletes.push({ store: 'interruptions', id: item.id });
  for (const item of state.occupancy.filter(item => item.taskId === id)) changes.deletes.push({ store: 'occupancy', id: item.id });
  return changes;
}
export function planTaskRecovery(state: ChainState, now: number): TaskChanges {
  const changes = emptyTaskChanges();
  const tasks = state.tasks.filter(task => unfinished(task) && !ended(state, task.id));
  const valid = tasks.filter(task => taskIsRecoverable(state, task));
  for (const task of tasks) {
    if (valid.length !== 1 || !valid.includes(task)) {
      const cleanup = cleanupTask(state, task.id); changes.deletes.push(...cleanup.deletes); continue;
    }
    let restored = task;
    if (restored.status === 'reserved' && now >= restored.dueAt) restored = { ...restored, status: 'focusing', accumulatedMs: 0, runningSince: restored.dueAt, focusStartedAt: restored.dueAt, dueNotified: true, updatedAt: now };
    if (restored.status !== 'reserved' && restored.status !== 'cancel-pending' && effectiveMs(restored, { now: () => now }) >= restored.plannedMinutes * 60_000) restored = { ...restored, goalNotified: true };
    if (restored !== task) changes.writes.push({ store: 'tasks', kind: 'put', value: restored });
    changes.writes.push({ store: 'occupancy', kind: 'put', value: { id: 'active', taskId: task.id } });
    changes.taskId = task.id;
  }
  if (!changes.taskId && state.occupancy.length) changes.deletes.push({ store: 'occupancy', id: 'active' });
  if (changes.taskId) changes.deletes = changes.deletes.filter(item => item.store !== 'occupancy');
  return changes;
}
