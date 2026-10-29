import { describe, expect, it } from 'vitest';
import { creditSuccess, peakThreshold, reachedLevel } from './climb';
import { effectiveMs, taskDisplayStatus } from './time';
import type { TaskBase, Task } from './models';
import { TestClock } from '../testing/clock';
const base: TaskBase = { id: 'task', ownerId: 'owner', accountId: null, createdAt: 0, updatedAt: 0,
  chainId: 'chain', roundId: 'round', content: '阅读', plannedMinutes: 5 };
describe('正式攀登与成功时长换算', () => {
  it.each([[19,0],[20,1],[39,1],[40,2],[599,29],[600,30],[601,30]])('%s节点为等级%s', (nodes, level) => expect(reachedLevel(nodes)).toBe(level));
  it('30峰逐级20节点', () => {
    expect(Array.from({ length: 30 }, (_, i) => peakThreshold(i + 1))).toEqual(Array.from({ length: 30 }, (_, i) => 20 * (i + 1)));
  });
  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('拒绝非法节点%s', value => expect(() => reachedLevel(value)).toThrow());
  it('舍秒，余量仅在调用者选中的本链本轮累计', () => {
    expect(creditSuccess(0, 1_799_000)).toMatchObject({ creditedMinutes: 29, nodes: 0, remainderMinutes: 29 });
    expect(creditSuccess(29, 60_000)).toMatchObject({ nodes: 1, remainderMinutes: 0 });
    const chainA = creditSuccess(0, 1_740_000);
    const chainB = creditSuccess(0, 1_740_000);
    expect(chainA.nodes + chainB.nodes).toBe(0);
    expect(creditSuccess(0, 60_000).nodes).toBe(0); // new round starts with its own zero
  });
});
describe('时间戳模型', () => {
  it('刷新后按起点补算，达标继续计时', () => {
    const task: Task = { ...base, status: 'focusing', accumulatedMs: 60_000, runningSince: 1000 };
    const clock = new TestClock(1000); clock.advance(360_000);
    expect(effectiveMs(JSON.parse(JSON.stringify(task)), clock)).toBe(420_000);
    expect(taskDisplayStatus(task, clock)).toBe('待结算');
    expect(task.status).toBe('focusing');
  });
  it.each(['paused', 'interrupt-pending'] as const)('%s关闭期间保持冻结', status => {
    const clock = new TestClock(1000); clock.advance(86_400_000);
    expect(effectiveMs({ ...base, status, accumulatedMs: 123_000 }, clock)).toBe(123_000);
  });
  it('取消待判定冻结，离线预约到期按原到期点补算', () => {
    const clock = new TestClock(600_000);
    expect(effectiveMs({ ...base, status: 'cancel-pending', remainingMs: 10_000 }, clock)).toBe(0);
    expect(effectiveMs({ ...base, status: 'reserved', dueAt: 300_000 }, clock)).toBe(300_000);
    expect(taskDisplayStatus({ ...base, status: 'reserved', dueAt: 300_000 }, clock)).toBe('待结算');
  });
});
