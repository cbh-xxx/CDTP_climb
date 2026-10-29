export type Id = string;
export interface Entity {
  id: Id;
  ownerId: Id;
  accountId: Id | null;
  createdAt: number;
  updatedAt: number;
}
export interface Chain extends Entity {
  name: string;
  status: 'available' | 'archived' | 'needs-round';
  currentRoundId: Id;
  lastStartedAt: number | null;
  archivedAt?: number | null;
}
export interface Round extends Entity {
  chainId: Id;
  number: number;
  action: string;
  status: 'active' | 'failed';
  successfulMinutes: number;
  nodes: number;
  remainderMinutes: number;
  failedAt?: number | null;
  nodesBeforeFailure?: number | null;
  failureReason?: string | null;
  failureStage?: 'reservation' | 'focus' | null;
}
export interface TaskBase extends Entity {
  chainId: Id;
  roundId: Id;
  content: string;
  plannedMinutes: number;
  focusStartedAt?: number | null;
  pauseStartedAt?: number | null;
  pendingDecisionId?: Id | null;
  pendingInterruptionId?: Id | null;
  dueNotified?: boolean;
  goalNotified?: boolean;
}
export type Task = TaskBase & (
  | { status: 'reserved'; dueAt: number }
  | { status: 'cancel-pending'; remainingMs: number }
  | { status: 'focusing'; accumulatedMs: number; runningSince: number }
  | { status: 'interrupt-pending' | 'paused'; accumulatedMs: number }
  | { status: 'succeeded' | 'failed' | 'cancelled'; endedAt: number; accumulatedMs: number }
);
export interface Decision extends Entity {
  taskId: Id;
  kind: 'reservation-cancel' | 'focus-interrupt';
  outcome: 'allowed' | 'violation';
  precedentId: Id | null;
  reason: string | null;
}
export interface Precedent extends Entity { chainId: Id; situation: string }
export interface RoundPrecedent extends Entity { roundId: Id; precedentId: Id }
export interface Interruption extends Entity {
  chainId: Id; taskId: Id; precedentId: Id;
  startedAt: number; resumedAt: number | null;
}
export interface TaskContent extends Entity { chainId: Id; content: string; lastUsedAt: number }
export interface Settlement extends Entity {
  taskId: Id;
  chainId: Id;
  roundId: Id;
  outcome: 'succeeded' | 'failed' | 'cancelled';
  creditedMinutes: number;
  effectiveMs?: number;
  resultNodes?: number;
  addedNodes?: number;
}
export interface Settings extends Entity { soundEnabled: boolean }
export interface ClimbRecord extends Entity { highestLevel: number; highestTotalNodes: number }
export interface Occupancy { id: 'active'; taskId: Id }
export interface Metadata { id: 'local-owner'; ownerId: Id }
export interface StoreRecords {
  chains: Chain; rounds: Round; tasks: Task; decisions: Decision;
  precedents: Precedent; roundPrecedents: RoundPrecedent;
  settlements: Settlement; settings: Settings; climbRecords: ClimbRecord;
  occupancy: Occupancy; metadata: Metadata;
  interruptions: Interruption; taskContents: TaskContent;
}
export type ChainState = { [K in keyof StoreRecords]: StoreRecords[K][] };
