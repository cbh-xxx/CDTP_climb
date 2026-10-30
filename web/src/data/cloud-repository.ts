import type { ChainState, Settings, StoreRecords } from '../domain/models';
import type { Repository, StoreName, Write } from './repository';
import type { ChainCommand } from '../domain/chain-commands';
import { planChainCommand } from '../domain/chain-commands';
import { planTaskCommand, planTaskRecovery, type TaskCommand, type TaskOutcome } from '../domain/task-commands';
import type { Account, AccountAccess, AccountControl, AccountStatus, PendingOperation } from './account-types';
import { AccountClock, estimateServerTime } from './account-clock';
import { IndexedDbRepository } from './indexed-db';
import { decodeSnapshot, emptyGuest, encodeSnapshot } from './snapshot-codec';

class HttpError extends Error { constructor(message: string, readonly status: number) { super(message); } }
type Remote = { account?: Account; snapshot?: unknown; schemaVersion?: number; revision?: number; updatedAt?: number; serverReceivedAt?: number; serverSentAt?: number };
type Change = { writes: Write[]; deletes: { store: StoreName; id: string }[] };
function apply(state: ChainState, change: Change): ChainState {
  const next = structuredClone(state);
  const records = next as Record<StoreName, { id: string }[]>;
  for (const deletion of change.deletes) records[deletion.store] = records[deletion.store].filter(x => x.id !== deletion.id);
  for (const write of change.writes) {
    const rows = records[write.store], index = rows.findIndex(x => x.id === write.value.id);
    if (write.kind === 'add' && index >= 0) throw new Error('记录标识重复，未保存');
    if (index < 0) rows.push(structuredClone(write.value)); else rows[index] = structuredClone(write.value);
  }
  return next;
}
export class CloudRepository implements Repository, AccountAccess {
  readonly account: AccountAccess = this;
  private control: AccountControl = { id: 'account', account: null };
  private listeners = new Set<() => void>();
  private busy = false;
  private ready = false;
  private error = '';
  private epoch = 0;
  private dataVersion = 0;
  private identityVersion = 0;
  constructor(private local: IndexedDbRepository, readonly clock: AccountClock, private transport: typeof fetch = fetch, private online = () => navigator.onLine) {}
  status = (): AccountStatus => ({ account: this.control.account, busy: this.busy, writable: !this.busy && !this.control.pending && (!this.control.account || (this.ready && this.online())), error: this.error, pending: this.control.pending?.kind, pendingUsername: this.control.pending?.username, dataVersion: this.dataVersion, identityVersion: this.identityVersion });
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { for (const listener of this.listeners) listener(); }
  private async request(path: string, method = 'GET', body?: unknown): Promise<Remote> {
    const epoch = this.epoch;
    const prefix = __TEST_BUILD__ ? '/test-api' : '/api';
    const response = await this.transport.call(globalThis, `${prefix}${path}`, { method, credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const value = await response.json();
    if (epoch !== this.epoch) throw new Error('账户操作已失效，旧响应未应用');
    if (!response.ok) throw new HttpError(value?.error?.message ?? '服务器未确认保存，请重试原操作', response.status);
    if (!value || typeof value !== 'object') throw new Error('服务器响应不完整，请重试原操作');
    return value as Remote;
  }
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('正在提交，请等待服务器确认');
    this.busy = true; this.error = ''; this.emit();
    try { return await work(); }
    catch (error) {
      this.error = error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? error.message : !this.control.account && !this.control.pending ? '本地修改未保存，请重试。' : '网络或保存失败，结果尚未确认，请重试原操作';
      if (this.control.account) this.ready = false;
      throw new Error(this.error);
    } finally { this.busy = false; this.emit(); }
  }
  private async persist(control: AccountControl) { await this.local.saveControl(control); this.control = control; this.emit(); }
  async initialize() {
    ++this.epoch; await this.local.initialize(); this.control = await this.local.readControl(); this.ready = false;
    if (this.control.account) {
      // A persisted server anchor supports approximate read-only display before calibration.
      if (this.control.clock) this.clock.useAccount(this.control.clock.server + Math.max(0, Date.now() - this.control.clock.wall));
      else this.clock.useAccount(0);
      if (!['register', 'login', 'logout'].includes(this.control.pending?.kind ?? '')) {
        try { await this.checkSession(); } catch { this.error = '会话或校时未确认，账户只读。联网后重试；必要时重新登录原账户。'; }
      }
    } else this.clock.useGuest();
    if (this.control.pending) this.error = '存在未确认操作，请重试原操作；暂不接受新的修改';
    this.emit();
  }
  private async checkSession() {
    this.ready = false;
    if (!this.online()) throw new Error('当前离线，账户只读');
    const session = await this.request('/v1/auth/session');
    if (!session.account || session.account.id !== this.control.account?.id) throw new Error('当前会话与缓存账户不同，请重新登录原账户；缓存已保留');
    await this.calibrate(session.account.id);
  }
  private async calibrate(accountId: string) {
    if (!this.online()) throw new Error('当前离线，校时失败，账户只读');
    const sentWall = Date.now(), sentMono = performance.now();
    const sample = await this.request('/v1/time');
    const receivedMono = performance.now(), receivedWall = Date.now();
    const server = estimateServerTime({ sentWall, sentMono, receivedWall, receivedMono, received: sample.serverReceivedAt!, sent: sample.serverSentAt! });
    if (this.control.account && this.control.account.id !== accountId && !this.control.pending?.confirmed) throw new Error('账户已变化，校时未应用');
    this.clock.useAccount(server);
    this.ready = true;
    return { server, wall: receivedWall };
  }
  async reconnect() {
    await this.exclusive(async () => {
      if (!this.control.account) return;
      if (this.control.pending && this.control.pending.kind !== 'write') throw new Error('请先重试未确认的账户操作');
      const session = await this.request('/v1/auth/session');
      if (session.account?.id !== this.control.account.id) throw new Error('会话已失效，请重新登录原账户；未确认操作仍保留');
      const clock = await this.calibrate(this.control.account.id);
      await this.persist({ ...this.control, clock });
    });
  }
  networkChanged(online: boolean) { if (!online && this.control.account) { this.ready = false; this.error = '当前离线，账户只读；计时继续显示，联网后再提交'; } this.emit(); }
  private assertWritable() {
    if (this.control.pending) throw new Error('请先重试未确认操作，不接受新的修改');
    if (this.control.account && (!this.ready || !this.online())) throw new Error('账户只读，请先确认会话并完成校时');
  }
  private async saveCandidate(candidate: ChainState, result: PendingOperation['result']) {
    const account = this.control.account!;
    candidate = decodeSnapshot(encodeSnapshot(candidate), account.id);
    const payload = { schemaVersion: 1, operationId: crypto.randomUUID(), snapshot: encodeSnapshot(candidate) };
    await this.persist({ ...this.control, pending: { kind: 'write', accountId: account.id, payload, candidate, result } });
    await this.resolvePending();
  }
  private async resolvePending(password?: string) {
    const pending = this.control.pending;
    if (!pending) return;
    if (!this.online()) throw new Error('当前离线，未确认操作已保留；联网后重试');
    if (pending.kind === 'write') {
      if (!this.ready) await this.checkSession();
      if (this.control.account?.id !== pending.accountId) throw new Error('原账户已变化，禁止应用旧请求');
      const result = await this.request(`/v1/accounts/${pending.accountId}/snapshot`, 'PUT', pending.payload);
      if (result.schemaVersion !== 1 || !Number.isSafeInteger(result.revision)) throw new Error('保存响应不完整，请重试原操作');
      const control = { ...this.control, pending: undefined };
      await this.local.replaceState(pending.candidate!, control); this.control = control; ++this.dataVersion;
    } else if (pending.kind === 'logout') {
      await this.request('/v1/auth/logout', 'POST', {});
      const control: AccountControl = { id: 'account', account: null };
      await this.local.replaceState(emptyGuest(Date.now()), control); this.control = control; this.clock.useGuest(); this.ready = false; ++this.dataVersion; ++this.identityVersion;
    } else {
      let confirmed = pending.confirmed;
      if (!confirmed || password) {
        if (!password) throw new Error('请重新输入原密码以确认这笔账户操作；密码不会持久保存');
        const result = await this.request(`/v1/auth/${pending.kind}`, 'POST', { username: pending.username, password, ...(pending.kind === 'register' ? { acknowledgeNoRecovery: true, initialData: pending.payload } : {}) });
        if (!result.account || result.schemaVersion !== 1) throw new Error('账户响应不完整，本机数据已保留');
        decodeSnapshot(result.snapshot, result.account.id);
        confirmed = { account: result.account, snapshot: result.snapshot };
        await this.persist({ ...this.control, pending: { ...pending, confirmed } });
      }
      const snapshot = decodeSnapshot(confirmed.snapshot, confirmed.account.id);
      // The server may have changed the Cookie while the response was lost. Always verify identity before applying.
      const session = await this.request('/v1/auth/session');
      if (session.account?.id !== confirmed.account.id) throw new Error('会话已变化，请重新登录确认；原本机数据已保留');
      const clock = await this.calibrate(confirmed.account.id);
      const control: AccountControl = { id: 'account', account: confirmed.account, clock };
      await this.local.replaceState(snapshot, control); this.control = control; ++this.dataVersion; ++this.identityVersion;
    }
    this.error = ''; this.emit();
  }
  async authenticate(kind: 'register' | 'login', username: string, password: string, acknowledged: boolean) {
    await this.exclusive(async () => {
      username = username.toLowerCase();
      if (this.control.pending) {
        if (this.control.pending.kind === 'write' && kind === 'login' && username === this.control.account?.username) {
          const result = await this.request('/v1/auth/login', 'POST', { username, password });
          if (result.account?.id !== this.control.account.id) throw new Error('必须重新登录原账户');
          const clock = await this.calibrate(result.account.id); await this.persist({ ...this.control, clock });
          return;
        }
        if (this.control.pending.kind !== kind || this.control.pending.username !== username) throw new Error('请先处理原来的未确认操作');
        await this.resolvePending(password); return;
      }
      if (!this.online()) throw new Error('当前离线，账户操作须联网确认');
      if (!/^[A-Za-z0-9_]{3,32}$/.test(username) || password.length < 12 || password.length > 128 || new TextEncoder().encode(password).length > 512 || /[\u0000-\u001f\u007f]/.test(password)) throw new Error('用户名须为3—32位字母数字下划线；密码须为12—128个字符且不含控制字符');
      if (kind === 'register' && (!acknowledged || this.control.account)) throw new Error('请先退出回到游客，并确认不提供密码找回或人工重置');
      const state = await this.local.readChainState();
      const payload = kind === 'register' ? { schemaVersion: 1, operationId: crypto.randomUUID(), clientTime: this.clock.now(), snapshot: encodeSnapshot(state) } : undefined;
      await this.persist({ ...this.control, pending: { kind, username, payload } });
      try { await this.resolvePending(password); }
      catch (error) {
        // Explicit credential/input rejection occurs before authentication or snapshot commit.
        if (error instanceof HttpError && [400,401,409,413,422].includes(error.status)) await this.persist({ ...this.control, pending: undefined });
        throw error;
      }
    });
  }
  async logout() { await this.exclusive(async () => { if (this.control.pending) throw new Error('请先处理未确认操作再退出'); if (!this.online()) throw new Error('退出需要服务器确认，请联网后重试'); await this.persist({ ...this.control, pending: { kind: 'logout' } }); await this.resolvePending(); }); }
  async retry(password?: string) { await this.exclusive(async () => this.resolvePending(password)); }
  async readChainState() {
    const state = await this.local.readChainState();
    // Silent projection: startup recovery never uploads or plays old notifications.
    return this.control.account ? apply(state, planTaskRecovery(state, this.clock.now())) : state;
  }
  readHome() { return this.local.readHome(); }
  async get<K extends StoreName>(store: K, id: string): Promise<StoreRecords[K] | undefined> { return (await this.readChainState())[store].find(x => x.id === id); }
  async setSound(enabled: boolean): Promise<Settings> {
    return this.exclusive(async () => {
      this.assertWritable(); if (!this.control.account) return this.local.setSound(enabled);
      const state = await this.local.readChainState(), current = state.settings[0]; if (!current) throw new Error('声音设置缺失');
      const settings = { ...current, soundEnabled: enabled, updatedAt: this.clock.now() };
      await this.saveCandidate(apply(state, { writes: [{ store: 'settings', kind: 'put', value: settings }], deletes: [] }), settings); return settings;
    });
  }
  async executeChainCommand(command: ChainCommand) {
    return this.exclusive(async () => {
      this.assertWritable(); if (!this.control.account) return this.local.executeChainCommand(command);
      const state = await this.local.readChainState(), change = planChainCommand(state, command, this.clock.now());
      await this.saveCandidate(apply(state, change), change.chainId); return change.chainId;
    });
  }
  async executeTaskCommand(command: TaskCommand) {
    return this.exclusive(async () => {
      this.assertWritable(); if (!this.control.account) return this.local.executeTaskCommand(command);
      const issuedAt = this.clock.now(), state = await this.local.readChainState(), change = planTaskCommand(state, command, issuedAt);
      const result: TaskOutcome = { taskId: change.taskId, settlementId: change.settlementId, events: change.events, aborted: change.aborted };
      if (change.writes.length || change.deletes.length) await this.saveCandidate(apply(state, change), result);
      return result;
    });
  }
  async writeAtomically(writes: Write[]) { if (this.control.account || this.control.pending || this.busy) throw new Error('账户业务须通过正式命令保存'); await this.local.writeAtomically(writes); }
  async recoverTasks(): Promise<TaskOutcome> { return this.control.account || this.control.pending ? { events: [] } : this.local.recoverTasks(); }
  close() { ++this.epoch; this.ready = false; this.local.close(); }
}
