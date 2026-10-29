import { describe, expect, it } from 'vitest';
import { levelSteps, routePeaks, climbOverview } from './route';
import { emptyChainState } from './chains.test';
describe('攀登路线', () => {
  it('完整逆序资料、正式阈值与全文', () => {
    expect(routePeaks).toHaveLength(30);
    expect(routePeaks[0]).toMatchObject({ level: 1, threshold: 20, shortName: '米斯林山脉最高峰' });
    expect(routePeaks[29]?.threshold).toBe(600);
    expect(routePeaks[29]?.name).toContain('雷亚西尔维亚');
    expect(routePeaks.every(item => item.location && item.height && item.facts.length > 0)).toBe(true);
  });
  it('升级回退均逐峰；等级相同没有过渡', () => {
    expect(levelSteps(0, 3)).toEqual([1, 2, 3]);
    expect(levelSteps(3, 0)).toEqual([2, 1, 0]);
    expect(levelSteps(30, 30)).toEqual([]);
  });
  it('空数据无纪录；历史纪录独立于当前节点', () => {
    const state = emptyChainState();
    expect(climbOverview(state)).toEqual({ nodes: 0, level: 0, highestLevel: 0, highestNodes: 0 });
    state.climbRecords.push({ id: 'record', ownerId: 'owner', accountId: null, createdAt: 0, updatedAt: 0, highestLevel: 30, highestTotalNodes: 905 });
    expect(climbOverview(state)).toEqual({ nodes: 0, level: 0, highestLevel: 30, highestNodes: 905 });
  });
});
