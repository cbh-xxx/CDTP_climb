import { describe, expect, it } from 'vitest';
import type { ChainState } from './models';
import { archivedChains, chainDetail, inheritanceCandidates, managementError, nameError, recentChains, sortChains, totalNodes } from './chains';
import { fixtureWrites, fixtureIds } from '../testing/fixtures';

export function emptyChainState(): ChainState {
  return { chains: [], rounds: [], tasks: [], decisions: [], precedents: [], roundPrecedents: [], settlements: [], settings: [], climbRecords: [], occupancy: [], metadata: [], interruptions: [], taskContents: [] };
}
export function populatedState(): ChainState {
  const state = emptyChainState();
  for (const write of fixtureWrites('owner', 1_800_000_000_000)) {
    // Fixture table/value correlation is guaranteed by the Write discriminant.
    (state[write.store] as { id: string }[]).push(write.value);
  }
  return state;
}
describe('链条查询与校验', () => {
  it('当前总节点包含归档、排除失败和删除链，超过600不截断', () => {
    expect(totalNodes(emptyChainState())).toBe(0);
    const state = populatedState();
    const chain = state.chains[0]!;
    const round = state.rounds.find(item => item.id === chain.currentRoundId)!;
    state.chains = [{ ...chain, status: 'available' }];
    state.rounds = [{ ...round, status: 'active', nodes: 601, successfulMinutes: 18_030, remainderMinutes: 0 }];
    expect(totalNodes(state)).toBe(601);
    state.chains[0] = { ...state.chains[0]!, status: 'archived' };
    expect(totalNodes(state)).toBe(601);
    state.rounds[0] = { ...state.rounds[0]!, status: 'failed' };
    expect(totalNodes(state)).toBe(0);
    state.rounds[0] = { ...state.rounds[0]!, status: 'active' };
    state.chains = [];
    expect(totalNodes(state)).toBe(0);
  });
  it('去首尾空格查全部现存名称，重命名排除自身', () => {
    const state = populatedState();
    expect(nameError('   ', state.chains)).toBe('请输入链名称');
    expect(nameError(' 已归档阅读 ', state.chains)).toBe('链名称已存在');
    expect(nameError('失败待新轮', state.chains)).toBe('链名称已存在');
    expect(nameError('历史阅读', state.chains, fixtureIds.history)).toBe('');
    expect(nameError('😀'.repeat(16), state.chains)).toBe('链名称最多15个字符');
    expect(nameError('👨‍👩‍👧‍👦'.repeat(15), state.chains)).toBe('');
  });
  it('已使用优先、未使用倒序补足，首页最多三条且排除归档和失败', () => {
    const state = populatedState(); const recent = recentChains(state);
    expect(recent).toHaveLength(3); expect(recent[0]?.id).toBe(fixtureIds.history);
    expect(recent.every(chain => chain.status === 'available')).toBe(true);
    const a = { ...state.chains[0]!, id: 'a', lastStartedAt: null, createdAt: 10 };
    const b = { ...a, id: 'b' };
    expect(sortChains([b, a]).map(chain => chain.id)).toEqual(['a', 'b']);
    expect(archivedChains(state)[0]?.id).toBe(fixtureIds.archived);
  });
  it('历史判例按文字去重，代表采用最早记录且保持原始历史', () => {
    const state = populatedState();
    const before = state.precedents.length;
    const candidates = inheritanceCandidates(state, fixtureIds.failed);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.situation).toBe('紧急事务需要立即处理');
    expect(candidates[1]?.situation).toBe('接听必须及时回应的电话');
    expect(state.precedents).toHaveLength(before);
    expect(chainDetail(state, fixtureIds.failed).summaries).toHaveLength(1);
  });
  it('任务占用只限制本链管理，失败链不能归档', () => {
    const state = populatedState();
    for (const write of fixtureWrites('owner', 1_800_000_000_000, true)) {
      const table = state[write.store] as { id: string }[];
      const index = table.findIndex(item => item.id === write.value.id);
      if (index >= 0) table.splice(index, 1); table.push(write.value);
    }
    const occupied = state.chains.find(chain => chain.id === fixtureIds.occupied)!;
    for (const action of ['rename', 'archive', 'delete'] as const) expect(managementError(state, occupied, action)).toBe('请先处理当前任务');
    expect(managementError(state, state.chains.find(chain => chain.id === fixtureIds.history)!, 'delete')).toBe('');
    expect(managementError(state, state.chains.find(chain => chain.id === fixtureIds.failed)!, 'archive')).toBe('请先设置新一轮');
  });
  it('记录只列本轮成功与允许取消，有效判例独立于任务记录', () => {
    const state = populatedState();
    const detail = chainDetail(state, fixtureIds.history);
    expect(detail.records.every(task => task.roundId === fixtureIds.historyRound && ['succeeded', 'cancelled'].includes(task.status))).toBe(true);
    expect(detail.precedents).toHaveLength(1);
    expect(() => chainDetail(state, 'missing')).toThrow();
  });
});

