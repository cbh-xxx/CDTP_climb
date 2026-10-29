import type { Chain, ChainState, Precedent, Task } from './models';

export const ACTION_PRESETS = ['坐到书桌前', '戴上耳机'] as const;
export const normalizeText = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
export const characterCount = (text: string) => [...segmenter.segment(text)].length;
export function nameError(name: string, chains: Chain[], exceptId?: string): string {
  const normalized = normalizeText(name);
  if (!normalized) return '请输入链名称';
  if (characterCount(normalized) > 15) return '链名称最多15个字符';
  if (chains.some(chain => chain.id !== exceptId && normalizeText(chain.name) === normalized)) return '链名称已存在';
  return '';
}
export function actionError(action: string): string {
  if (!normalizeText(action)) return '请选择现实动作';
  if (characterCount(normalizeText(action)) > 10) return '现实动作最多10个字符';
  return '';
}
export const unfinished = (task: Task) => !['succeeded', 'failed', 'cancelled'].includes(task.status);
export function activeTask(state: ChainState): Task | undefined {
  return state.tasks.find(task => unfinished(task) && !state.settlements.some(settlement => settlement.taskId === task.id));
}
export function managementError(state: ChainState, chain: Chain, action: 'rename' | 'archive' | 'delete' | 'restore' | 'new-round'): string {
  const occupied = state.tasks.some(task => task.chainId === chain.id && unfinished(task) && !state.settlements.some(settlement => settlement.taskId === task.id))
    || state.occupancy.some(slot => state.tasks.some(task => task.id === slot.taskId && task.chainId === chain.id));
  if (occupied) return '请先处理当前任务';
  if (action === 'archive' && chain.status === 'needs-round') return '请先设置新一轮';
  return '';
}
const stableId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
export function sortChains(chains: Chain[]): Chain[] {
  return [...chains].sort((a, b) => {
    if (a.lastStartedAt !== null && b.lastStartedAt === null) return -1;
    if (a.lastStartedAt === null && b.lastStartedAt !== null) return 1;
    return (b.lastStartedAt ?? b.createdAt) - (a.lastStartedAt ?? a.createdAt) || stableId(a, b);
  });
}
export const recentChains = (state: ChainState) => sortChains(state.chains.filter(chain => chain.status === 'available')).slice(0, 3);
export const archivedChains = (state: ChainState) => state.chains.filter(chain => chain.status === 'archived')
  .sort((a, b) => (b.archivedAt ?? b.updatedAt) - (a.archivedAt ?? a.updatedAt) || stableId(a, b));
export function inheritanceCandidates(state: ChainState, chainId: string): Precedent[] {
  const rounds = new Set(state.rounds.filter(round => round.chainId === chainId && round.status === 'failed').map(round => round.id));
  const historical = new Set(state.roundPrecedents.filter(link => rounds.has(link.roundId)).map(link => link.precedentId));
  const grouped = new Map<string, Precedent>();
  for (const precedent of state.precedents.filter(item => item.chainId === chainId && historical.has(item.id))) {
    const key = normalizeText(precedent.situation);
    const existing = grouped.get(key);
    if (!existing || precedent.createdAt < existing.createdAt || (precedent.createdAt === existing.createdAt && stableId(precedent, existing) < 0)) grouped.set(key, precedent);
  }
  return [...grouped.values()].sort((a, b) => b.createdAt - a.createdAt || stableId(a, b));
}
export function chainDetail(state: ChainState, chainId: string) {
  const chain = state.chains.find(item => item.id === chainId);
  if (!chain) throw new Error('链条不存在或已被删除');
  const round = state.rounds.find(item => item.id === chain.currentRoundId && item.chainId === chain.id);
  if (!round) throw new Error('链条当前轮数据无法读取，未修改本地数据');
  const effectiveIds = new Set(state.roundPrecedents.filter(link => link.roundId === round.id).map(link => link.precedentId));
  const precedents = state.precedents.filter(item => item.chainId === chainId && effectiveIds.has(item.id)).sort((a, b) => b.createdAt - a.createdAt || stableId(a, b));
  const records = state.tasks.filter(task => task.chainId === chainId && task.roundId === round.id && (task.status === 'succeeded' || task.status === 'cancelled'))
    .sort((a, b) => ('endedAt' in b ? b.endedAt : 0) - ('endedAt' in a ? a.endedAt : 0) || stableId(a, b));
  const summaries = state.rounds.filter(item => item.chainId === chainId && item.status === 'failed').sort((a, b) => (b.failedAt ?? b.updatedAt) - (a.failedAt ?? a.updatedAt) || b.number - a.number);
  return { chain, round, records, precedents, summaries, candidates: inheritanceCandidates(state, chainId) };
}
export function totalNodes(state: ChainState): number {
  return state.chains.reduce((sum, chain) => sum + (state.rounds.find(round => round.id === chain.currentRoundId && round.status === 'active')?.nodes ?? 0), 0);
}
