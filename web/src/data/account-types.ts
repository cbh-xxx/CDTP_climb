import type { ChainState, Settings } from '../domain/models';
import type { TaskOutcome } from '../domain/task-commands';
export interface Account { id: string; username: string }
export interface PendingOperation {
  kind: 'write' | 'register' | 'login' | 'logout';
  username?: string;
  accountId?: string;
  payload?: Record<string, unknown>;
  candidate?: ChainState;
  result?: string | Settings | TaskOutcome;
  confirmed?: { account: Account; snapshot: unknown };
}
export interface AccountControl {
  id: 'account'; account: Account | null; pending?: PendingOperation;
  clock?: { server: number; wall: number };
}
export interface AccountStatus {
  account: Account | null; busy: boolean; writable: boolean; error: string;
  pending?: PendingOperation['kind']; pendingUsername?: string;
  dataVersion: number; identityVersion: number;
}
export interface AccountAccess {
  status(): AccountStatus;
  subscribe(listener: () => void): () => void;
  authenticate(kind: 'register' | 'login', username: string, password: string, acknowledged: boolean): Promise<void>;
  logout(): Promise<void>;
  retry(password?: string): Promise<void>;
  reconnect(): Promise<void>;
  networkChanged(online: boolean): void;
}
