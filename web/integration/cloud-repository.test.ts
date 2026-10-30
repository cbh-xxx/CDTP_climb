import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { buildApp } from '../../backend/src/app';
import { openDatabase } from '../../backend/src/database';
import { CloudRepository } from '../src/data/cloud-repository';
import { IndexedDbRepository } from '../src/data/indexed-db';
import { AccountClock } from '../src/data/account-clock';
import type { Repository } from '../src/data/repository';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const clean of cleanup.splice(0).reverse()) await clean(); });
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'climb-client-integration-'));
  let serverTime = 1800000000000;
  const origin = 'http://127.0.0.1:5173';
  const app = await buildApp({ host:'127.0.0.1', port:3001, origin, secret:'integration-secret'.repeat(3), dataDir:dir, secure:false, sessionMs:600000 }, () => serverTime);
  const db = openDatabase(dir);
  cleanup.push(async () => { db.close(); await app.close(); expect(dirname(resolve(dir))).toBe(resolve(tmpdir())); rmSync(dir, {recursive:true,force:true}); });
  function device() {
    const factory = new IDBFactory(); let cookie = '', online = true, guestTime = 1700000000000, mono = 0;
    const calls: {path:string;body:unknown}[] = [];
    let drop = '', hold = ''; let release: (() => void) | undefined; let started: (() => void) | undefined;
    const transport: typeof fetch = async function(this: unknown, input, init) {
      expect(this).toBe(globalThis);
      if (!online) throw new Error('offline');
      const path = String(input).replace(/^\/api/, ''); calls.push({path,body:init?.body ? JSON.parse(String(init.body)) : undefined});
      const response = await app.inject({method: (init?.method ?? 'GET') as 'GET'|'POST'|'PUT',url:path,headers:{origin,cookie,...(init?.body ? {'content-type':'application/json'}:{})},payload:init?.body as string|undefined});
      if (response.headers['set-cookie']) cookie = String(response.headers['set-cookie']).split(';')[0] ?? '';
      if (path.includes(hold) && hold) { started?.(); await new Promise<void>(r => { release = r; }); }
      if (path.includes(drop) && drop) { drop = ''; throw new Error('response lost after commit'); }
      return new Response(response.body,{status:response.statusCode,headers:{'content-type':'application/json'}});
    };
    const local = new IndexedDbRepository('device', {now:()=>guestTime}, factory);
    const clock = new AccountClock({now:()=>guestTime},()=>mono);
    let repository = new CloudRepository(local,clock,transport,()=>online);
    cleanup.push(async () => repository.close());
    return {
      get repository(){return repository;},local,clock,calls,
      advance(ms:number){guestTime+=ms;mono+=ms;serverTime+=ms;},
      offline(value:boolean){online=!value;repository.networkChanged(online);},
      drop(path:string){drop=path;},
      hold(path:string){hold=path;return new Promise<void>(r=>{started=r;});},release(){hold='';release?.();},
      async reopen(){repository.close();repository=new CloudRepository(local,clock,transport,()=>online);await repository.initialize();await repository.recoverTasks();},
      async initialize(){await repository.initialize();},
    };
  }
  return {device,db,expire(){serverTime+=610000;},app};
}
const password='Integration-password-123';
async function create(repo:Repository,id='chain',name='阅读') { await repo.executeChainCommand({type:'create',chainId:id,roundId:`${id}-round`,name,action:'戴上耳机'}); }
async function start(repo:Repository) { await repo.executeTaskCommand({type:'start',taskId:'task',chainId:'chain',expectedRoundId:'chain-round',content:'阅读论文',plannedMinutes:5,reservationMinutes:null}); }

