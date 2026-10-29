import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {buildApp} from '../src/app.ts';
import {openDatabase} from '../src/database.ts';
import {emptySnapshot,migrateGuest,validateSnapshot,type Snapshot} from '../src/snapshot.ts';
import {estimateTime,calibratedNow} from '../src/clock-protocol.ts';

const origin='http://127.0.0.1:5173';
const base={createdAt:1000,updatedAt:1000};
function active(status='focusing'):Snapshot{
 const s=emptySnapshot();s.chains=[{...base,id:'c',name:'阅读',status:'available',currentRoundId:'r',lastStartedAt:1000}];
 s.rounds=[{...base,id:'r',chainId:'c',number:1,action:'戴上耳机',status:'active',successfulMinutes:0,nodes:0,remainderMinutes:0}];
 s.tasks=[{...base,id:'t',chainId:'c',roundId:'r',content:'阅读',plannedMinutes:5,status,...(status==='reserved'?{dueAt:14000}:status==='cancel-pending'?{remainingMs:4000,pendingDecisionId:'d'}:{accumulatedMs:60000,...(status==='focusing'?{runningSince:6000}:{pauseStartedAt:6000,pendingDecisionId:'d',pendingInterruptionId:'i'})})}];
 return s;
}
async function harness(run:(h:{app:Awaited<ReturnType<typeof buildApp>>;db:ReturnType<typeof openDatabase>;register:(name?:string,snapshot?:Snapshot,operationId?:string)=>Promise<Awaited<ReturnType<Awaited<ReturnType<typeof buildApp>>['inject']>>>;now:()=>number})=>Promise<void>){
 const dir=mkdtempSync(join(tmpdir(),'climb-snapshot-test-'));let time=100000;
 const app=await buildApp({host:'127.0.0.1',port:3001,origin,secret:'test'.repeat(8),dataDir:dir,secure:false,sessionMs:100000},()=>time++);
 const db=openDatabase(dir);
 const register=(name='alice',snapshot=emptySnapshot(),operationId='registration_0001')=>app.inject({method:'POST',url:'/v1/auth/register',headers:{origin},payload:{username:name,password:'long-password-123',acknowledgeNoRecovery:true,initialData:{schemaVersion:1,operationId,clientTime:10000,snapshot}}});
 try{await run({app,db,register,now:()=>time});}finally{db.close();await app.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});}
}
const cookie=(r:{headers:Record<string,unknown>})=>String(r.headers['set-cookie']).split(';')[0];
test('幂等重放、响应丢失重试、旧副本覆盖新副本、独立记录和权限',async()=>harness(async({app,db,register})=>{
 const a=await register();assert.equal(a.statusCode,201,a.body);const id=a.json().account.id,c=cookie(a),url=`/v1/accounts/${id}/snapshot`;
 const s=emptySnapshot();s.settings[0].soundEnabled=false;
 const put=(operationId:string,snapshot=s)=>app.inject({method:'PUT',url,headers:{origin,cookie:c},payload:{schemaVersion:1,operationId,snapshot}});
 const first=await put('snapshot_operation1');assert.equal(first.statusCode,200,first.body);
 // Drop the first response from the caller's perspective; retry the exact request.
 const retry=await put('snapshot_operation1');assert.equal(retry.statusCode,200);assert.equal(retry.json().revision,first.json().revision);assert.equal(retry.json().updatedAt,first.json().updatedAt);
 assert.equal((await put('snapshot_operation1',emptySnapshot())).statusCode,409);
 const newer=await put('snapshot_operation2',emptySnapshot());assert.equal(newer.json().revision,first.json().revision+1);
 const older=await put('snapshot_operation3',s);assert.equal(older.json().revision,newer.json().revision+1);
 const read=await app.inject({url,headers:{cookie:c}});assert.equal(read.json().snapshot.settings[0].soundEnabled,false);
 assert.equal((db.prepare('SELECT count(*) n FROM idempotency_records WHERE account_id=?').get(id) as {n:number}).n,4);
 const b=await register('bob');assert.equal((await app.inject({url:`/v1/accounts/${b.json().account.id}/snapshot`,headers:{cookie:c}})).statusCode,403);
 const login=await app.inject({method:'POST',url:'/v1/auth/login',headers:{origin},payload:{username:'alice',password:'long-password-123'}});assert.equal(login.statusCode,200);assert.deepEqual(login.json().snapshot,read.json().snapshot);assert.equal(login.json().password_hash,undefined);assert.equal(login.json().token,undefined);
 const time=await app.inject({url:'/v1/time',headers:{cookie:cookie(login)}});assert.equal(time.statusCode,200);assert.ok(time.json().serverSentAt>=time.json().serverReceivedAt);assert.equal(time.json().snapshot,undefined);
}));
test('注册重复提交不覆盖后来快照；注册和快照中途错误整笔回滚',async()=>harness(async({app,db,register})=>{
 db.exec("CREATE TRIGGER fail_idempotency BEFORE INSERT ON idempotency_records BEGIN SELECT RAISE(ABORT,'test failure'); END;");
 const failed=await register();assert.equal(failed.statusCode,500);assert.equal((db.prepare('SELECT count(*) n FROM accounts').get() as {n:number}).n,0);assert.equal((db.prepare('SELECT count(*) n FROM business_snapshots').get() as {n:number}).n,0);assert.equal((db.prepare('SELECT count(*) n FROM sessions').get() as {n:number}).n,0);
 db.exec('DROP TRIGGER fail_idempotency');const a=await register('alice',active());assert.equal(a.statusCode,201,a.body);const id=a.json().account.id,c=cookie(a),url=`/v1/accounts/${id}/snapshot`;
 const retry=await register('alice',active());assert.equal(retry.statusCode,201,retry.body);assert.equal(retry.json().account.id,id);assert.deepEqual(retry.json().snapshot,a.json().snapshot);assert.equal((db.prepare('SELECT count(*) n FROM accounts').get() as {n:number}).n,1);
 assert.equal((await register('alice',emptySnapshot())).statusCode,409);
 const request={schemaVersion:1,operationId:'snapshot_rollback1',snapshot:emptySnapshot()};
 db.exec("CREATE TRIGGER fail_snapshot_idem BEFORE INSERT ON idempotency_records BEGIN SELECT RAISE(ABORT,'test failure'); END;");
 const fail=await app.inject({method:'PUT',url,headers:{origin,cookie:c},payload:request});assert.equal(fail.statusCode,500);
 const retained=await app.inject({url,headers:{cookie:c}});assert.equal(retained.json().revision,1);assert.deepEqual(retained.json().snapshot,a.json().snapshot);
 db.exec('DROP TRIGGER fail_snapshot_idem');const ok=await app.inject({method:'PUT',url,headers:{origin,cookie:c},payload:request});assert.equal(ok.statusCode,200);assert.equal(ok.json().revision,2);
 const registrationRetry=await register('alice',active());assert.equal(registrationRetry.statusCode,201);assert.equal((await app.inject({url,headers:{cookie:c}})).json().revision,2);
}));
test('结构、关联、内部累计、单任务、认证字段及限制',async()=>harness(async({app,register})=>{
 const a=await register();const c=cookie(a),url=`/v1/accounts/${a.json().account.id}/snapshot`;
 const bad:unknown[]=[];const dangling=active();dangling.rounds=[];bad.push(dangling);
 const multiple=active();multiple.tasks.push({...multiple.tasks[0],id:'t2'});bad.push(multiple);
 const ownership=active();ownership.tasks[0].accountId='other';bad.push(ownership);
 const malformed=active();malformed.rounds[0].successfulMinutes=30;bad.push(malformed);
 bad.push({...emptySnapshot(),metadata:[]});bad.push({...emptySnapshot(),sessions:[]});
 const failedActive=active();failedActive.tasks[0]={...failedActive.tasks[0],status:'failed',endedAt:10000};failedActive.settlements=[{...base,id:'s',taskId:'t',chainId:'c',roundId:'r',outcome:'failed',creditedMinutes:0}];bad.push(failedActive);
 for(const snapshot of bad){const r=await app.inject({method:'PUT',url,headers:{origin,cookie:c},payload:{schemaVersion:1,operationId:'invalid_snapshot1',snapshot}});assert.equal(r.statusCode,422,r.body);}
 assert.equal((await app.inject({method:'PUT',url,headers:{origin,cookie:c},payload:{schemaVersion:2,operationId:'invalid_snapshot1',snapshot:emptySnapshot()}})).statusCode,400);
 assert.equal((await app.inject({method:'PUT',url,headers:{origin,cookie:c,'content-type':'application/json'},payload:' '.repeat(2*1024*1024+1)})).statusCode,413);
 assert.equal((await app.inject({url})).statusCode,401);
}));
test('游客时基转换保留运行、预约到期、冻结状态，不重算历史',()=>{
 const s=active(),m=migrateGuest(s,10000,100000);assert.equal(m.tasks[0].accumulatedMs,64000);assert.equal(m.tasks[0].runningSince,100000);assert.deepEqual(s.tasks[0].accumulatedMs,60000);
 const reserved=migrateGuest(active('reserved'),10000,100000);assert.equal(reserved.tasks[0].dueAt,104000);
 const overdue=migrateGuest(active('reserved'),15000,100000);assert.equal(overdue.tasks[0].status,'focusing');assert.equal(overdue.tasks[0].accumulatedMs,1000);assert.equal(overdue.tasks[0].focusStartedAt,99000);
 const frozen=migrateGuest(active('cancel-pending'),10000,100000);assert.equal(frozen.tasks[0].remainingMs,4000);assert.equal(frozen.tasks[0].status,'cancel-pending');
 const interrupted=migrateGuest(active('interrupt-pending'),10000,100000);assert.equal(interrupted.tasks[0].accumulatedMs,60000);assert.equal(interrupted.tasks[0].pauseStartedAt,96000);
 const history=emptySnapshot();history.climbRecords=[{...base,id:'climb-history',highestLevel:2,highestTotalNodes:40}];assert.deepEqual(migrateGuest(history,10000,100000),history);
 assert.doesNotThrow(()=>validateSnapshot(reserved));
});
test('空快照与读取失败不同；登录读取失败不签发新会话',async()=>harness(async({app,db,register})=>{
 const a=await register();assert.deepEqual(a.json().snapshot,emptySnapshot());const count=()=> (db.prepare('SELECT count(*) n FROM sessions').get() as {n:number}).n;
 const before=count();db.prepare("UPDATE business_snapshots SET payload='{}'").run();
 const login=await app.inject({method:'POST',url:'/v1/auth/login',headers:{origin},payload:{username:'alice',password:'long-password-123'}});assert.equal(login.statusCode,503);assert.equal(login.json().error.code,'SNAPSHOT_UNAVAILABLE');assert.equal(count(),before);assert.equal(login.headers['set-cookie'],undefined);
}));
test('延迟估算、单调时间和无效校时样本',()=>{
 const sample={sentWall:1000,receivedWall:1100,sentMonotonic:10,receivedMonotonic:110,serverReceivedAt:6000,serverSentAt:6020};const anchor=estimateTime(sample);assert.equal(anchor.serverAtReceipt,6060);assert.equal(anchor.uncertaintyMs,40);assert.equal(calibratedNow(anchor,1110),7060);
 assert.throws(()=>estimateTime({...sample,receivedWall:9000}));assert.throws(()=>estimateTime({...sample,receivedMonotonic:20000}));assert.throws(()=>calibratedNow(anchor,0));
});
test('全量历史往返及进行中任务迁移不改变已结算记录',async()=>harness(async({app,register})=>{
 const s=active();
 s.precedents=[{...base,id:'p',chainId:'c',situation:'接紧急电话'}];
 s.roundPrecedents=[{...base,id:'r:p',roundId:'r',precedentId:'p'}];
 const completed={...base,id:'old',chainId:'c',roundId:'r',content:'阅读',plannedMinutes:5,status:'succeeded',endedAt:5000,accumulatedMs:1800000};
 s.tasks.push(completed);s.rounds[0].successfulMinutes=30;s.rounds[0].nodes=1;
 s.decisions=[{...base,id:'old-decision',taskId:'old',kind:'focus-interrupt',outcome:'allowed',precedentId:'p',reason:null}];
 s.interruptions=[{...base,id:'old-interruption',chainId:'c',taskId:'old',precedentId:'p',startedAt:2000,resumedAt:3000}];
 s.settlements=[{...base,id:'old:settlement',taskId:'old',chainId:'c',roundId:'r',outcome:'succeeded',creditedMinutes:30,effectiveMs:1800000,resultNodes:1,addedNodes:1}];
 s.taskContents=[{...base,id:'content',chainId:'c',content:'阅读',lastUsedAt:1000}];s.climbRecords=[{...base,id:'climb-history',highestLevel:0,highestTotalNodes:1}];
 s.settings[0].soundEnabled=false;
 const a=await register('history',s);assert.equal(a.statusCode,201,a.body);const result=a.json().snapshot;assert.deepEqual(result.tasks[1],completed);assert.deepEqual(result.settlements,s.settlements);assert.deepEqual(result.interruptions,s.interruptions);assert.equal(result.tasks[0].accumulatedMs,64000);
 const login=await app.inject({method:'POST',url:'/v1/auth/login',headers:{origin},payload:{username:'history',password:'long-password-123'}});assert.equal(login.statusCode,200,login.body);assert.deepEqual(login.json().snapshot,result);
 const paused=active('paused');paused.tasks[0].pendingDecisionId=null;paused.precedents=s.precedents;paused.roundPrecedents=s.roundPrecedents;paused.interruptions=[{...base,id:'i',chainId:'c',taskId:'t',precedentId:'p',startedAt:6000,resumedAt:null}];
 const migrated=migrateGuest(paused,10000,100000);assert.equal(migrated.tasks[0].accumulatedMs,60000);assert.equal(migrated.interruptions[0].startedAt,96000);
}));
test('并发注册重试仅一个账户；同操作ID改变密码冲突',async()=>harness(async({register,db,app})=>{
 const [a,b]=await Promise.all([register(),register()]);assert.equal(a.statusCode,201);assert.equal(b.statusCode,201);assert.equal(a.json().account.id,b.json().account.id);assert.equal((db.prepare('SELECT count(*) n FROM accounts').get() as {n:number}).n,1);
 const changed=await app.inject({method:'POST',url:'/v1/auth/register',headers:{origin},payload:{username:'alice',password:'changed-password-123',acknowledgeNoRecovery:true,initialData:{schemaVersion:1,operationId:'registration_0001',clientTime:10000,snapshot:emptySnapshot()}}});assert.equal(changed.statusCode,409);
}));
test('失败历史与新轮、允许取消判定保持内部一致',()=>{
 const s=active();s.tasks[0]={...s.tasks[0],status:'failed',endedAt:20000};
 s.chains[0].status='needs-round';Object.assign(s.rounds[0],{status:'failed',failedAt:20000,nodesBeforeFailure:0,failureReason:null,failureStage:'focus'});
 s.decisions=[{...base,id:'violation',taskId:'t',kind:'focus-interrupt',outcome:'violation',precedentId:null,reason:null}];s.settlements=[{...base,id:'s',taskId:'t',chainId:'c',roundId:'r',outcome:'failed',creditedMinutes:0}];
 assert.doesNotThrow(()=>validateSnapshot(s));
 const next=structuredClone(s);next.chains[0].status='available';next.chains[0].currentRoundId='r2';next.rounds.push({...base,id:'r2',chainId:'c',number:2,action:'阅读',status:'active',successfulMinutes:0,nodes:0,remainderMinutes:0});assert.doesNotThrow(()=>validateSnapshot(next));
 const broken=structuredClone(s);broken.decisions=[];assert.throws(()=>validateSnapshot(broken));
 const cancelled=active('cancel-pending');cancelled.tasks[0]={...cancelled.tasks[0],status:'cancelled',endedAt:20000,accumulatedMs:0,pendingDecisionId:null};cancelled.precedents=[{...base,id:'p',chainId:'c',situation:'临时急事'}];cancelled.roundPrecedents=[{...base,id:'l',roundId:'r',precedentId:'p'}];cancelled.decisions=[{...base,id:'d',taskId:'t',kind:'reservation-cancel',outcome:'allowed',precedentId:'p',reason:null}];cancelled.settlements=[{...base,id:'s',taskId:'t',chainId:'c',roundId:'r',outcome:'cancelled',creditedMinutes:0}];assert.doesNotThrow(()=>validateSnapshot(cancelled));
});
