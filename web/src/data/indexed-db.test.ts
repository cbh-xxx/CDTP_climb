import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { databaseName, IndexedDbRepository, openDatabase, requestResult } from './indexed-db';
import { TestClock } from '../testing/clock';
import type { Settlement, Settings } from '../domain/models';
let factory: IDBFactory;
const clock = new TestClock(1000);
beforeEach(() => { factory = new IDBFactory(); });
const repo = (name = 'test') => new IndexedDbRepository(name, clock, factory);
const settings: Settings = { id: 'preferences', ownerId: 'old-owner', accountId: null, createdAt: 10, updatedAt: 20, soundEnabled: false };
describe('本地存储边界', () => {
  it('首次启动无业务数据，声音默认开，重开保持设置', async () => {
    const first = repo(); await first.initialize();
    expect(await first.readHome()).toMatchObject({ chainCount: 0, settings: { soundEnabled: true } });
    expect(await first.get('tasks', 'task')).toBeUndefined();
    await first.setSound(false); first.close();
    const second = repo(); await second.initialize();
    expect((await second.readHome()).settings.soundEnabled).toBe(false);
    second.close();
  });
  it('v1升级保留设置、归属与时间', async () => {
    const request = factory.open('test', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('settings', { keyPath: 'id' }).add(settings);
      request.result.createObjectStore('metadata', { keyPath: 'id' }).add({ id: 'local-owner', ownerId: 'old-owner' });
    };
    (await requestResult(request)).close();
    const migrated = repo(); await migrated.initialize();
    expect((await migrated.readHome()).settings).toEqual(settings);
    expect(await migrated.get('metadata', 'local-owner')).toMatchObject({ ownerId: 'old-owner' });
    migrated.close();
  });
  it('拒绝新版本且不删除数据', async () => {
    const request = factory.open('test', 99);
    request.onupgradeneeded = () => request.result.createObjectStore('sentinel').put('preserve', 'key');
    (await requestResult(request)).close();
    await expect(openDatabase('test', factory)).rejects.toThrow('较新版本');
    const db = await requestResult(factory.open('test', 99));
    expect(await requestResult(db.transaction('sentinel').objectStore('sentinel').get('key'))).toBe('preserve');
    db.close();
  });
  it('唯一结算冲突使关联设置写入一同回滚', async () => {
    const repository = repo(); await repository.initialize();
    const settlement: Settlement = { ...settings, id: 's1', taskId: 't1', chainId: 'c1', roundId: 'r1', outcome: 'succeeded', creditedMinutes: 30 };
    await repository.writeAtomically([{ store: 'settlements', kind: 'add', value: settlement }]);
    await expect(repository.writeAtomically([
      { store: 'settings', kind: 'put', value: settings },
      { store: 'settlements', kind: 'add', value: { ...settlement, id: 's2' } },
    ])).rejects.toBeTruthy();
    expect((await repository.readHome()).settings.soundEnabled).toBe(true);
    expect(await repository.get('settlements', 's2')).toBeUndefined();
    repository.close();
  });
  it('占用主键阻止第二个未完成任务写入', async () => {
    const repository = repo(); await repository.initialize();
    await repository.writeAtomically([{ store: 'occupancy', kind: 'add', value: { id: 'active', taskId: 'first' } }]);
    await expect(repository.writeAtomically([{ store: 'occupancy', kind: 'add', value: { id: 'active', taskId: 'second' } }])).rejects.toBeTruthy();
    expect(await repository.get('occupancy', 'active')).toEqual({ id: 'active', taskId: 'first' }); repository.close();
  });
  it('迁移中途失败回滚版本及已创建表', async () => {
    const request = factory.open('test', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('settings', { keyPath: 'id' }).add(settings);
      request.result.createObjectStore('metadata', { keyPath: 'id' });
      request.result.createObjectStore('rounds', { keyPath: 'id' }); // incompatible legacy fixture
    };
    (await requestResult(request)).close();
    await expect(openDatabase('test', factory)).rejects.toThrow();
    const db = await requestResult(factory.open('test', 1));
    expect(db.objectStoreNames.contains('chains')).toBe(false);
    expect(await requestResult(db.transaction('settings').objectStore('settings').get('preferences'))).toEqual(settings);
    db.close();
  });
  it('普通与测试数据库不共享设置', async () => {
    const normal = repo(databaseName(false)); const testing = repo(databaseName(true));
    await normal.initialize(); await testing.initialize(); await testing.setSound(false);
    expect((await normal.readHome()).settings.soundEnabled).toBe(true);
    normal.close(); testing.close();
  });
});
