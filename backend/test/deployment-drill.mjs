import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,readdirSync,readFileSync,writeFileSync,statSync,existsSync,cpSync} from 'node:fs';
import {tmpdir,cpus,totalmem} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {request,Agent} from 'node:https';
import assert from 'node:assert/strict';
const release=resolve(process.argv[2]??'../../outputs/deploy/climb-20261029-stage4-release');
const root=mkdtempSync(join(tmpdir(),'climb-deployment-drill-'));
const origin='https://127.0.0.1:31443',secret=randomBytes(32).toString('hex'),password='Isolated-pressure-password-123';
const metrics={};let child,exitPromise,workerMetrics,affinity=false,taskName,wrapper,wrapperExit;
const agent=new Agent({keepAlive:true,maxSockets:16,rejectUnauthorized:false});
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)];
const summary=values=>({count:values.length,medianMs:percentile(values,.5),p95Ms:percentile(values,.95),maxMs:Math.max(...values)});
function call(path,body,cookie,method=body?'POST':'GET'){
 const text=body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),start=performance.now();
 return new Promise((resolve,reject)=>{const req=request(origin+path,{method,agent,headers:{Origin:origin,...(text?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(text)}:{}),...(cookie?{Cookie:cookie}:{})}},response=>{let data='';response.setEncoding('utf8');response.on('data',chunk=>data+=chunk);response.on('end',()=>{let value;try{value=JSON.parse(data);}catch{value=data;}resolve({status:response.statusCode,body:value,headers:response.headers,ms:performance.now()-start});});});req.on('error',reject);req.setTimeout(20000,()=>req.destroy(Error('HTTP timeout')));if(text)req.write(text);req.end();});
}
async function start(data){
 child=spawn(process.execPath,['--max-old-space-size=256',fileURLToPath(new URL('./pressure-worker.mjs',import.meta.url))],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,DRILL_RELEASE:release,HOST:'127.0.0.1',PORT:'31443',APP_ORIGIN:origin,SESSION_SECRET:secret,DATA_DIR:data,WEB_ROOT:join(release,'web'),LOG_DIR:join(root,'logs'),TLS_KEY_FILE:join(root,'key.pem'),TLS_CERT_FILE:join(root,'cert.pem'),NODE_ENV:'production',COOKIE_SECURE:'true'}});
 exitPromise=new Promise(resolve=>child.once('exit',resolve));
 const ready=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Worker startup timeout')),15000);child.on('message',message=>{if(message.type==='ready'){clearTimeout(timeout);resolve();}if(message.type==='metrics')workerMetrics=message;});child.once('exit',()=>{clearTimeout(timeout);reject(Error('Worker exited before startup'));});});
 child.stderr.on('data',buffer=>process.stderr.write(buffer));
 try{execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',`(Get-Process -Id ${child.pid}).ProcessorAffinity = [IntPtr]3`],{windowsHide:true,stdio:'ignore'});affinity=true;}catch{affinity=false;}
 await ready;
}
async function stop(){if(!child||child.exitCode!==null||child.signalCode!==null)return;child.send('stop');const timeout=setTimeout(()=>child.kill(),5000);await exitPromise;clearTimeout(timeout);}
async function stopWrapper(){if(!wrapper||wrapper.exitCode!==null||wrapper.signalCode!==null)return;execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${wrapper.pid} -and $_.Name -eq 'node.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }`],{windowsHide:true,stdio:'ignore'});const timeout=setTimeout(()=>wrapper.kill(),5000);await wrapperExit;clearTimeout(timeout);}
try{
 const openssl=process.env.DRILL_OPENSSL??'C:/Program Files/Git/usr/bin/openssl.exe';
 execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{windowsHide:true,stdio:'ignore'});
 await start(join(root,'data'));
 const site=await call('/');assert.equal(site.status,200);assert.ok(String(site.headers['content-security-policy']).includes("connect-src 'self'"));
 const script=site.body.match(/src="([^"]+\.js)"/)[1];assert.equal((await call(script)).status,200);
 for(const path of ['/climb.sqlite','/data/climb.sqlite','/.env','/backend/package.json','/test-api/v1/auth/session'])assert.equal((await call(path)).status,404);
 const {emptySnapshot}=await import(pathToFileURL(join(release,'backend/dist/snapshot.js')));
 const auth=await Promise.all(Array.from({length:8},(_,i)=>call('/api/v1/auth/register',{username:`load_${i}`,password,acknowledgeNoRecovery:true,initialData:{schemaVersion:1,operationId:`register_load_${i.toString().padStart(3,'0')}`,clientTime:Date.now(),snapshot:emptySnapshot()}})));
 assert.equal(auth.filter(x=>x.status===201).length,2);assert.equal(auth.filter(x=>x.status===503).length,6);metrics.auth={...summary(auth.map(x=>x.ms)),accepted:2,rejectedBusy:6};
 const registered=auth.find(x=>x.status===201),cookie=registered.headers['set-cookie'][0].split(';')[0];assert.ok(registered.headers['set-cookie'][0].includes('Secure'));
 const url=`/api/v1/accounts/${registered.body.account.id}/snapshot`,latencies=[];
 for(let batch=0;batch<10;batch++){
   const group=await Promise.all(Array.from({length:4},(_,i)=>call(url,{schemaVersion:1,operationId:`small_${batch}_${i}_operation`,snapshot:emptySnapshot()},cookie,'PUT')));
   for(const result of group){assert.equal(result.status,200);latencies.push(result.ms);}
 }
 metrics.smallWrites=summary(latencies);
 const large=emptySnapshot(),at=Date.now();large.chains=[{id:'c',createdAt:at,updatedAt:at,name:'压力测试',status:'available',currentRoundId:'r',lastStartedAt:null}];large.rounds=[{id:'r',createdAt:at,updatedAt:at,chainId:'c',number:1,action:'戴上耳机',status:'active',successfulMinutes:0,nodes:0,remainderMinutes:0}];
 large.taskContents=Array.from({length:6000},(_,i)=>({id:'content_'+('x'.repeat(110))+i,createdAt:at,updatedAt:at,chainId:'c',content:`内容${i}`,lastUsedAt:at}));
 metrics.largePayloadBytes=Buffer.byteLength(JSON.stringify({schemaVersion:1,operationId:'large_000_operation',snapshot:large}));assert.ok(metrics.largePayloadBytes<2*1024*1024);
 const heavy=[];for(let batch=0;batch<3;batch++){const group=await Promise.all([0,1].map(i=>call(url,{schemaVersion:1,operationId:`large_${batch}_${i}_operation`,snapshot:large},cookie,'PUT')));for(const result of group){assert.equal(result.status,200,JSON.stringify(result.body));heavy.push(result.ms);}}
 metrics.largeWrites=summary(heavy);
 assert.equal((await call(url,' '.repeat(2*1024*1024+1),cookie,'PUT')).status,413);
 const {backupDatabase,restoreDatabase,inspectDatabase}=await import(pathToFileURL(join(release,'backend/dist/maintenance.js')));
 const backup=join(root,'backups','snapshot.sqlite');await backupDatabase(join(root,'data','climb.sqlite'),backup);assert.equal(inspectDatabase(backup).accounts,2);
 metrics.walBytes=existsSync(join(root,'data','climb.sqlite-wal'))?statSync(join(root,'data','climb.sqlite-wal')).size:0;
 await stop();metrics.worker=workerMetrics;
 restoreDatabase(backup,join(root,'restored'));await start(join(root,'restored'));
 const login=await call('/api/v1/auth/login',{username:registered.body.account.username,password});assert.equal(login.status,200);assert.equal(login.body.revision,47);assert.equal(login.body.snapshot.taskContents.length,6000);
 const web=fileURLToPath(new URL('../../web/',import.meta.url));
 const browser=spawn(process.execPath,[join(web,'node_modules/@playwright/test/cli.js'),'test','--config','playwright.deploy.config.ts'],{cwd:web,windowsHide:true,stdio:'inherit',env:{...process.env,ISOLATED_DEPLOY_DRILL:'true',DEPLOY_ARTIFACTS:join(root,'browser-artifacts')}});
 assert.equal(await new Promise((resolve,reject)=>{browser.once('exit',resolve);browser.once('error',reject);}),0,'Production Chrome/Edge flows must pass');
 await stop();
 const logFiles=readdirSync(join(root,'logs'));const log=logFiles.map(name=>readFileSync(join(root,'logs',name),'utf8')).join('');for(const sensitive of [password,secret,cookie])assert.ok(!log.includes(sensitive));metrics.logsBytes=Buffer.byteLength(log);metrics.backupBytes=statSync(backup).size;
 // Exercise the shipped Windows wrapper and a temporary LOCAL SERVICE startup task.
 const program=join(root,'program'),copiedRelease=join(program,'release');mkdirSync(program,{recursive:true});cpSync(release,copiedRelease,{recursive:true});
 const node=join(program,'node.exe');cpSync(process.execPath,node);const configDir=join(root,'config');mkdirSync(configDir);
 const envFile=join(configDir,'runtime.env'),control=join(configDir,'current.json');
 writeFileSync(envFile,`HOST=127.0.0.1\nPORT=31443\nAPP_ORIGIN=${origin}\nSESSION_SECRET=${secret}\nDATA_DIR=${join(root,'restored')}\nLOG_DIR=${join(root,'logs')}\nTLS_KEY_FILE=${join(root,'key.pem')}\nTLS_CERT_FILE=${join(root,'cert.pem')}\nNODE_ENV=production\nCOOKIE_SECURE=true\n`);
 writeFileSync(control,JSON.stringify({ReleaseDir:release,EnvFile:envFile,NodeExe:node}));
 const shell=(args)=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden',...args],{windowsHide:true,stdio:'pipe'}).toString();
 const ops=join(copiedRelease,'operations');
 shell(['-File',join(ops,'Switch-Release.ps1'),'-ControlFile',control,'-ReleaseDir',copiedRelease,'-ServiceStopped']);
 assert.equal(JSON.parse(readFileSync(control,'utf8')).ReleaseDir,copiedRelease);
 for(const [path,grant]of [[root,'*S-1-5-19:RX'],[program,'*S-1-5-19:(OI)(CI)RX'],[configDir,'*S-1-5-19:(OI)(CI)RX'],[join(root,'restored'),'*S-1-5-19:(OI)(CI)M'],[join(root,'logs'),'*S-1-5-19:(OI)(CI)M'],[join(root,'key.pem'),'*S-1-5-19:R'],[join(root,'cert.pem'),'*S-1-5-19:R']])execFileSync('icacls.exe',[path,'/grant',grant,'/T','/Q'],{windowsHide:true,stdio:'ignore'});
 taskName='ClimbDrill'+randomBytes(8).toString('hex');
 let registeredTask=false;
 try{shell(['-File',join(ops,'Register-StartupTask.ps1'),'-ControlFile',control,'-TaskName',taskName]);registeredTask=true;shell(['-Command',`Start-ScheduledTask -TaskName '${taskName}'`]);}
 catch(error){
   const detail=String(error.stderr??'');if(!detail.includes('80070005')&&!detail.includes('administrator PowerShell'))throw error;
   shell(['-File',join(ops,'Register-StartupTask.ps1'),'-ControlFile',control,'-TaskName',taskName,'-PreviewOnly']);taskName=undefined;
   metrics.windowsTask='registration denied by host privileges; task definition constructed only; LOCAL SERVICE and reboot auto-start pending';
   wrapper=spawn('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',join(ops,'Start-Climb.ps1'),'-ControlFile',control],{windowsHide:true,stdio:'ignore'});wrapperExit=new Promise(resolve=>wrapper.once('exit',resolve));
 }
 let healthy=false;for(let i=0;i<40;i++){try{healthy=(await call('/health')).status===200;if(healthy)break;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
 assert.ok(healthy,'Windows background wrapper must serve HTTPS');
 const taskLogin=await call('/api/v1/auth/login',{username:registered.body.account.username,password});assert.equal(taskLogin.status,200);assert.equal(taskLogin.body.revision,47);
 if(registeredTask){shell(['-Command',`Stop-ScheduledTask -TaskName '${taskName}'; Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false`]);taskName=undefined;metrics.windowsTask='LOCAL SERVICE registered, explicitly started, HTTPS/login verified, stopped and removed; reboot trigger not tested';}
 else {await stopWrapper();metrics.backgroundWrapper='current-user hidden wrapper HTTPS/login passed; stopped owned Node child';}
 shell(['-File',join(ops,'Switch-Release.ps1'),'-ControlFile',control,'-ReleaseDir',release,'-ServiceStopped']);assert.equal(JSON.parse(readFileSync(control,'utf8')).ReleaseDir,release);
 assert.equal(inspectDatabase(join(root,'restored','climb.sqlite')).accounts,4);
 metrics.updateRollback='application pointer switched to copied release then back; database unchanged; same-schema drill';
 metrics.environment={node:process.version,platform:process.platform,logicalCpus:cpus().length,hostMemoryMiB:Math.round(totalmem()/1048576),workerAffinityTwoLogical:affinity,workerOldSpaceMiB:256,osMemoryLimitApplied:false};
 metrics.checks='HTTPS static/API same origin; secure cookie; private paths 404; auth gate; 40 small writes; 6 large writes; 413; WAL backup; restored login and snapshot; log redaction';
 console.log(JSON.stringify(metrics,null,2));
}finally{
 agent.destroy();await stop();await stopWrapper();
 if(taskName)try{execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',`Stop-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false -ErrorAction SilentlyContinue`],{windowsHide:true,stdio:'ignore'});}catch{}
 assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true});console.log('Deployment drill stopped; temporary task, programs, certificates, logs, database and backup removed.');
}
