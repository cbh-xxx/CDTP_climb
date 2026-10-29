import type { Clock } from '../domain/time';
import type { ChainState, Settings, StoreRecords } from '../domain/models';
import { planChainCommand, type ChainCommand } from '../domain/chain-commands';
import { planTaskCommand, planTaskRecovery, type TaskChanges, type TaskCommand, type TaskOutcome } from '../domain/task-commands';
import type { Repository, StoreName, Write } from './repository';

export const DB_VERSION = 4;
export const databaseName = (testing: boolean) => testing ? 'climb-testing' : 'climb-local';
const businessStores: StoreName[] = ['chains', 'rounds', 'tasks', 'decisions', 'precedents', 'roundPrecedents', 'settlements', 'climbRecords', 'occupancy'];
const allStores: StoreName[] = [...businessStores, 'metadata', 'settings', 'interruptions', 'taskContents'];
async function readState(tx: IDBTransaction): Promise<ChainState> {
  const entries = await Promise.all(allStores.map(async store => [store, await requestResult(tx.objectStore(store).getAll())]));
  // All entries originate from the schema's typed store list.
  return Object.fromEntries(entries) as ChainState;
}
export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('本地写入已回滚'));
    tx.onerror = () => { /* onabort reports the atomic transaction failure */ };
  });
}
export function openDatabase(name: string, factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DB_VERSION);
    let abandoned = false;
    request.onupgradeneeded = (event) => {
      const db = request.result;
      // Each migration runs in the browser's single versionchange transaction.
      if (event.oldVersion < 1) {
        db.createObjectStore('settings', { keyPath: 'id' });
        db.createObjectStore('metadata', { keyPath: 'id' });
      }
      if (event.oldVersion < 2) {
        for (const store of businessStores) db.createObjectStore(store, { keyPath: 'id' });
        request.transaction!.objectStore('settlements').createIndex('taskId', 'taskId', { unique: true });
      }
      if (event.oldVersion < 3) {
        const tx = request.transaction!;
        db.createObjectStore('interruptions', { keyPath: 'id' });
        db.createObjectStore('taskContents', { keyPath: 'id' });
        for (const store of ['rounds', 'tasks', 'precedents', 'settlements', 'interruptions', 'taskContents']) tx.objectStore(store).createIndex('chainId', 'chainId');
        for (const store of ['tasks', 'roundPrecedents']) tx.objectStore(store).createIndex('roundId', 'roundId');
        for (const store of ['decisions', 'interruptions']) tx.objectStore(store).createIndex('taskId', 'taskId');
        const chains = tx.objectStore('chains').openCursor();
        chains.onsuccess = () => {
          const cursor = chains.result;
          if (!cursor) return;
          const chain = cursor.value;
          cursor.update({ ...chain, archivedAt: chain.archivedAt ?? (chain.status === 'archived' ? chain.updatedAt : null) });
          cursor.continue();
        };
        const rounds = tx.objectStore('rounds').openCursor();
        rounds.onsuccess = () => {
          const cursor = rounds.result;
          if (!cursor) return;
          cursor.update({ failedAt: null, nodesBeforeFailure: null, failureReason: null, failureStage: null, ...cursor.value });
          cursor.continue();
        };
      }
      if (event.oldVersion < 4) {
        const tasks = request.transaction!.objectStore('tasks').openCursor();
        tasks.onsuccess = () => {
          const cursor = tasks.result;
          if (!cursor) return;
          cursor.update({ dueNotified: false, goalNotified: false, pendingDecisionId: null, pendingInterruptionId: null, pauseStartedAt: null, focusStartedAt: null, ...cursor.value });
          cursor.continue();
        };
      }
    };
    request.onblocked = () => {
      abandoned = true;
      reject(new Error('存储升级被其他网页阻塞，请关闭其他 Climb 页面后重试'));
    };
    request.onerror = () => reject(new Error(request.error?.name === 'VersionError'
      ? '本地数据来自较新版本，请使用新版网页打开；数据未被删除'
      : '无法打开或升级本地存储，请重试；数据未被删除'));
    request.onsuccess = () => {
      if (abandoned) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
function validateSettings(value: Settings | undefined): Settings {
  if (!value || value.id !== 'preferences' || typeof value.soundEnabled !== 'boolean'
    || typeof value.ownerId !== 'string' || !Number.isFinite(value.updatedAt)) {
    throw new Error('声音设置数据无法读取，请使用兼容版本检查本地数据；数据未被删除');
  }
  return value;
}
export class IndexedDbRepository implements Repository {
  private db: IDBDatabase | undefined;
  constructor(private name: string, private clock: Clock, private factory?: IDBFactory) {}
  private connection(): IDBDatabase {
    if (!this.db) throw new Error('本地存储尚未就绪，请重试');
    return this.db;
  }
  async initialize() {
    this.db = await openDatabase(this.name, this.factory);
    const tx = this.db.transaction(['metadata', 'settings'], 'readwrite');
    const done = transactionDone(tx);
    const metaRequest = tx.objectStore('metadata').get('local-owner');
    const settingsRequest = tx.objectStore('settings').get('preferences');
    metaRequest.onsuccess = () => {
      const ownerId = metaRequest.result?.ownerId ?? crypto.randomUUID();
      if (!metaRequest.result) tx.objectStore('metadata').add({ id: 'local-owner', ownerId });
      settingsRequest.onsuccess = () => {
        if (!settingsRequest.result) {
          const now = this.clock.now();
          const settings: Settings = { id: 'preferences', ownerId, accountId: null,
            createdAt: now, updatedAt: now, soundEnabled: true };
          tx.objectStore('settings').add(settings);
        }
      };
    };
    await done;
  }
  async get<K extends StoreName>(store: K, id: string): Promise<StoreRecords[K] | undefined> {
    const tx = this.connection().transaction(store, 'readonly');
    return requestResult(tx.objectStore(store).get(id));
  }
  async readHome() {
    const tx = this.connection().transaction(['settings', 'chains'], 'readonly');
    const [settings, chainCount] = await Promise.all([
      requestResult<Settings | undefined>(tx.objectStore('settings').get('preferences')),
      requestResult(tx.objectStore('chains').count()),
    ]);
    return { settings: validateSettings(settings), chainCount };
  }
  async setSound(enabled: boolean) {
    if (typeof enabled !== 'boolean') throw new Error('声音选项无效');
    const settings = validateSettings(await this.get('settings', 'preferences'));
    const updated = { ...settings, soundEnabled: enabled, updatedAt: this.clock.now() };
    await this.writeAtomically([{ store: 'settings', value: updated, kind: 'put' }]);
    return updated;
  }
  async writeAtomically(writes: Write[]) {
    if (!writes.length) return;
    const tx = this.connection().transaction([...new Set(writes.map(write => write.store))], 'readwrite');
    const done = transactionDone(tx);
    try {
      for (const write of writes) tx.objectStore(write.store)[write.kind](write.value);
    } catch (error) {
      tx.abort();
      await done.catch(() => undefined);
      throw error;
    }
    await done;
  }
  async readChainState() {
    const tx = this.connection().transaction(allStores, 'readonly');
    return readState(tx);
  }
  async executeChainCommand(command: ChainCommand) {
    const tx = this.connection().transaction(allStores, 'readwrite');
    const done = transactionDone(tx);
    // Observe rejection immediately while reads and domain validation run.
    void done.catch(() => undefined);
    try {
      const state = await readState(tx);
      const changes = planChainCommand(state, command, this.clock.now());
      for (const write of changes.writes) tx.objectStore(write.store)[write.kind](write.value);
      for (const deletion of changes.deletes) tx.objectStore(deletion.store).delete(deletion.id);
      await done;
      return changes.chainId;
    } catch (error) {
      try { tx.abort(); } catch { /* A failed transaction may already be inactive. */ }
      await done.catch(() => undefined);
      throw error;
    }
  }
  private async mutateTask(plan: (state: ChainState, now: number) => TaskChanges): Promise<TaskOutcome> {
    const tx = this.connection().transaction(allStores, 'readwrite');
    const done = transactionDone(tx);
    void done.catch(() => undefined);
    try {
      const state = await readState(tx);
      const changes = plan(state, this.clock.now());
      for (const write of changes.writes) tx.objectStore(write.store)[write.kind](write.value);
      for (const deletion of changes.deletes) tx.objectStore(deletion.store).delete(deletion.id);
      await done;
      return { taskId: changes.taskId, settlementId: changes.settlementId, events: changes.events, aborted: changes.aborted };
    } catch (error) {
      try { tx.abort(); } catch { /* Transaction may already have rolled back. */ }
      await done.catch(() => undefined); throw error;
    }
  }
  executeTaskCommand(command: TaskCommand) {
    // Capture the action time before storage reads so a minute boundary cannot
    // charge extra time merely because the transaction took longer to load.
    const issuedAt = this.clock.now();
    return this.mutateTask(state => planTaskCommand(state, command, issuedAt));
  }
  recoverTasks() { return this.mutateTask(planTaskRecovery); }
  close() { this.db?.close(); this.db = undefined; }
}
