import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.ts';
import { openDatabase } from '../src/database.ts';
import { config } from '../src/config.ts';
import { fileURLToPath } from 'node:url';
import {emptySnapshot} from '../src/snapshot.ts';
const origin = 'http://127.0.0.1:5173';
const payload = { username: 'Alice_1', password: 'long password 123!', acknowledgeNoRecovery: true,initialData:{schemaVersion:1,operationId:'registration_0001',clientTime:100000,snapshot:emptySnapshot()} };
test('认证、隔离、过期、退出、输入和来源保护', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'climb-auth-test-')); let time = 100000;
  const app = await buildApp({host:'127.0.0.1',port:3001,origin,secret:'x'.repeat(32),dataDir:dir,secure:false,sessionMs:1000}, () => time);
  const post = (path:string, body:unknown = payload, cookie = '') => {const data={...body as object} as Record<string,unknown>;if(path==='login')delete data.initialData;return app.inject({method:'POST',url:`/v1/auth/${path}`,headers:{origin,cookie},payload:data});};
  try {
    const registered = await post('register'); assert.equal(registered.statusCode,201);
    const cookie = registered.headers['set-cookie']!.toString().split(';')[0];
    assert.match(registered.headers['set-cookie']!.toString(), /HttpOnly/); assert.match(registered.headers['set-cookie']!.toString(), /SameSite=Strict/);
    assert.equal((await post('register', {...payload,username:'alice_1',initialData:{...payload.initialData,operationId:'other_register_01'}})).statusCode,409);
    assert.equal((await post('login', {...payload,password:'wrong password 123'})).statusCode,401);
    assert.equal((await post('login', {...payload,username:'unknown'})).statusCode,401);
    assert.equal((await app.inject({url:'/v1/auth/session',headers:{cookie}})).statusCode,200);
    assert.equal((await app.inject({url:'/v1/accounts/other/snapshot',headers:{cookie}})).statusCode,403);
    assert.equal((await app.inject({url:`/v1/accounts/${registered.json().account.id}/snapshot`,headers:{cookie}})).statusCode,200);
    time += 1001; assert.equal((await app.inject({url:'/v1/auth/session',headers:{cookie}})).statusCode,401);
    const login = await post('login'); assert.equal(login.statusCode,200);
    const fresh = login.headers['set-cookie']!.toString().split(';')[0];
    assert.equal((await post('logout',{},fresh)).statusCode,200);
    assert.equal((await app.inject({url:'/v1/auth/session',headers:{cookie:fresh}})).statusCode,401);
    assert.equal((await app.inject({method:'POST',url:'/v1/auth/login',payload})).statusCode,403);
    assert.equal((await post('register',{...payload,username:'bob',acknowledgeNoRecovery:false})).statusCode,400);
    assert.equal((await post('register',{...payload,guestSnapshot:{}})).statusCode,400);
  } finally { await app.close(); rmSync(dir,{recursive:true,force:true}); }
});
test('顺序迁移重开、事务回滚、数据库隔离和新版本保护', () => {
  const dirs = [mkdtempSync(join(tmpdir(),'climb-db-test-')),mkdtempSync(join(tmpdir(),'climb-db-test-'))];
  const first = openDatabase(dirs[0]); const second = openDatabase(dirs[1]);
  try {
    first.prepare('INSERT INTO accounts VALUES (?,?,?,?)').run('a','alice','hash',1);
    assert.throws(() => first.transaction(() => { first.prepare('INSERT INTO accounts VALUES (?,?,?,?)').run('b','bob','hash',1); first.prepare('INSERT INTO accounts VALUES (?,?,?,?)').run('c','alice','hash',1); })());
    assert.equal((first.prepare('SELECT count(*) n FROM accounts').get() as {n:number}).n,1);
    assert.equal((second.prepare('SELECT count(*) n FROM accounts').get() as {n:number}).n,0);
    first.pragma('user_version = 1'); first.exec('DROP INDEX sessions_expiry'); first.close();
    const reopened = openDatabase(dirs[0]); assert.equal(reopened.pragma('user_version',{simple:true}),3); assert.equal((reopened.prepare('SELECT username FROM accounts').get() as {username:string}).username,'alice');
    reopened.pragma('user_version = 99'); reopened.close(); assert.throws(() => openDatabase(dirs[0]),/newer/);
  } finally { if(first.open) first.close(); second.close(); for(const dir of dirs) rmSync(dir,{recursive:true,force:true}); }
});
test('认证限流', async () => {
  const dir = mkdtempSync(join(tmpdir(),'climb-limit-test-'));
  const app = await buildApp({host:'127.0.0.1',port:3001,origin,secret:'x'.repeat(32),dataDir:dir,secure:true,sessionMs:1000});
  try { for(let i=0;i<10;i++) await app.inject({method:'POST',url:'/v1/auth/login',headers:{origin},payload:{}}); assert.equal((await app.inject({method:'POST',url:'/v1/auth/login',headers:{origin},payload:{}})).statusCode,429); }
  finally { await app.close(); rmSync(dir,{recursive:true,force:true}); }
});
test('环境配置拒绝缺失密钥、公开目录和不安全生产配置', () => {
  assert.throws(() => config({DATA_DIR:tmpdir()}),/SECRET/);
  assert.throws(() => config({SESSION_SECRET:'x'.repeat(32),DATA_DIR:join(process.cwd(),'public')}),/outside/);
  assert.throws(() => config({SESSION_SECRET:'x'.repeat(32),DATA_DIR:tmpdir(),NODE_ENV:'production'}),/HTTPS/);
});
test('目录迁移后从其他工作目录调用仍拒绝整个项目内的数据目录', () => {
  const previous = process.cwd();
  const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
  try {
    process.chdir(tmpdir());
    for (const folder of ['', 'demo', 'docs', 'outputs', '..private']) {
      assert.throws(() => config({SESSION_SECRET:'x'.repeat(32),DATA_DIR:join(projectRoot,folder)}),/outside/);
    }
    assert.equal(config({SESSION_SECRET:'x'.repeat(32),DATA_DIR:tmpdir()}).dataDir,tmpdir());
  } finally { process.chdir(previous); }
});
test('第二账户真实隔离、服务重开会话保留、密钥轮换失效', async () => {
  const dir = mkdtempSync(join(tmpdir(),'climb-restart-test-'));
  const settings = {host:'127.0.0.1',port:3001,origin,secret:'x'.repeat(32),dataDir:dir,secure:true,sessionMs:10000};
  let app = await buildApp(settings);
  try {
    const register = (username:string) => app.inject({method:'POST',url:'/v1/auth/register',headers:{origin},payload:{...payload,username}});
    const alice = await register('alice'); const bob = await register('bob');
    const cookie = alice.headers['set-cookie']!.toString().split(';')[0];
    assert.match(alice.headers['set-cookie']!.toString(),/Secure/);
    assert.equal((await app.inject({url:`/v1/accounts/${bob.json().account.id}/snapshot`,headers:{cookie}})).statusCode,403);
    await app.close(); app = await buildApp(settings);
    assert.equal((await app.inject({url:'/v1/auth/session',headers:{cookie}})).statusCode,200);
    await app.close(); app = await buildApp({...settings,secret:'y'.repeat(32)});
    assert.equal((await app.inject({url:'/v1/auth/session',headers:{cookie}})).statusCode,401);
  } finally { await app.close(); rmSync(dir,{recursive:true,force:true}); }
});
test('测试环境Cookie不读取或覆盖普通环境会话', async () => {
  const dir = mkdtempSync(join(tmpdir(),'climb-cookie-test-'));
  const app = await buildApp({host:'127.0.0.1',port:3002,origin,secret:'x'.repeat(32),dataDir:dir,secure:false,sessionMs:10000,cookieName:'climb_test_session'});
  try {
    const registered = await app.inject({method:'POST',url:'/v1/auth/register',headers:{origin,cookie:'session=ordinary_session_sentinel'},payload});
    assert.equal(registered.statusCode,201);assert.match(String(registered.headers['set-cookie']),/^climb_test_session=/);
    const cookie = String(registered.headers['set-cookie']).split(';')[0];
    assert.equal((await app.inject({url:'/v1/auth/session',headers:{cookie}})).statusCode,200);
    assert.equal((await app.inject({url:'/v1/auth/session',headers:{cookie:cookie.replace('climb_test_session=','session=')}})).statusCode,401);
    const logout=await app.inject({method:'POST',url:'/v1/auth/logout',headers:{origin,cookie},payload:{}});assert.match(String(logout.headers['set-cookie']),/^climb_test_session=/);
  } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});
