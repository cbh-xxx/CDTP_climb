import data from './peaks.json';
import { peakThreshold, reachedLevel } from './climb';
import type { ChainState } from './models';
import { totalNodes } from './chains';
export const routePeaks = data.map(peak => ({ ...peak, threshold: peakThreshold(peak.level) }));
export function climbOverview(state: ChainState) {
  const nodes = totalNodes(state);
  return { nodes, level: reachedLevel(nodes), highestLevel: Math.max(0, ...state.climbRecords.map(item => item.highestLevel)), highestNodes: Math.max(0, ...state.climbRecords.map(item => item.highestTotalNodes)) };
}
export function levelSteps(from: number, to: number) {
  return Array.from({ length: Math.abs(to - from) }, (_, index) => from + Math.sign(to - from) * (index + 1));
}
