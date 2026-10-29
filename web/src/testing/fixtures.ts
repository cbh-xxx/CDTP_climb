import type { Entity } from '../domain/models';
import type { Write } from '../data/repository';

const id = (number: number) => `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
export const fixtureIds = { history: id(1), failed: id(2), archived: id(3), occupied: id(4), historyRound: id(101), failedRound: id(102) };

// Imported only from the dedicated test-tools chunk. Never seed on normal startup.
export function fixtureWrites(ownerId: string, now: number, occupancy = false): Write[] {
  const entity = (number: number, time = now): Entity => ({ id: id(number), ownerId, accountId: null, createdAt: time, updatedAt: time });
  if (occupancy) return [
    { store: 'chains', kind: 'put', value: { ...entity(4), name: '占用场景专用链', status: 'available', currentRoundId: id(104), lastStartedAt: now } },
    { store: 'rounds', kind: 'put', value: { ...entity(104), chainId: id(4), number: 1, action: '戴上耳机', status: 'active', successfulMinutes: 0, nodes: 0, remainderMinutes: 0 } },
    { store: 'tasks', kind: 'put', value: { ...entity(204), chainId: id(4), roundId: id(104), content: '隔离占用夹具', plannedMinutes: 25, status: 'paused', accumulatedMs: 60_000 } },
    { store: 'occupancy', kind: 'put', value: { id: 'active', taskId: id(204) } },
  ];
  const writes: Write[] = [];
  for (let n = 1; n <= 20; n++) {
    const archived = n === 3 || n >= 17;
    writes.push({ store: 'chains', kind: 'put', value: { ...entity(n, now - n * 1000), name: n === 1 ? '历史阅读' : n === 2 ? '失败待新轮' : n === 3 ? '已归档阅读' : `用于长列表滚动的链条${n}`,
      status: n === 2 ? 'needs-round' : archived ? 'archived' : 'available', currentRoundId: id(100 + n), lastStartedAt: n === 1 ? now : null, archivedAt: archived ? now - n : null } });
    writes.push({ store: 'rounds', kind: 'put', value: { ...entity(100 + n), chainId: id(n), number: n === 1 ? 2 : 1, action: n === 2 ? '整理桌面' : '坐到书桌前',
      status: n === 2 ? 'failed' : 'active', nodes: n === 1 ? 12 : n === 3 ? 1 : 0, successfulMinutes: n === 1 ? 368 : n === 3 ? 30 : 0, remainderMinutes: n === 1 ? 8 : 0,
      failedAt: n === 2 ? now - 100_000 : null, nodesBeforeFailure: n === 2 ? 18 : null, failureReason: n === 2 ? '测试失败摘要：保留完整原因文本，长内容按页面规则换行。' : null, failureStage: n === 2 ? 'focus' : null } });
  }
  writes.push({ store: 'rounds', kind: 'put', value: { ...entity(150), chainId: id(1), number: 1, action: '戴上耳机', status: 'failed', nodes: 0, remainderMinutes: 0, successfulMinutes: 0,
    failedAt: now - 86400_000, nodesBeforeFailure: 9, failureReason: null, failureStage: 'reservation' } });
  for (const [number, chain, text, time] of [[301, 2, '接听必须及时回应的电话', now - 500_000], [302, 2, ' 接听必须及时回应的电话 ', now - 400_000], [303, 2, '紧急事务需要立即处理', now - 300_000], [304, 1, '接听必须及时回应的电话', now - 200_000]] as const) {
    writes.push({ store: 'precedents', kind: 'put', value: { ...entity(number, time), chainId: id(chain), situation: text } },
      { store: 'roundPrecedents', kind: 'put', value: { ...entity(number + 100), roundId: id(chain === 2 ? 102 : 101), precedentId: id(number) } });
  }
  for (const [number, status, content] of [[201, 'succeeded', '阅读论文摘要'], [202, 'cancelled', '整理读书笔记']] as const) {
    writes.push({ store: 'tasks', kind: 'put', value: { ...entity(number), chainId: id(1), roundId: id(101), content, plannedMinutes: 25, status, endedAt: now - (number - 200) * 86400_000, accumulatedMs: status === 'succeeded' ? 1_799_000 : 0 } },
      { store: 'settlements', kind: 'put', value: { ...entity(number + 300), chainId: id(1), roundId: id(101), taskId: id(number), outcome: status, creditedMinutes: status === 'succeeded' ? 29 : 0 } });
  }
  writes.push({ store: 'decisions', kind: 'put', value: { ...entity(601), taskId: id(202), kind: 'reservation-cancel', outcome: 'allowed', precedentId: id(304), reason: null } },
    { store: 'interruptions', kind: 'put', value: { ...entity(701), chainId: id(1), taskId: id(201), precedentId: id(304), startedAt: now - 86500_000, resumedAt: now - 86470_000 } },
    { store: 'taskContents', kind: 'put', value: { ...entity(801), chainId: id(1), content: '阅读论文摘要', lastUsedAt: now - 86400_000 } },
    { store: 'climbRecords', kind: 'put', value: { ...entity(901), highestLevel: 2, highestTotalNodes: 40 } });
  writes.push({ store: 'tasks', kind: 'put', value: { ...entity(203), chainId: id(1), roundId: id(101), content: '其余阅读投入', plannedMinutes: 300, status: 'succeeded', endedAt: now - 3 * 86400_000, accumulatedMs: 339 * 60_000 } },
    { store: 'settlements', kind: 'put', value: { ...entity(503), chainId: id(1), roundId: id(101), taskId: id(203), outcome: 'succeeded', creditedMinutes: 339 } });
  return writes;
}
