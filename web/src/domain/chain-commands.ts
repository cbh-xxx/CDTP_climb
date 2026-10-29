import type { ChainState, Entity, StoreRecords } from './models';
import { actionError, inheritanceCandidates, managementError, nameError, normalizeText } from './chains';

export type ChainCommand =
  | { type: 'create'; chainId: string; roundId: string; name: string; action: string }
  | { type: 'rename'; chainId: string; name: string }
  | { type: 'archive'; chainId: string }
  | { type: 'restore'; chainId: string }
  | { type: 'delete'; chainId: string }
  | { type: 'new-round'; chainId: string; expectedRoundId: string; roundId: string; action: string; inheritedIds: string[] };
export type RecordWrite = { [K in keyof StoreRecords]: { store: K; value: StoreRecords[K]; kind: 'add' | 'put' } }[keyof StoreRecords];
export interface ChangeSet { writes: RecordWrite[]; deletes: { store: keyof StoreRecords; id: string }[]; chainId: string }
export function planChainCommand(state: ChainState, command: ChainCommand, now: number): ChangeSet {
  const changes: ChangeSet = { writes: [], deletes: [], chainId: command.chainId };
  const owner = state.metadata.find(item => item.id === 'local-owner');
  if (!owner) throw new Error('本地归属信息缺失，未保存');
  const entity = (id: string): Entity => ({ id, ownerId: owner.ownerId, accountId: null, createdAt: now, updatedAt: now });
  if (command.type === 'create') {
    const existing = state.chains.find(chain => chain.id === command.chainId);
    if (existing) {
      if (existing.currentRoundId === command.roundId) return changes;
      throw new Error('创建请求标识冲突，请重新打开创建弹窗');
    }
    const error = nameError(command.name, state.chains) || actionError(command.action);
    if (error) throw new Error(error);
    changes.writes.push({ store: 'chains', kind: 'add', value: { ...entity(command.chainId), name: normalizeText(command.name), status: 'available', currentRoundId: command.roundId, lastStartedAt: null, archivedAt: null } },
      { store: 'rounds', kind: 'add', value: { ...entity(command.roundId), chainId: command.chainId, number: 1, action: normalizeText(command.action), status: 'active', successfulMinutes: 0, nodes: 0, remainderMinutes: 0 } });
    return changes;
  }
  const chain = state.chains.find(item => item.id === command.chainId);
  if (!chain) throw new Error('链条不存在或已被删除');
  const error = managementError(state, chain, command.type);
  if (error) throw new Error(error);
  if (command.type === 'delete') {
    const rounds = new Set(state.rounds.filter(item => item.chainId === chain.id).map(item => item.id));
    const tasks = new Set(state.tasks.filter(item => item.chainId === chain.id || rounds.has(item.roundId)).map(item => item.id));
    const precedents = new Set(state.precedents.filter(item => item.chainId === chain.id).map(item => item.id));
    const remove = (store: keyof StoreRecords, records: { id: string }[]) => {
      for (const item of records) changes.deletes.push({ store, id: item.id });
    };
    remove('chains', [chain]);
    remove('rounds', state.rounds.filter(item => rounds.has(item.id)));
    remove('tasks', state.tasks.filter(item => tasks.has(item.id)));
    remove('decisions', state.decisions.filter(item => tasks.has(item.taskId)));
    remove('interruptions', state.interruptions.filter(item => item.chainId === chain.id || tasks.has(item.taskId)));
    remove('settlements', state.settlements.filter(item => item.chainId === chain.id || tasks.has(item.taskId)));
    remove('roundPrecedents', state.roundPrecedents.filter(item => rounds.has(item.roundId) || precedents.has(item.precedentId)));
    remove('precedents', state.precedents.filter(item => precedents.has(item.id)));
    remove('taskContents', state.taskContents.filter(item => item.chainId === chain.id));
    remove('occupancy', state.occupancy.filter(item => tasks.has(item.taskId)));
    return changes;
  }
  if (command.type === 'rename') {
    const invalid = nameError(command.name, state.chains, chain.id); if (invalid) throw new Error(invalid);
    changes.writes.push({ store: 'chains', kind: 'put', value: { ...chain, name: normalizeText(command.name), updatedAt: now } });
  } else if (command.type === 'archive' || command.type === 'restore') {
    if (command.type === 'archive' && chain.status === 'archived') return changes;
    if (command.type === 'restore' && chain.status !== 'archived') return changes;
    changes.writes.push({ store: 'chains', kind: 'put', value: { ...chain, status: command.type === 'archive' ? 'archived' : 'available', archivedAt: command.type === 'archive' ? now : null, updatedAt: now } });
  } else {
    if (chain.currentRoundId === command.roundId) return changes;
    if (chain.status !== 'needs-round' || chain.currentRoundId !== command.expectedRoundId) throw new Error('本轮状态已变化，请重新打开新轮设置');
    const previous = state.rounds.find(item => item.id === chain.currentRoundId && item.chainId === chain.id);
    if (!previous || previous.status !== 'failed') throw new Error('上一轮状态无法读取，未保存新轮');
    const invalid = actionError(command.action); if (invalid) throw new Error(invalid);
    const candidates = inheritanceCandidates(state, chain.id);
    const inherited = [...new Set(command.inheritedIds)];
    if (inherited.some(id => !candidates.some(item => item.id === id))) throw new Error('继承候选已变化，请重新选择');
    changes.writes.push({ store: 'rounds', kind: 'add', value: { ...entity(command.roundId), chainId: chain.id, number: previous.number + 1, action: normalizeText(command.action), status: 'active', successfulMinutes: 0, nodes: 0, remainderMinutes: 0 } },
      { store: 'chains', kind: 'put', value: { ...chain, currentRoundId: command.roundId, status: 'available', updatedAt: now } });
    for (const id of inherited) changes.writes.push({ store: 'roundPrecedents', kind: 'add', value: { ...entity(`${command.roundId}:${id}`), roundId: command.roundId, precedentId: id } });
  }
  return changes;
}
