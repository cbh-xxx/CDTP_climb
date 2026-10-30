import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbRepository, requestResult } from './indexed-db';
import { systemClock } from '../domain/time';
import { chainDetail, inheritanceCandidates, totalNodes } from '../domain/chains';
import { fixtureIds, fixtureWrites } from '../testing/fixtures';

let repository: IndexedDbRepository;
let factory: IDBFactory;
beforeEach(async () => {
  factory = new IDBFactory(); repository = new IndexedDbRepository('chain-test', systemClock, factory);
  await repository.initialize();
});
const create = (name = '阅读', chainId = 'created', roundId = 'round-created') => repository.executeChainCommand({ type: 'create', name, action: '戴上耳机', chainId, roundId });
async function loadFixtures() {
  const owner = (await repository.get('metadata', 'local-owner'))!;
  await repository.writeAtomically(fixtureWrites(owner.ownerId, Date.now()));
}
describe('链条事务与持久化', () => {
  it('创建原子保存链和第一轮，默认累计为0；同一请求不重复创建', async () => {
    await create(); await create();
    const state = await repository.readChainState();
    expect(state.chains).toHaveLength(1); expect(state.rounds).toHaveLength(1);
    expect(chainDetail(state, 'created').round).toMatchObject({ nodes: 0, action: '戴上耳机' });
    expect(state.chains[0]?.lastStartedAt).toBeNull();
    expect(state.tasks).toHaveLength(0);
  });
  it('并发重复名称只允许一个提交', async () => {
    const results = await Promise.allSettled([create('阅读', 'a', 'ra'), create(' 阅读 ', 'b', 'rb')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await repository.readChainState()).rounds).toHaveLength(1);
  });
  it('无效创建不保存半条链；名称与动作均在业务层校验', async () => {
    await expect(repository.executeChainCommand({ type: 'create', chainId: 'bad', roundId: 'bad-round', name: '阅读', action: '' })).rejects.toThrow('现实动作');
    expect((await repository.readChainState()).chains).toHaveLength(0);
    expect((await repository.readChainState()).rounds).toHaveLength(0);
  });
  it('重命名原名可保存、不改变动作、使用排序和关联；同名拒绝', async () => {
    await create(); await create('写作', 'other', 'other-round');
    await repository.executeChainCommand({ type: 'rename', chainId: 'created', name: '阅读' });
    await expect(repository.executeChainCommand({ type: 'rename', chainId: 'created', name: ' 写作 ' })).rejects.toThrow('已存在');
    await repository.executeChainCommand({ type: 'rename', chainId: 'created', name: '新阅读' });
    const detail = chainDetail(await repository.readChainState(), 'created');
    expect(detail.chain.lastStartedAt).toBeNull(); expect(detail.round.action).toBe('戴上耳机');
  });
  it('归档与恢复保持轮次、累计和历史，重开仍保存', async () => {
    await loadFixtures(); const before = chainDetail(await repository.readChainState(), fixtureIds.history);
    await repository.executeChainCommand({ type: 'archive', chainId: fixtureIds.history });
    await expect(create('历史阅读', 'duplicate', 'duplicate-round')).rejects.toThrow('已存在');
    await repository.executeChainCommand({ type: 'restore', chainId: fixtureIds.history });
    repository.close(); repository = new IndexedDbRepository('chain-test', systemClock, factory); await repository.initialize();
    const after = chainDetail(await repository.readChainState(), fixtureIds.history);
    expect(after.chain.status).toBe('available'); expect(after.round).toEqual(before.round); expect(after.records).toEqual(before.records);
  });
  it('新轮默认不继承，重复保存不另开轮，旧轮历史保留', async () => {
    await loadFixtures();
    const command = { type: 'new-round' as const, chainId: fixtureIds.failed, expectedRoundId: fixtureIds.failedRound, roundId: 'new-round', action: '戴上耳机', inheritedIds: [] };
    await repository.executeChainCommand(command); await repository.executeChainCommand(command);
    const detail = chainDetail(await repository.readChainState(), fixtureIds.failed);
    expect(detail.round.number).toBe(2); expect(detail.round.nodes).toBe(0); expect(detail.records).toHaveLength(0); expect(detail.precedents).toHaveLength(0); expect(detail.summaries).toHaveLength(1);
  });
  it('仅选择的去重候选生效，创建时间不变，非法继承整笔拒绝', async () => {
    await loadFixtures(); const before = await repository.readChainState();
    const candidates = inheritanceCandidates(before, fixtureIds.failed);
    const command = { type: 'new-round' as const, chainId: fixtureIds.failed, expectedRoundId: fixtureIds.failedRound, roundId: 'new-round', action: '整理桌面', inheritedIds: ['invalid'] };
    await expect(repository.executeChainCommand(command)).rejects.toThrow('候选');
    expect((await repository.readChainState()).rounds).toEqual(before.rounds);
    await repository.executeChainCommand({ ...command, inheritedIds: [candidates[0]!.id, candidates[0]!.id] });
    const detail = chainDetail(await repository.readChainState(), fixtureIds.failed);
    expect(detail.precedents).toEqual([candidates[0]]);
    expect((await repository.readChainState()).precedents).toEqual(before.precedents);
  });
  it('删除整链关联数据，其他链与独立历史最高保留', async () => {
    await loadFixtures(); const before = await repository.readChainState(); const oldTotal = totalNodes(before);
    await repository.executeChainCommand({ type: 'delete', chainId: fixtureIds.history });
    const after = await repository.readChainState();
    expect(after.chains.some(chain => chain.id === fixtureIds.history)).toBe(false);
    for (const table of [after.rounds, after.tasks, after.precedents, after.settlements, after.interruptions, after.taskContents]) expect(table.some(item => item.chainId === fixtureIds.history)).toBe(false);
    const deletedTasks = new Set(before.tasks.filter(task => task.chainId === fixtureIds.history).map(task => task.id));
    expect(after.decisions.some(decision => deletedTasks.has(decision.taskId))).toBe(false);
    expect(after.roundPrecedents.some(link => link.roundId === fixtureIds.historyRound)).toBe(false);
    expect(after.climbRecords).toEqual(before.climbRecords);
    expect(totalNodes(after)).toBe(oldTotal - 12);
    expect(after.chains.find(chain => chain.id === fixtureIds.failed)).toEqual(before.chains.find(chain => chain.id === fixtureIds.failed));
  });
  it('任务占用链禁止管理，其他链仍可操作', async () => {
    await loadFixtures(); const owner = (await repository.get('metadata', 'local-owner'))!;
    await repository.writeAtomically(fixtureWrites(owner.ownerId, Date.now(), true));
    for (const type of ['delete', 'archive'] as const) await expect(repository.executeChainCommand({ type, chainId: fixtureIds.occupied })).rejects.toThrow('当前任务');
    await expect(repository.executeChainCommand({ type: 'rename', chainId: fixtureIds.occupied, name: '新名字' })).rejects.toThrow('当前任务');
    await repository.executeChainCommand({ type: 'archive', chainId: fixtureIds.history });
    await expect(repository.executeChainCommand({ type: 'archive', chainId: fixtureIds.failed })).rejects.toThrow('新一轮');
  });
  it('ID碰撞导致第二次写失败时第一条写入也回滚', async () => {
    await create('旧链', 'old', 'existing-round');
    await expect(create('新链', 'new', 'existing-round')).rejects.toBeTruthy();
    expect(await repository.get('chains', 'new')).toBeUndefined();
    expect((await repository.get('rounds', 'existing-round'))?.chainId).toBe('old');
  });
  it('删除过程中失败时已发出的清理操作全部回滚', async () => {
    await loadFixtures();
    const before = await repository.readChainState();
    // Obtain the fake implementation's object-store prototype without touching user data.
    const db = await requestResult(factory.open('chain-test'));
    const prototype = Object.getPrototypeOf(db.transaction('chains').objectStore('chains')) as IDBObjectStore;
    const original = prototype.delete;
    const deletion = vi.spyOn(prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      if (this.name === 'rounds') throw new DOMException('isolated write fault', 'QuotaExceededError');
      return original.call(this, key);
    });
    try { await expect(repository.executeChainCommand({ type: 'delete', chainId: fixtureIds.history })).rejects.toBeTruthy(); }
    finally { deletion.mockRestore(); db.close(); }
    expect(await repository.readChainState()).toEqual(before);
  });
  it('v2升级保留原实体，并补充时间/摘要结构和关联表', async () => {
    repository.close();
    const legacy = factory.open('legacy', 2);
    legacy.onupgradeneeded = () => {
      for (const name of ['chains','rounds','tasks','decisions','precedents','roundPrecedents','settlements','climbRecords','occupancy','metadata','settings']) legacy.result.createObjectStore(name, { keyPath: 'id' });
      legacy.transaction!.objectStore('settlements').createIndex('taskId', 'taskId', { unique: true });
      legacy.transaction!.objectStore('chains').put({ id: 'old', ownerId: 'owner', accountId: null, createdAt: 10, updatedAt: 20, name: '旧归档链', status: 'archived', currentRoundId: 'old-round', lastStartedAt: null });
      legacy.transaction!.objectStore('rounds').put({ id: 'old-round', chainId: 'old', status: 'active', number: 1, action: '坐到书桌前', nodes: 1, successfulMinutes: 30, remainderMinutes: 0 });
    };
    (await requestResult(legacy)).close();
    const migrated = new IndexedDbRepository('legacy', systemClock, factory); await migrated.initialize();
    const state = await migrated.readChainState();
    expect(state.chains[0]).toMatchObject({ id: 'old', archivedAt: 20 });
    expect(state.rounds[0]).toMatchObject({ id: 'old-round', nodes: 1, nodesBeforeFailure: null });
    expect(state.interruptions).toEqual([]); migrated.close();
  });
});
