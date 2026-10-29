import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { buildApp } from '../src/app.ts';
import { emptySnapshot } from '../src/snapshot.ts';
import { openDatabase } from '../src/database.ts';

test('真实HTTP与SQLite：注册响应丢弃、幂等、覆盖、回滚、下载和校时', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'climb-http-snapshot-test-'));
  const origin = 'http://127.0.0.1:5173';
  const app = await buildApp({host:'127.0.0.1',port:3001,origin,secret:'http-test'.repeat(4),dataDir:dir,secure:false,sessionMs:60000});
  const db = openDatabase(dir);
  try {
    const base = await app.listen({host:'127.0.0.1',port:0});
    const body = {username:'http_account',password:'local-http-test-123',acknowledgeNoRecovery:true,initialData:{schemaVersion:1,operationId:'http_register_0001',clientTime:10000,snapshot:emptySnapshot()}};
    const send = (path:string,payload?:object,cookie?:string,method=payload?'POST':'GET') => fetch(base+path,{method,headers:{Origin:origin,...(payload?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(5000)});
    // Receive headers then deliberately discard the response body and cookie.
    const lostRegistration=await send('/v1/auth/register',body);assert.equal(lostRegistration.status,201);await lostRegistration.body?.cancel();
    const retried=await send('/v1/auth/register',body);assert.equal(retried.status,201);const cookie=retried.headers.get('set-cookie')!.split(';')[0],account=await retried.json();
    assert.equal((db.prepare('SELECT count(*) n FROM accounts').get() as {n:number}).n,1);
    const url=`/v1/accounts/${account.account.id}/snapshot`;
    const snapshot=emptySnapshot();snapshot.settings[0].soundEnabled=false;
    const write={schemaVersion:1,operationId:'http_snapshot_001',snapshot};
    const lostWrite=await send(url,write,cookie,'PUT');assert.equal(lostWrite.status,200);await lostWrite.body?.cancel();
    const replay=await send(url,write,cookie,'PUT');assert.equal(replay.status,200);assert.equal((await replay.json()).revision,2);
    const conflict=await send(url,{...write,snapshot:emptySnapshot()},cookie,'PUT');assert.equal(conflict.status,409);await conflict.body?.cancel();
    db.exec("CREATE TRIGGER fail_http_idem BEFORE INSERT ON idempotency_records BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
    const failure=await send(url,{...write,operationId:'http_snapshot_002',snapshot:emptySnapshot()},cookie,'PUT');assert.equal(failure.status,500);await failure.body?.cancel();
    db.exec('DROP TRIGGER fail_http_idem');
    const unchanged=await send(url,undefined,cookie);const retained=await unchanged.json();assert.equal(retained.revision,2);assert.equal(retained.snapshot.settings[0].soundEnabled,false);
    const newer=await send(url,{...write,operationId:'http_snapshot_002',snapshot:emptySnapshot()},cookie,'PUT');assert.equal((await newer.json()).revision,3);
    const old=await send(url,{...write,operationId:'http_snapshot_003'},cookie,'PUT');assert.equal((await old.json()).revision,4);
    const login=await send('/v1/auth/login',{username:body.username,password:body.password});const downloaded=await login.json();assert.equal(login.status,200);assert.equal(downloaded.snapshot.settings[0].soundEnabled,false);assert.equal(downloaded.token,undefined);assert.equal(downloaded.password_hash,undefined);
    const time=await send('/v1/time',undefined,cookie);assert.equal(time.status,200);const sample=await time.json();assert.ok(sample.serverSentAt>=sample.serverReceivedAt);assert.equal(sample.snapshot,undefined);
    const session=await send('/v1/auth/session',undefined,cookie);assert.equal(session.status,200);assert.equal((await session.json()).snapshot,undefined);
  } finally {
    db.close();await app.close();
    assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(dir.includes('climb-http-snapshot-test-'));
    rmSync(dir,{recursive:true,force:true});
  }
});