describe('账户模式、服务器确认与缓存切换（真实SQLite）',()=>{
 it('游客带入进行中任务、已有账户登录替换、任务中换号、退出为空游客',async()=>{
   const {device}=await setup();const a=device();await a.initialize();await create(a.repository);await start(a.repository);a.advance(62000);
   await a.repository.authenticate('register','alice',password,true);
   const migrated=await a.repository.readChainState();expect(migrated.tasks[0]?.status).toBe('focusing');expect(migrated.tasks[0] && 'accumulatedMs' in migrated.tasks[0] ? migrated.tasks[0].accumulatedMs : -1).toBe(62000);expect(migrated.settlements).toHaveLength(0);
   expect(migrated.tasks[0]?.accountId).toBe(a.repository.status().account?.id);
   await a.repository.setSound(false);
   const b=device();await b.initialize();await b.repository.authenticate('register','bob',password,true);
   await b.repository.executeChainCommand({type:'create',chainId:'b',roundId:'br',name:'其他账户',action:'戴上耳机'});
   await a.repository.authenticate('login','bob',password,false);
   const replaced=await a.repository.readChainState();expect(replaced.chains.map(c=>c.id)).toEqual(['b']);expect(replaced.tasks).toHaveLength(0);expect(replaced.settlements).toHaveLength(0);
   await a.repository.logout();expect((await a.repository.readChainState()).chains).toHaveLength(0);expect(a.repository.status().account).toBeNull();
   await a.repository.authenticate('login','alice',password,false);expect((await a.repository.readChainState()).tasks).toHaveLength(1);expect((await a.repository.readHome()).settings.soundEnabled).toBe(false);
 });
 it('服务器确认前候选不生效，提交中防重，迟到的旧响应不写回',async()=>{
   const {device}=await setup();const a=device();await a.initialize();await a.repository.authenticate('register','alice',password,true);
   const started=a.hold('/snapshot');const pending=create(a.repository);await started;
   expect((await a.local.readChainState()).chains).toHaveLength(0);expect(a.repository.status().busy).toBe(true);
   await expect(create(a.repository,'duplicate')).rejects.toThrow('等待服务器');
   a.repository.close();a.release();await expect(pending).rejects.toThrow();await a.reopen();expect((await a.local.readChainState()).chains).toHaveLength(0);expect(a.repository.status().pending).toBe('write');
   await a.repository.retry();expect((await a.repository.readChainState()).chains).toHaveLength(1);
 });
 it('响应丢失和刷新后用原ID原候选重试，不重算结算，断网不排队',async()=>{
   const {device,db}=await setup();const a=device();await a.initialize();await create(a.repository);await start(a.repository);await a.repository.authenticate('register','alice',password,true);a.advance(300000);
   a.drop('/snapshot');await expect(a.repository.executeTaskCommand({type:'finish',taskId:'task'})).rejects.toThrow('尚未确认');
   expect((await a.local.readChainState()).settlements).toHaveLength(0);
   const original=await a.local.readControl();a.offline(true);await expect(a.repository.setSound(false)).rejects.toThrow();expect((await a.local.readControl()).pending).toEqual(original.pending);
   a.offline(false);a.advance(90000);await a.reopen();const downloads=a.calls.filter(x=>x.path.endsWith('/snapshot')&&!x.body);expect(downloads).toHaveLength(0);
   await a.repository.retry();const state=await a.repository.readChainState();expect(state.settlements).toHaveLength(1);expect(state.settlements[0]?.creditedMinutes).toBe(5);
   const writes=a.calls.filter(x=>x.path.endsWith('/snapshot')&&x.body);expect(writes.at(-1)?.body).toEqual(writes.at(-2)?.body);
   expect((db.prepare('SELECT revision FROM business_snapshots').get() as {revision:number}).revision).toBe(2);
 });
 it('注册响应丢失后重开不持久化密码，原快照可恢复',async()=>{
   const {device}=await setup();const a=device();await a.initialize();await create(a.repository);await start(a.repository);a.advance(60000);a.drop('/register');
   await expect(a.repository.authenticate('register','alice',password,true)).rejects.toThrow();expect(JSON.stringify(await a.local.readControl())).not.toContain(password);
   a.advance(30000);await a.reopen();await expect(a.repository.retry()).rejects.toThrow('原密码');await a.repository.retry(password);
   const task=(await a.repository.readChainState()).tasks[0];expect(task&&'accumulatedMs' in task?task.accumulatedMs:0).toBe(60000);
 });
 it('登录失败保留游客，校时失败不开写，会话过期可重新登录原账户恢复未确认请求',async()=>{
   const {device,expire}=await setup();const a=device();await a.initialize();await create(a.repository);
   await expect(a.repository.authenticate('login','missing',password,false)).rejects.toThrow();expect((await a.repository.readChainState()).chains).toHaveLength(1);
   a.drop('/time');await expect(a.repository.authenticate('register','alice',password,true)).rejects.toThrow();expect(a.repository.status().writable).toBe(false);expect((await a.local.readChainState()).metadata[0]?.ownerId).not.toBe(a.repository.status().account?.id);
   await a.repository.retry(password);expect(a.repository.status().writable).toBe(true);
   expire();await expect(a.repository.setSound(false)).rejects.toThrow();expect(a.repository.status().pending).toBe('write');
   await a.repository.authenticate('login','alice',password,false);await a.repository.retry();expect((await a.repository.readHome()).settings.soundEnabled).toBe(false);
 });
 it('两设备缓存不后台下载，旧缓存用新操作覆盖较新状态',async()=>{
   const {device}=await setup();const a=device(),b=device();await a.initialize();await b.initialize();await a.repository.authenticate('register','alice',password,true);await b.repository.authenticate('login','alice',password,false);
   await create(a.repository);await b.reopen();expect((await b.repository.readChainState()).chains).toHaveLength(0);await b.repository.setSound(false);
   await a.reopen();expect((await a.repository.readChainState()).chains).toHaveLength(1);await a.repository.authenticate('login','alice',password,false);expect((await a.repository.readChainState()).chains).toHaveLength(0);
 });
 it('预约重开取原到期点，暂停与判定冻结，不自动结算或补旧提醒',async()=>{
   const {device}=await setup();const a=device();await a.initialize();await create(a.repository);await a.repository.executeTaskCommand({type:'start',taskId:'task',chainId:'chain',expectedRoundId:'chain-round',content:'阅读论文',plannedMinutes:5,reservationMinutes:5});await a.repository.authenticate('register','reserved',password,true);
   const task=(await a.repository.readChainState()).tasks[0];expect(task?.status).toBe('reserved');const due=task?.status==='reserved'?task.dueAt:0;
   a.advance(360000);await a.reopen();const recovered=(await a.repository.readChainState()).tasks[0];expect(recovered?.status).toBe('focusing');expect(recovered?.status==='focusing'?recovered.runningSince:0).toBe(due);expect((await a.repository.recoverTasks()).events).toEqual([]);expect((await a.repository.readChainState()).settlements).toHaveLength(0);
   await a.repository.executeTaskCommand({type:'interrupt',taskId:'task',decisionId:'decision',interruptionId:'interruption'});
   const frozen=(await a.repository.readChainState()).tasks[0];a.advance(10000);await a.reopen();expect((await a.repository.readChainState()).tasks[0]).toEqual(frozen);
   await a.repository.executeTaskCommand({type:'decide',taskId:'task',decisionId:'decision',input:{outcome:'allowed',source:'new',precedentId:'precedent',situation:'紧急电话'}});const paused=(await a.repository.readChainState()).tasks[0];a.advance(10000);await a.reopen();expect((await a.repository.readChainState()).tasks[0]).toEqual(paused);
 });
 it('服务器提交后本地事务失败仍保留原数据和同一待确认请求',async()=>{
   const {device,db}=await setup();const a=device();await a.initialize();await a.repository.authenticate('register','alice',password,true);
   const failed=vi.spyOn(a.local,'replaceState').mockRejectedValueOnce(new Error('QuotaExceededError'));
   await expect(create(a.repository)).rejects.toThrow();expect((await a.local.readChainState()).chains).toHaveLength(0);expect(a.repository.status().pending).toBe('write');failed.mockRestore();await a.repository.retry();expect((await a.local.readChainState()).chains).toHaveLength(1);expect((db.prepare('SELECT revision FROM business_snapshots').get() as {revision:number}).revision).toBe(2);
 });
 it('下载失败保留游客且不开启账户写入，恢复后才替换',async()=>{
   const {device,db}=await setup();const remote=device();await remote.initialize();await remote.repository.authenticate('register','alice',password,true);
   const original=(db.prepare('SELECT payload FROM business_snapshots').get() as {payload:string}).payload;db.prepare("UPDATE business_snapshots SET payload='{}'").run();
   const a=device();await a.initialize();await create(a.repository);await expect(a.repository.authenticate('login','alice',password,false)).rejects.toThrow();expect(a.repository.status().account).toBeNull();expect(a.repository.status().writable).toBe(false);expect((await a.local.readChainState()).chains).toHaveLength(1);
   db.prepare('UPDATE business_snapshots SET payload=?').run(original);await a.repository.retry(password);expect(a.repository.status().writable).toBe(true);expect((await a.repository.readChainState()).chains).toHaveLength(0);
 });
 it('账户29分59秒、唯一结算、节点余量、攀登回退与历史最高保留',async()=>{
   const {device,db}=await setup();const a=device();await a.initialize();await create(a.repository);await start(a.repository);a.advance(25*60000+59000);await a.repository.authenticate('register','alice',password,true);a.advance(4*60000);
   const first=await a.repository.executeTaskCommand({type:'finish',taskId:'task'});let state=await a.repository.readChainState();expect(state.settlements[0]?.creditedMinutes).toBe(29);expect(state.rounds[0]?.remainderMinutes).toBe(29);const revision=()=> (db.prepare('SELECT revision FROM business_snapshots').get() as {revision:number}).revision;const before=revision();expect((await a.repository.executeTaskCommand({type:'finish',taskId:'task'})).settlementId).toBe(first.settlementId);expect(revision()).toBe(before);
   await a.repository.executeTaskCommand({type:'start',taskId:'second',chainId:'chain',expectedRoundId:'chain-round',content:'继续阅读',plannedMinutes:5,reservationMinutes:null});a.advance(5*60000);await a.repository.executeTaskCommand({type:'finish',taskId:'second'});state=await a.repository.readChainState();expect(state.rounds[0]).toMatchObject({successfulMinutes:34,nodes:1,remainderMinutes:4});
   await a.repository.executeTaskCommand({type:'start',taskId:'long',chainId:'chain',expectedRoundId:'chain-round',content:'长时阅读',plannedMinutes:5,reservationMinutes:null});a.advance(600*60000);await a.repository.authenticate('login','alice',password,false);await a.repository.executeTaskCommand({type:'finish',taskId:'long'});state=await a.repository.readChainState();expect(state.rounds[0]?.nodes).toBe(21);expect(state.climbRecords[0]).toMatchObject({highestLevel:1,highestTotalNodes:21});
   await a.repository.executeChainCommand({type:'archive',chainId:'chain'});expect((await a.repository.readChainState()).rounds[0]?.nodes).toBe(21);await a.repository.executeChainCommand({type:'restore',chainId:'chain'});
   await a.repository.executeTaskCommand({type:'start',taskId:'failure',chainId:'chain',expectedRoundId:'chain-round',content:'失败阅读',plannedMinutes:5,reservationMinutes:null});await a.repository.executeTaskCommand({type:'interrupt',taskId:'failure',decisionId:'fail-decision',interruptionId:'fail-interruption'});await a.repository.executeTaskCommand({type:'decide',taskId:'failure',decisionId:'fail-decision',input:{outcome:'violation',reason:'走神'}});state=await a.repository.readChainState();expect(state.rounds[0]).toMatchObject({nodes:0,nodesBeforeFailure:21,status:'failed'});expect(state.climbRecords[0]?.highestTotalNodes).toBe(21);
   await a.repository.executeChainCommand({type:'new-round',chainId:'chain',expectedRoundId:'chain-round',roundId:'next-round',action:'戴上耳机',inheritedIds:[]});expect((await a.repository.readChainState()).settlements).toHaveLength(4);await a.repository.executeChainCommand({type:'delete',chainId:'chain'});state=await a.repository.readChainState();expect(state.chains).toHaveLength(0);expect(state.climbRecords[0]?.highestTotalNodes).toBe(21);
 });
});
