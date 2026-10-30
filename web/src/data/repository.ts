import type { ChainState, Settings, StoreRecords } from '../domain/models';
import type { ChainCommand, RecordWrite } from '../domain/chain-commands';
import type { TaskCommand, TaskOutcome } from '../domain/task-commands';
import type { AccountAccess } from './account-types';
export type StoreName = keyof StoreRecords;
export type Write = RecordWrite;
export interface HomeSnapshot { chainCount: number; settings: Settings }
export interface Repository {
  readonly account?: AccountAccess;
  initialize(): Promise<void>;
  readHome(): Promise<HomeSnapshot>;
  setSound(enabled: boolean): Promise<Settings>;
  get<K extends StoreName>(store: K, id: string): Promise<StoreRecords[K] | undefined>;
  writeAtomically(writes: Write[]): Promise<void>;
  readChainState(): Promise<ChainState>;
  executeChainCommand(command: ChainCommand): Promise<string>;
  executeTaskCommand(command: TaskCommand): Promise<TaskOutcome>;
  recoverTasks(): Promise<TaskOutcome>;
  close(): void;
}
