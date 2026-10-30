import type { ChainState, StoreRecords } from '../domain/models';
import { unfinished } from '../domain/chains';
export const syncedStores = ['chains','rounds','tasks','decisions','precedents','roundPrecedents','interruptions','settlements','taskContents','climbRecords','settings'] as const;
export type SyncStore = typeof syncedStores[number];
export type WireSnapshot = { [K in SyncStore]: Omit<StoreRecords[K], 'ownerId' | 'accountId'>[] };
export function encodeSnapshot(state: ChainState): WireSnapshot {
  return Object.fromEntries(syncedStores.map(store => [store, state[store].map(row => {
    const { ownerId: _owner, accountId: _account, ...business } = row; return business;
  })])) as unknown as WireSnapshot;
}
export function decodeSnapshot(input: unknown, accountId: string): ChainState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('云端数据不完整，本机数据已保留');
  const wire = input as WireSnapshot;
  if (Object.keys(wire).length !== syncedStores.length || syncedStores.some(k => !Array.isArray(wire[k]))) throw new Error('云端数据不完整，本机数据已保留');
  for (const store of syncedStores) for (const row of wire[store]) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !Number.isSafeInteger(row.createdAt) || !Number.isSafeInteger(row.updatedAt) || 'ownerId' in row || 'accountId' in row) throw new Error('云端记录无效，本机数据已保留');
  }
  const state = Object.fromEntries(syncedStores.map(store => [store, wire[store].map(row => ({ ...row, ownerId: accountId, accountId }))])) as Omit<ChainState, 'metadata' | 'occupancy'>;
  if (state.settings.length !== 1 || state.settings[0]?.id !== 'preferences' || typeof state.settings[0].soundEnabled !== 'boolean') throw new Error('云端设置无法读取，本机数据已保留');
  const tasks = state.tasks.filter(unfinished);
  if (tasks.length > 1) throw new Error('云端任务状态不一致，本机数据已保留');
  return { ...state, metadata: [{ id: 'local-owner', ownerId: accountId }], occupancy: tasks[0] ? [{ id: 'active', taskId: tasks[0].id }] : [] };
}
export function emptyGuest(now: number): ChainState {
  const ownerId = crypto.randomUUID();
  const state = decodeSnapshot(Object.fromEntries(syncedStores.map(k => [k, k === 'settings' ? [{ id: 'preferences', createdAt: now, updatedAt: now, soundEnabled: true }] : []])), ownerId);
  for (const store of syncedStores) for (const row of state[store]) row.accountId = null;
  return state;
}
