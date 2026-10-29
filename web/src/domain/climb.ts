export const CLIMB_CONFIG = { peakCount: 30, nodesPerPeak: 20, minutesPerNode: 30 } as const;
export function nonNegativeInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('数值必须为非负安全整数');
}
export function peakThreshold(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > CLIMB_CONFIG.peakCount) throw new Error('山峰等级须为1—30');
  return CLIMB_CONFIG.nodesPerPeak * level;
}
export function reachedLevel(totalNodes: number): number {
  nonNegativeInteger(totalNodes);
  return Math.min(CLIMB_CONFIG.peakCount, Math.floor(totalNodes / CLIMB_CONFIG.nodesPerPeak));
}
// Only the caller's selected chain/round is converted; never pool remainders.
export function creditSuccess(previousMinutes: number, effectiveTimeMs: number) {
  nonNegativeInteger(previousMinutes);
  nonNegativeInteger(effectiveTimeMs);
  const creditedMinutes = Math.floor(effectiveTimeMs / 60_000);
  const totalMinutes = previousMinutes + creditedMinutes;
  nonNegativeInteger(totalMinutes);
  return { creditedMinutes, totalMinutes, nodes: Math.floor(totalMinutes / CLIMB_CONFIG.minutesPerNode), remainderMinutes: totalMinutes % CLIMB_CONFIG.minutesPerNode };
}
