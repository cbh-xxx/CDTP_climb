import { createHash } from 'node:crypto';
import { ApiError } from './errors.ts';
import type { Db } from './database.ts';

type Scalar = string | number | boolean | null;
export type Row = Record<string, Scalar>;
export const stores = ['chains','rounds','tasks','decisions','precedents','roundPrecedents','interruptions','settlements','taskContents','climbRecords','settings'] as const;
export type Store = typeof stores[number];
export type Snapshot = Record<Store, Row[]>;
export const emptySnapshot = (): Snapshot => ({chains:[],rounds:[],tasks:[],decisions:[],precedents:[],roundPrecedents:[],interruptions:[],settlements:[],taskContents:[],climbRecords:[],settings:[{id:'preferences',createdAt:0,updatedAt:0,soundEnabled:true}]});
const fail = (message: string): never => { throw new ApiError(422,'INVALID_SNAPSHOT',message); };
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_:.\-]{1,200}$/.test(v);
const segmenter=new Intl.Segmenter('zh',{granularity:'grapheme'});
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim() === v && v.length > 0 && [...segmenter.segment(v)].length <= max && !/[\r\n\u0000-\u001f]/.test(v);
type Rule = (v: unknown) => boolean;
const enums = (...values: string[]): Rule => v => values.includes(v as string);
const nullable = (rule: Rule): Rule => v => v === null || rule(v);
const bool: Rule = v => typeof v === 'boolean';
const common = {id,createdAt:integer,updatedAt:integer};
const taskBase = {chainId:id,roundId:id,content:(v:unknown)=>text(v,15),plannedMinutes:(v:unknown)=>integer(v)&&v>=5&&v<=1435&&v%5===0,status:enums('reserved','cancel-pending','focusing','interrupt-pending','paused','succeeded','failed','cancelled')};
const optional: Partial<Record<Store,Record<string,Rule>>> = {
 chains:{archivedAt:nullable(integer)}, rounds:{failedAt:nullable(integer),nodesBeforeFailure:nullable(integer),failureReason:nullable(v=>text(v,15)),failureStage:nullable(enums('reservation','focus'))},
 tasks:{focusStartedAt:nullable(integer),pauseStartedAt:nullable(integer),pendingDecisionId:nullable(id),pendingInterruptionId:nullable(id),dueNotified:bool,goalNotified:bool,dueAt:integer,remainingMs:integer,accumulatedMs:integer,runningSince:integer,endedAt:integer},
 settlements:{effectiveMs:integer,resultNodes:integer,addedNodes:integer}
};
const required: Record<Store,Record<string,Rule>> = {
 chains:{name:v=>text(v,15),status:enums('available','archived','needs-round'),currentRoundId:id,lastStartedAt:nullable(integer)},
 rounds:{chainId:id,number:v=>integer(v)&&v>0,action:v=>text(v,10),status:enums('active','failed'),successfulMinutes:integer,nodes:integer,remainderMinutes:v=>integer(v)&&v<30},
 tasks:taskBase,
 decisions:{taskId:id,kind:enums('reservation-cancel','focus-interrupt'),outcome:enums('allowed','violation'),precedentId:nullable(id),reason:nullable(v=>text(v,15))},
 precedents:{chainId:id,situation:v=>text(v,15)},roundPrecedents:{roundId:id,precedentId:id},
 interruptions:{chainId:id,taskId:id,precedentId:id,startedAt:integer,resumedAt:nullable(integer)},
 settlements:{taskId:id,chainId:id,roundId:id,outcome:enums('succeeded','failed','cancelled'),creditedMinutes:integer},
 taskContents:{chainId:id,content:v=>text(v,15),lastUsedAt:integer},
 climbRecords:{highestLevel:v=>integer(v)&&v<=30,highestTotalNodes:integer},settings:{soundEnabled:bool}
};
export function validateSnapshot(input: unknown): Snapshot {
 if (!input || typeof input!=='object' || Array.isArray(input)) fail('快照须为对象');
 const s=input as Snapshot;
 if(Object.keys(s).length!==stores.length||Object.keys(s).some(k=>!stores.includes(k as Store))) fail('快照集合不完整或包含禁止字段');
 const maps = {} as Record<Store, Map<Scalar,Row>>;
 let count=0;
 for(const store of stores){
   if(!Array.isArray(s[store])) fail('集合须为数组');
   count+=s[store].length;if(count>20000)fail('快照最多20000条记录');
   maps[store]=new Map();
   for(const row of s[store]){
     if(!row||typeof row!=='object'||Array.isArray(row))fail('记录须为对象');
     const rules={...common,...required[store]}; const allowed={...rules,...optional[store]};
     if(Object.keys(row).some(k=>!Object.hasOwn(allowed,k)))fail('记录含未知或禁止字段');
     for(const [key,rule] of Object.entries(rules))if(!rule(row[key]))fail(`${store}.${key}无效`);
     for(const [key,rule] of Object.entries(optional[store]??{}))if(Object.hasOwn(row,key)&&!rule(row[key]))fail(`${store}.${key}无效`);
     if(maps[store].has(row.id))fail('集合内ID重复');maps[store].set(row.id,row);
   }
 }
 const ref=(store:Store,key:Scalar|undefined):Row=>maps[store].get(key??null)??fail(`${store}关联缺失`);
 const settlementByTask=new Map(s.settlements.map(x=>[x.taskId,x]));
 const minutesByRound=new Map<Scalar,number>();
 for(const x of s.settlements)minutesByRound.set(x.roundId,(minutesByRound.get(x.roundId)??0)+(x.creditedMinutes as number));
 const linkedPrecedents=new Set(s.roundPrecedents.map(x=>JSON.stringify([x.roundId,x.precedentId])));
 const roundsByChain=new Map<Scalar,Row[]>();
 for(const r of s.rounds){const group=roundsByChain.get(r.chainId)??[];group.push(r);roundsByChain.set(r.chainId,group);}
 const unique=(rows:Row[],key:(r:Row)=>string)=>{const keys=rows.map(key);if(new Set(keys).size!==keys.length)fail('业务唯一键重复');};
 unique(s.chains,r=>String(r.name));unique(s.rounds,r=>JSON.stringify([r.chainId,r.number]));unique(s.roundPrecedents,r=>JSON.stringify([r.roundId,r.precedentId]));unique(s.taskContents,r=>JSON.stringify([r.chainId,r.content]));unique(s.settlements,r=>String(r.taskId));
 if(s.settings.length!==1||s.settings[0].id!=='preferences'||s.climbRecords.length>1||(s.climbRecords[0]&&s.climbRecords[0].id!=='climb-history'))fail('设置或攀登纪录单例无效');
 for(const c of s.chains){const r=ref('rounds',c.currentRoundId);if(r.chainId!==c.id||((c.status==='needs-round')!==(r.status==='failed')))fail('当前轮状态不一致');const group=(roundsByChain.get(c.id)??[]).sort((a,b)=>(a.number as number)-(b.number as number));if(group.some((x,i)=>x.number!==i+1||(x.id!==r.id&&x.status!=='failed'))||group.at(-1)?.id!==r.id)fail('轮次顺序或历史状态无效');}
 for(const r of s.rounds){ref('chains',r.chainId);if(r.successfulMinutes!==(r.nodes as number)*30+(r.remainderMinutes as number))fail('轮累计不一致');if(r.status==='failed'&&(r.successfulMinutes!==0||!integer(r.failedAt)))fail('失败轮状态无效');}
 const ended=new Set(['succeeded','failed','cancelled']);let active=0;
 for(const t of s.tasks){
   const c=ref('chains',t.chainId),r=ref('rounds',t.roundId);if(r.chainId!==c.id)fail('任务跨链关联');
   if(!ended.has(String(t.status))){active++;if(c.status!=='available'||c.currentRoundId!==r.id||r.status!=='active')fail('未完成任务所在轮不可用');}
   const needs=t.status==='reserved'?['dueAt']:t.status==='cancel-pending'?['remainingMs','pendingDecisionId']:t.status==='focusing'?['accumulatedMs','runningSince']:['accumulatedMs'];
   for(const k of needs)if(!Object.hasOwn(t,k)||t[k]===null)fail('任务状态字段缺失');
   if(t.status==='interrupt-pending'&&(!id(t.pendingDecisionId)||!id(t.pendingInterruptionId)||!integer(t.pauseStartedAt)))fail('中断待判定字段缺失');
   if(t.status==='paused'&&(!id(t.pendingInterruptionId)||!integer(t.pauseStartedAt)))fail('暂停任务字段缺失');
   if(['cancel-pending','interrupt-pending'].includes(String(t.status))&&maps.decisions.has(t.pendingDecisionId))fail('待判定ID已经使用');
   if(t.status==='paused'&&t.pendingInterruptionId){const i=ref('interruptions',t.pendingInterruptionId);if(i.taskId!==t.id||i.resumedAt!==null)fail('暂停关联无效');}
   const settlement=settlementByTask.get(t.id);
   if(ended.has(String(t.status))){if(!integer(t.endedAt)||!settlement||settlement.outcome!==t.status)fail('结束任务必须有唯一匹配结算');}else if(settlement)fail('未完成任务已经结算');
 }
 if(active>1)fail('单份快照只能有一个未完成任务');
 for(const p of s.precedents)ref('chains',p.chainId);
 for(const l of s.roundPrecedents)if(ref('rounds',l.roundId).chainId!==ref('precedents',l.precedentId).chainId)fail('轮判例跨链');
 unique(s.roundPrecedents,l=>JSON.stringify([l.roundId,ref('precedents',l.precedentId).situation]));
 for(const d of s.decisions){const t=ref('tasks',d.taskId);if(d.outcome==='allowed'){if(ref('precedents',d.precedentId).chainId!==t.chainId||!linkedPrecedents.has(JSON.stringify([t.roundId,d.precedentId])))fail('判定判例不属于任务轮');}else if(d.precedentId!==null)fail('违规判定不应关联允许判例');}
 const failureByRound=new Map<Scalar,Row>();
 for(const t of s.tasks){
   const decisions=s.decisions.filter(d=>d.taskId===t.id);
   if(t.status==='failed'){
     const r=ref('rounds',t.roundId),violations=decisions.filter(d=>d.outcome==='violation');
     if(r.status!=='failed'||failureByRound.has(r.id)||violations.length!==1||r.failedAt!==t.endedAt)fail('失败任务与失败轮不一致');
     failureByRound.set(r.id,t);
   }else if(decisions.some(d=>d.outcome==='violation'))fail('非失败任务包含违规结果');
   if(t.status==='cancelled'&&!decisions.some(d=>d.kind==='reservation-cancel'&&d.outcome==='allowed'))fail('允许取消缺少判定');
   if(decisions.some(d=>d.kind==='reservation-cancel'&&d.outcome==='allowed')&&t.status!=='cancelled')fail('取消判定与任务终态不符');
 }
 for(const r of s.rounds)if(r.status==='failed'&&!failureByRound.has(r.id))fail('失败轮缺少失败任务');
 for(const i of s.interruptions){const t=ref('tasks',i.taskId);if(t.chainId!==i.chainId||ref('precedents',i.precedentId).chainId!==i.chainId||(i.resumedAt!==null&&(i.resumedAt as number)<(i.startedAt as number)))fail('中断关联或时间无效');}
 for(const i of s.interruptions)if(i.resumedAt===null){const t=ref('tasks',i.taskId);if(t.status!=='paused'||t.pendingInterruptionId!==i.id)fail('未结束中断缺少对应暂停任务');}
 for(const x of s.settlements){const t=ref('tasks',x.taskId);if(t.chainId!==x.chainId||t.roundId!==x.roundId||t.status!==x.outcome)fail('结算关联无效');if(x.outcome==='succeeded'){if(x.creditedMinutes!==Math.floor((t.accumulatedMs as number)/60000)||x.creditedMinutes<(t.plannedMinutes as number))fail('成功计入分钟不一致');}else if(x.creditedMinutes!==0)fail('非成功不得计入');if(x.effectiveMs!==undefined&&x.effectiveMs!==t.accumulatedMs)fail('有效时长不一致');}
 for(const r of s.rounds)if(r.status==='active'&&(minutesByRound.get(r.id)??0)!==r.successfulMinutes)fail('成功记录与轮累计不一致');
 for(const x of s.taskContents)ref('chains',x.chainId);
 const total=s.chains.reduce((n,c)=>n+(ref('rounds',c.currentRoundId).nodes as number),0),history=s.climbRecords[0];
 if(total>0&&!history)fail('攀登纪录缺失');
 if(history&&((history.highestTotalNodes as number)<total||history.highestLevel!==Math.min(30,Math.floor((history.highestTotalNodes as number)/20))))fail('单份快照攀登纪录不一致');
 return s;
}
export interface WriteRequest {schemaVersion:1;operationId:string;snapshot:Snapshot;clientTime?:number}
export function writeRequest(input:unknown,guest=false):WriteRequest {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'INVALID_REQUEST','缺少快照请求');
 const r=input as WriteRequest;
 if(r.schemaVersion!==1)throw new ApiError(400,'UNSUPPORTED_SCHEMA','只支持schemaVersion=1');
 if(typeof r.operationId!=='string'||! /^[A-Za-z0-9_-]{16,100}$/.test(r.operationId)||Object.keys(r).some(k=>!['schemaVersion','operationId','snapshot',...(guest?['clientTime']:[])].includes(k)))throw new ApiError(400,'INVALID_REQUEST','操作ID或请求字段无效');
 if(guest&&!integer(r.clientTime))throw new ApiError(400,'INVALID_REQUEST','游客迁移须提供捕获时的clientTime');
 validateSnapshot(r.snapshot);return r;
}
export function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
 return JSON.stringify(value);
}
export const requestHash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export function migrateGuest(snapshot:Snapshot,clientTime:number,serverTime:number):Snapshot {
 const s=structuredClone(snapshot),delta=serverTime-clientTime;
 for(const t of s.tasks){
   if(['succeeded','failed','cancelled'].includes(String(t.status)))continue;
   if(t.status==='reserved'){const remaining=(t.dueAt as number)-clientTime;if(remaining>=0)t.dueAt=serverTime+remaining;else {t.status='focusing';t.accumulatedMs=-remaining;t.runningSince=serverTime;t.focusStartedAt=t.dueAt;delete t.dueAt;}}
   else if(t.status==='focusing'){t.accumulatedMs=(t.accumulatedMs as number)+Math.max(0,clientTime-(t.runningSince as number));t.runningSince=serverTime;}
   for(const k of ['focusStartedAt','pauseStartedAt'])if(typeof t[k]==='number')t[k]=Math.max(0,(t[k] as number)+delta);
   for(const i of s.interruptions)if(i.taskId===t.id&&i.resumedAt===null)i.startedAt=Math.max(0,(i.startedAt as number)+delta);
 }
 validateSnapshot(s);return s;
}
export function snapshotService(db:Db,now:()=>number){
 function read(accountId:string){
   const row=db.prepare('SELECT schema_version AS schemaVersion,revision,payload,updated_at AS updatedAt FROM business_snapshots WHERE account_id=?').get(accountId) as {schemaVersion:number;revision:number;payload:string;updatedAt:number}|undefined;
   if(!row)throw new ApiError(503,'SNAPSHOT_UNAVAILABLE','快照不可用，请保留本机数据并重试');
   try{if(row.schemaVersion!==1)throw Error();const snapshot=validateSnapshot(JSON.parse(row.payload));return {schemaVersion:1,revision:row.revision,updatedAt:row.updatedAt,snapshot};}catch{throw new ApiError(503,'SNAPSHOT_UNAVAILABLE','快照读取失败，请保留本机数据');}
 }
 function replay(accountId:string,operationId:string,hash:string){const row=db.prepare('SELECT request_hash,response_json FROM idempotency_records WHERE account_id=? AND operation_id=?').get(accountId,operationId) as {request_hash:string;response_json:string}|undefined;if(!row)return null;if(row.request_hash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','操作ID已用于其他内容');return JSON.parse(row.response_json) as {schemaVersion:number;revision:number;updatedAt:number;snapshot?:Snapshot};}
 function commit(accountId:string,request:WriteRequest,hash:string,registration=false){
   const old=replay(accountId,request.operationId,hash);if(old)return old;
   const at=now(),snapshot=registration?migrateGuest(request.snapshot,request.clientTime!,at):request.snapshot;
   db.prepare('INSERT INTO business_snapshots VALUES (?,1,1,?,?) ON CONFLICT(account_id) DO UPDATE SET payload=excluded.payload,revision=revision+1,updated_at=excluded.updated_at').run(accountId,canonical(snapshot),at);
   const row=read(accountId);const result={schemaVersion:1,revision:row.revision,updatedAt:at,...(registration?{snapshot}:{} )};
   db.prepare('INSERT INTO idempotency_records VALUES (?,?,?,?,?)').run(accountId,request.operationId,hash,canonical(result),at);return result;
 }
 return {read,replay,commit,write(accountId:string,request:WriteRequest){return db.transaction(()=>commit(accountId,request,requestHash(request)))();}};
}
