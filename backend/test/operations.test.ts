import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {openDatabase} from '../src/database.ts';
import {backupDatabase,restoreDatabase,inspectDatabase} from '../src/maintenance.ts';
import {BoundedLog} from '../src/logging.ts';
import {buildApp} from '../src/app.ts';
import {authPressure} from '../src/auth.ts';
import {emptySnapshot} from '../src/snapshot.ts';
import Database from 'better-sqlite3';
test('顺序迁移中途失败回滚版本和前序DDL，保留原数据库',()=>{
 const root=mkdtempSync(join(tmpdir(),'climb-migration-fault-'));const first=openDatabase(root);
 first.prepare('INSERT INTO accounts VALUES (?,?,?,?)').run('old','old_user','hash',1);first.exec("DROP INDEX sessions_expiry; CREATE TRIGGER migration_fault BEFORE INSERT ON business_snapshots BEGIN SELECT RAISE(ABORT,'isolated migration failure'); END;");first.pragma('user_version = 1');first.close();
 try{assert.throws(()=>openDatabase(root),/isolated migration failure/);const check=new Database(join(root,'climb.sqlite'));try{assert.equal(check.pragma('user_version',{simple:true}),1);assert.equal((check.prepare('SELECT count(*) n FROM accounts').get() as {n:number}).n,1);assert.equal((check.prepare("SELECT count(*) n FROM sqlite_master WHERE name='sessions_expiry'").get() as {n:number}).n,0);assert.equal(check.pragma('integrity_check',{simple:true}),'ok');}finally{check.close();}}finally{rmSync(root,{recursive:true,force:true});}
});
test('WAL运行中一致性备份、完整性校验及空目录恢复，绝不覆盖现有数据',async()=>{
 const root=mkdtempSync(join(tmpdir(),'climb-ops-')),data=join(root,'data'),db=openDatabase(data);
 try{
  db.prepare('INSERT INTO accounts VALUES (?,?,?,?)').run('a','alice','hash',1);
  await backupDatabase(join(data,'climb.sqlite'),join(root,'backup.sqlite'));
  db.prepare('INSERT INTO accounts VALUES (?,?,?,?)').run('b','bob','hash',2);
  assert.equal(restoreDatabase(join(root,'backup.sqlite'),join(root,'restore')).accounts,1);
  assert.equal(inspectDatabase(join(data,'climb.sqlite')).accounts,2);
  assert.throws(()=>restoreDatabase(join(root,'backup.sqlite'),data),/empty/);
  await assert.rejects(()=>backupDatabase(join(data,'climb.sqlite'),join(root,'backup.sqlite')),/new absolute/);
 }finally{db.close();assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true});}
});
test('静态资源只提供白名单构建文件，API同源别名及私有文件不可下载',async()=>{
 const root=mkdtempSync(join(tmpdir(),'climb-static-')),web=join(root,'web');mkdirSync(web);mkdirSync(join(web,'assets'));
 writeFileSync(join(web,'index.html'),'<html>Climb</html>');writeFileSync(join(web,'assets','app.js'),'console.log("ok")');writeFileSync(join(web,'secret.sqlite'),'private');writeFileSync(join(web,'.env'),'secret');
 const app=await buildApp({host:'127.0.0.1',port:3001,origin:'http://127.0.0.1:3001',secret:'x'.repeat(32),dataDir:join(root,'data'),secure:false,sessionMs:1000,webRoot:web});
 try{
  assert.equal((await app.inject('/')).statusCode,200);assert.match((await app.inject('/assets/app.js')).headers['content-type']!,/javascript/);
  for(const path of ['/secret.sqlite','/.env','/../data/climb.sqlite','/backup.sqlite','/test-api/v1/auth/session'])assert.equal((await app.inject(path)).statusCode,404);
  assert.equal((await app.inject('/api/v1/auth/session')).statusCode,401);assert.match((await app.inject('/')).headers['content-security-policy']!,/frame-ancestors 'none'/);
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
test('密码计算最多并发2笔，超量快速拒绝；日志按体积保留固定份数',async()=>{
 const root=mkdtempSync(join(tmpdir(),'climb-pressure-test-'));
 const app=await buildApp({host:'127.0.0.1',port:3001,origin:'http://127.0.0.1:3001',secret:'x'.repeat(32),dataDir:join(root,'data'),secure:false,sessionMs:1000});
 try{
  const responses=await Promise.all(Array.from({length:6},(_,i)=>app.inject({method:'POST',url:'/v1/auth/register',headers:{origin:'http://127.0.0.1:3001'},payload:{username:`user_${i}`,password:'long-password-123',acknowledgeNoRecovery:true,initialData:{schemaVersion:1,operationId:`registration_${String(i).padStart(4,'0')}`,clientTime:1,snapshot:emptySnapshot()}}})));
  assert.equal(responses.filter(r=>r.statusCode===201).length,2);assert.equal(responses.filter(r=>r.statusCode===503&&r.json().error.code==='AUTH_BUSY').length,4);assert.ok(authPressure().peak<=2);
  const log=new BoundedLog(join(root,'logs'),80,3);for(let i=0;i<12;i++)log.write('sample-log-entry-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n');log.end();const files=readdirSync(join(root,'logs'));assert.ok(files.length<=3);assert.ok(files.every(file=>readFileSync(join(root,'logs',file),'utf8').includes('sample-log')));
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
