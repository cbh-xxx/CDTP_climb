import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbRepository, requestResult } from './indexed-db';
import { TestClock } from '../testing/clock';
import { activeTask, chainDetail } from '../domain/chains';
import { effectiveMs } from '../domain/time';
import { preparationError, taskContentCandidates, taskProgress } from '../domain/task-rules';
import type { Task } from '../domain/models';
import type { TaskCommand } from '../domain/task-commands';

let repository: IndexedDbRepository;
let factory: IDBFactory;
let clock: TestClock;
beforeEach(async () => {
  factory = new IDBFactory(); clock = new TestClock(1_800_000_000_000);
  repository = new IndexedDbRepository('tasks', clock, factory); await repository.initialize();
  await repository.executeChainCommand({ type: 'create', chainId: 'chain', roundId: 'round', name: '阅读', action: '戴上耳机' });
});
afterEach(() => repository.close());
const command = (type: 'finish' | 'resume' | 'tick' | 'early-start'): TaskCommand => ({ type, taskId: 'task' });
async function start(reservationMinutes: number | null = null, content = '阅读论文') {
  return repository.executeTaskCommand({ type: 'start', taskId: 'task', chainId: 'chain', expectedRoundId: 'round', content, plannedMinutes: 5, reservationMinutes });
}
async function current(): Promise<Task> { return (await repository.get('tasks', 'task'))!; }
async function reopen() {
  repository.close(); repository = new IndexedDbRepository('tasks', clock, factory);
  await repository.initialize(); return repository.recoverTasks();
}
async function interrupt(decisionId = 'decision', interruptionId = 'pause') {
  return repository.executeTaskCommand({ type: 'interrupt', taskId: 'task', decisionId, interruptionId });
}
async function allowNew(decisionId = 'decision', precedentId = 'precedent', situation = '接听紧急电话') {
  return repository.executeTaskCommand({ type: 'decide', taskId: 'task', decisionId, input: { outcome: 'allowed', source: 'new', precedentId, situation } });
}
describe('准备与唯一任务', () => {
  it('5分钟档位、初始未选、预约候选及最大时长', () => {
    expect(preparationError('阅读', null, null, false)).toContain('请选择');
    expect(preparationError('阅读', 0, null, false)).toContain('5分钟');
    expect(preparationError('阅读', 5, null, false)).toBe('');
    expect(preparationError('阅读', 1435, 60, true)).toBe('');
    expect(preparationError('阅读', 1436, null, false)).not.toBe('');
    expect(preparationError('阅读', 5, 0, true)).toBe('请选择预约时长');
    expect(preparationError('阅读', 5, 20, true)).toBe('请选择预约时长');
  });
  it('启动同时建立占用、最近使用与去重复用；重复提交不重复创建', async () => {
    await start(null, ' 阅读论文 '); await start(null, '阅读论文');
    const state = await repository.readChainState();
    expect(state.tasks).toHaveLength(1); expect(state.occupancy).toHaveLength(1);
    expect(state.chains[0]?.lastStartedAt).toBe(clock.now());
    expect(taskContentCandidates(state, 'chain')).toHaveLength(1);
    await expect(repository.executeTaskCommand({ type: 'start', taskId: 'other', chainId: 'chain', expectedRoundId: 'round', content: '另一任务', plannedMinutes: 5, reservationMinutes: null })).rejects.toThrow('当前任务');
  });
});
describe('预约冻结、顺延与两类关闭', () => {
  it('取消时剩3分钟，停留2分钟主动关闭仍剩3分钟，重复关闭不再顺延', async () => {
    await start(5); clock.advance(120_000);
    await repository.executeTaskCommand({ type: 'cancel-request', taskId: 'task', decisionId: 'cancel' });
    const frozen = await current(); expect(frozen).toMatchObject({ status: 'cancel-pending', remainingMs: 180_000 });
    clock.advance(120_000); expect(taskProgress(await current(), clock).milliseconds).toBe(180_000);
    await repository.executeTaskCommand({ type: 'close-decision', taskId: 'task', decisionId: 'cancel' });
    const due = clock.now() + 180_000; expect(await current()).toMatchObject({ status: 'reserved', dueAt: due });
    clock.advance(1000); await repository.executeTaskCommand({ type: 'close-decision', taskId: 'task', decisionId: 'cancel' });
    expect(await current()).toMatchObject({ dueAt: due });
  });
  it('取消判定重开保持冻结，跨原到期点也不开始；主动关闭才恢复', async () => {
    await start(5); clock.advance(120_000);
    await repository.executeTaskCommand({ type: 'cancel-request', taskId: 'task', decisionId: 'cancel' });
    clock.advance(3_600_000); const result = await reopen(); expect(result.events).toEqual([]);
    expect(await current()).toMatchObject({ status: 'cancel-pending', remainingMs: 180_000, pendingDecisionId: 'cancel' });
    await repository.executeTaskCommand({ type: 'close-decision', taskId: 'task', decisionId: 'cancel' });
    clock.advance(240_000); await repository.executeTaskCommand(command('tick'));
    expect(effectiveMs(await current(), clock)).toBe(60_000);
  });
  it('关闭期间预约到期，以原到期点补算，不补旧提醒、不自动结算', async () => {
    const begin = clock.now(); await start(5); clock.advance(900_000);
    const result = await reopen(); expect(result.events).toEqual([]);
    expect(await current()).toMatchObject({ status: 'focusing', runningSince: begin + 300_000, goalNotified: true });
    expect(effectiveMs(await current(), clock)).toBe(600_000);
    expect((await repository.executeTaskCommand(command('tick'))).events).toEqual([]);
    expect((await repository.readChainState()).settlements).toHaveLength(0);
  });
  it('提前开始以确认时刻计时；正常到期只产生一次提醒', async () => {
    await start(5); clock.advance(120_000); await repository.executeTaskCommand(command('early-start'));
    expect(effectiveMs(await current(), clock)).toBe(0);
    clock.advance(300_000); const first = await repository.executeTaskCommand(command('tick'));
    expect(first.events.map(event => event.kind)).toEqual(['goal-reached']);
    expect((await repository.executeTaskCommand(command('tick'))).events).toEqual([]);
  });
  it('允许取消保留原累计、判例和复用，唯一结束；违规则旧轮归零', async () => {
    await start(5); await repository.executeTaskCommand({ type: 'cancel-request', taskId: 'task', decisionId: 'cancel' });
    await allowNew('cancel'); await allowNew('cancel');
    const state = await repository.readChainState();
    expect(state.settlements).toHaveLength(1); expect(state.settlements[0]?.outcome).toBe('cancelled');
    expect(state.occupancy).toHaveLength(0); expect(state.precedents).toHaveLength(1);
    expect(state.taskContents).toHaveLength(1); expect(state.rounds[0]?.status).toBe('active');
  });
});
describe('正式中断、恢复与结算', () => {
  it('正式判定主动关闭与重开均冻结，不能直接继续或完成', async () => {
    await start(); clock.advance(90_000); await interrupt(); clock.advance(3_600_000);
    await repository.executeTaskCommand({ type: 'close-decision', taskId: 'task', decisionId: 'decision' });
    await reopen(); expect(await current()).toMatchObject({ status: 'interrupt-pending', accumulatedMs: 90_000 });
    await expect(repository.executeTaskCommand(command('resume'))).rejects.toThrow('判定');
    await expect(repository.executeTaskCommand(command('finish'))).rejects.toThrow('有效时长');
  });
  it('达标暂停不能完成，判允许后仍须继续；暂停时长包含判定等待', async () => {
    await start(); clock.advance(300_000); await interrupt(); clock.advance(59_000);
    await allowNew(); await expect(repository.executeTaskCommand(command('finish'))).rejects.toThrow();
    await allowNew(); // repeated formal decision must not duplicate precedent or pause
    clock.advance(61_000); await reopen();
    expect(effectiveMs(await current(), clock)).toBe(300_000);
    await repository.executeTaskCommand(command('resume'));
    const state = await repository.readChainState();
    expect(state.interruptions).toHaveLength(1); expect(state.precedents).toHaveLength(1);
    expect(state.interruptions[0]!.resumedAt! - state.interruptions[0]!.startedAt).toBe(120_000);
    await repository.executeTaskCommand(command('finish')); expect((await repository.readChainState()).settlements[0]?.creditedMinutes).toBe(5);
  });
  it('29分59秒计入29分钟、与本链余量累加，重复完成只结算一次', async () => {
    const round = (await repository.get('rounds', 'round'))!;
    await repository.writeAtomically([{ store: 'rounds', kind: 'put', value: { ...round, nodes: 12, remainderMinutes: 8, successfulMinutes: 368 } }]);
    await start(); clock.advance(1_799_000);
    const results = await Promise.all([repository.executeTaskCommand(command('finish')), repository.executeTaskCommand(command('finish'))]);
    expect(results[0]?.settlementId).toBe(results[1]?.settlementId);
    const state = await repository.readChainState();
    expect(state.settlements).toHaveLength(1); expect(state.settlements[0]).toMatchObject({ creditedMinutes: 29, effectiveMs: 1_799_000, resultNodes: 13, addedNodes: 1 });
    expect(state.rounds[0]).toMatchObject({ successfulMinutes: 397, nodes: 13, remainderMinutes: 7 });
    expect(state.occupancy).toEqual([]); await reopen(); expect((await repository.readChainState()).rounds[0]?.successfulMinutes).toBe(397);
  });
  it.each([
    { previousMinutes: 25, elapsedMinutes: 10, addedNodes: 1, resultNodes: 1 },
    { previousMinutes: 0, elapsedMinutes: 29, addedNodes: 0, resultNodes: 0 },
  ])('新增节点含原余量并持久保存：$previousMinutes＋$elapsedMinutes分钟', async ({ previousMinutes, elapsedMinutes, addedNodes, resultNodes }) => {
    const round = (await repository.get('rounds', 'round'))!;
    await repository.writeAtomically([{ store: 'rounds', kind: 'put', value: { ...round, successfulMinutes: previousMinutes, nodes: Math.floor(previousMinutes / 30), remainderMinutes: previousMinutes % 30 } }]);
    await start(); clock.advance(elapsedMinutes * 60_000);
    const first = await repository.executeTaskCommand(command('finish'));
    await reopen();
    const snapshot = await repository.get('settlements', first.settlementId!);
    expect(snapshot).toMatchObject({ creditedMinutes: elapsedMinutes, addedNodes, resultNodes });
    // A later repeat must return the original snapshot without adding credit.
    await repository.executeTaskCommand(command('finish'));
    const state = await repository.readChainState();
    expect(state.settlements).toEqual([snapshot]);
    expect(state.rounds[0]?.successfulMinutes).toBe(previousMinutes + elapsedMinutes);
  });
  it('已有判例可复用，新增同文判例禁止且不修改既有历史', async () => {
    await start(); clock.advance(1000); await interrupt(); await allowNew(); await repository.executeTaskCommand(command('resume'));
    await interrupt('decision-2', 'pause-2');
    await expect(allowNew('decision-2', 'new-id', ' 接听紧急电话 ')).rejects.toThrow('情境已存在');
    expect((await current()).status).toBe('interrupt-pending');
    await repository.executeTaskCommand({ type: 'decide', taskId: 'task', decisionId: 'decision-2', input: { outcome: 'allowed', source: 'existing', precedentId: 'precedent' } });
    const state = await repository.readChainState(); expect(state.precedents).toHaveLength(1); expect(state.interruptions).toHaveLength(2);
  });
  it('失败保存失效前节点、环节与原因，保留历史最高和原任务', async () => {
    const round = (await repository.get('rounds', 'round'))!;
    await repository.writeAtomically([{ store: 'rounds', kind: 'put', value: { ...round, nodes: 2, successfulMinutes: 61, remainderMinutes: 1 } }]);
    await repository.writeAtomically([{ store: 'climbRecords', kind: 'put', value: { id: 'climb-history', ownerId: round.ownerId, accountId: null, createdAt: clock.now(), updatedAt: clock.now(), highestLevel: 2, highestTotalNodes: 40 } }]);
    await start(); await interrupt();
    const decide: TaskCommand = { type: 'decide', taskId: 'task', decisionId: 'decision', input: { outcome: 'violation', reason: '走神了' } };
    await repository.executeTaskCommand(decide); await repository.executeTaskCommand(decide);
    const state = await repository.readChainState(); const detail = chainDetail(state, 'chain');
    expect(detail.chain.status).toBe('needs-round'); expect(detail.round).toMatchObject({ nodes: 0, remainderMinutes: 0, successfulMinutes: 0, nodesBeforeFailure: 2, failureStage: 'focus', failureReason: '走神了' });
    expect(state.tasks).toHaveLength(1); expect(state.settlements).toHaveLength(1); expect(state.occupancy).toHaveLength(0);
    expect(state.climbRecords[0]).toMatchObject({ highestLevel: 2, highestTotalNodes: 40 });
  });
  it('同链余量可跨成功任务累计，另一链余量不合并', async () => {
    await start(); clock.advance(1_740_000); await repository.executeTaskCommand(command('finish'));
    await repository.executeChainCommand({ type: 'create', chainId: 'chain-b', roundId: 'round-b', name: '写作', action: '坐到书桌前' });
    await repository.executeTaskCommand({ type: 'start', taskId: 'task-b', chainId: 'chain-b', expectedRoundId: 'round-b', content: '写作', plannedMinutes: 5, reservationMinutes: null });
    clock.advance(1_740_000); await repository.executeTaskCommand({ type: 'finish', taskId: 'task-b' });
    let state = await repository.readChainState(); expect(state.rounds.map(round => round.nodes)).toEqual([0, 0]);
    await repository.executeTaskCommand({ type: 'start', taskId: 'task-next', chainId: 'chain', expectedRoundId: 'round', content: '阅读论文', plannedMinutes: 5, reservationMinutes: null });
    clock.advance(300_000); await repository.executeTaskCommand({ type: 'finish', taskId: 'task-next' });
    state = await repository.readChainState();
    expect(state.rounds.find(round => round.id === 'round')).toMatchObject({ nodes: 1, remainderMinutes: 4, successfulMinutes: 34 });
    expect(state.rounds.find(round => round.id === 'round-b')).toMatchObject({ nodes: 0, remainderMinutes: 29 });
  });
  it('成功事务写入失败全部回滚，重试仅结算一次', async () => {
    await start(); clock.advance(300_000);
    const before = await repository.readChainState();
    const db = await requestResult(factory.open('tasks'));
    const prototype = Object.getPrototypeOf(db.transaction('settlements').objectStore('settlements'));
    const original = prototype.add;
    const failure = vi.spyOn(prototype, 'add').mockImplementation(function (this: IDBObjectStore, value: unknown) {
      if (this.name === 'settlements') throw new DOMException('isolated fault', 'QuotaExceededError');
      return original.call(this, value);
    });
    try { await expect(repository.executeTaskCommand(command('finish'))).rejects.toBeTruthy(); }
    finally { failure.mockRestore(); db.close(); }
    expect(await repository.readChainState()).toEqual(before);
    await repository.executeTaskCommand(command('finish')); expect((await repository.readChainState()).settlements).toHaveLength(1);
  });
});
describe('异常清理边界', () => {
  it('v3升级保留可靠运行时间戳，补算后不补旧提醒', async () => {
    repository.close();
    const request = factory.open('v3-tasks', 3);
    request.onupgradeneeded = () => {
      for (const store of ['chains','rounds','tasks','decisions','precedents','roundPrecedents','settlements','settings','climbRecords','occupancy','metadata','interruptions','taskContents']) request.result.createObjectStore(store, { keyPath: 'id' });
      request.transaction!.objectStore('metadata').put({ id: 'local-owner', ownerId: 'legacy-owner' });
      const entity = { ownerId: 'legacy-owner', accountId: null, createdAt: clock.now() - 600_000, updatedAt: clock.now() - 600_000 };
      request.transaction!.objectStore('chains').put({ ...entity, id: 'legacy-chain', name: '旧阅读', status: 'available', currentRoundId: 'legacy-round', lastStartedAt: entity.createdAt });
      request.transaction!.objectStore('rounds').put({ ...entity, id: 'legacy-round', chainId: 'legacy-chain', number: 1, action: '戴上耳机', status: 'active', nodes: 0, remainderMinutes: 0, successfulMinutes: 0 });
      request.transaction!.objectStore('tasks').put({ ...entity, id: 'legacy-task', chainId: 'legacy-chain', roundId: 'legacy-round', content: '阅读论文', plannedMinutes: 5, status: 'focusing', runningSince: entity.createdAt, accumulatedMs: 0 });
    };
    (await requestResult(request)).close();
    const migrated = new IndexedDbRepository('v3-tasks', clock, factory); await migrated.initialize();
    expect((await migrated.recoverTasks()).events).toEqual([]);
    expect(await migrated.get('tasks', 'legacy-task')).toMatchObject({ status: 'focusing', runningSince: clock.now() - 600_000, goalNotified: true });
    expect((await migrated.readChainState()).settlements).toHaveLength(0); migrated.close();
  });
  it('丢失任务释放孤立占用，不添加历史', async () => {
    await repository.writeAtomically([{ store: 'occupancy', kind: 'add', value: { id: 'active', taskId: 'missing' } }]);
    await reopen(); const state = await repository.readChainState();
    expect(state.occupancy).toEqual([]); expect(state.tasks).toEqual([]); expect(state.settlements).toEqual([]);
  });
  it('损坏的未结算任务不生成失败历史，保留本轮与已经生效判例、复用', async () => {
    await start(); await interrupt(); await allowNew();
    const task = await current(); await repository.writeAtomically([{ store: 'tasks', kind: 'put', value: { ...task, plannedMinutes: NaN } }]);
    await reopen(); const state = await repository.readChainState();
    expect(activeTask(state)).toBeUndefined(); expect(state.tasks).toEqual([]); expect(state.settlements).toEqual([]);
    expect(state.precedents).toHaveLength(1); expect(state.roundPrecedents).toHaveLength(1); expect(state.taskContents).toHaveLength(1); expect(state.rounds[0]?.status).toBe('active');
  });
  it('占用记录丢失但任务可靠时恢复占用；正常关页不是异常', async () => {
    await start(); clock.advance(120_000);
    const db = await requestResult(factory.open('tasks'));
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('occupancy', 'readwrite'); tx.objectStore('occupancy').delete('active'); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); db.close();
    await reopen(); expect((await repository.readChainState()).occupancy).toEqual([{ id: 'active', taskId: 'task' }]);
    expect(effectiveMs(await current(), clock)).toBe(120_000);
  });
});
