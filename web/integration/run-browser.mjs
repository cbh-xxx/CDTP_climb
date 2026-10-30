import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {buildApp} from '../../backend/dist/app.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'climb-account-browser-'));
const app=await buildApp({host:'127.0.0.1',port:3002,origin:'http://127.0.0.1:5184',secret:randomBytes(32).toString('hex'),dataDir:join(dir,'database'),secure:false,sessionMs:7*86400000,cookieName:'climb_test_session'});
let child;
const full=process.argv.includes('--full');
try{
 await app.listen({host:'127.0.0.1',port:3002});
 child=spawn(process.execPath,[join(root,'node_modules/@playwright/test/cli.js'),'test','--config',full?'playwright.config.ts':'playwright.accounts.config.ts',...process.argv.slice(2).filter(x=>x!=='--full')],{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,ACCOUNT_VALIDATION_DIR:join(dir,'artifacts'),ACCOUNT_SCREENSHOT_DIR:dir}});
 const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
 process.exitCode=code??1;
 if(process.env.REVIEW_ACCOUNT_SCREENSHOTS==='true'){
   console.log('REVIEW_DIRECTORY '+dir);console.log('Send a newline to close services and remove temporary data.');
   await new Promise(resolve=>{ const timeout=setTimeout(resolve,60000);const done=()=>{clearTimeout(timeout);resolve();};process.stdin.once('data',done);process.stdin.once('end',done); });
   process.stdin.pause();
 }
}finally{
 if(child&&child.exitCode===null&&child.signalCode===null)child.kill();
 await app.close();
 if(dirname(resolve(dir))!==resolve(tmpdir()))throw Error('Unexpected cleanup target');
 rmSync(dir,{recursive:true,force:true});console.log('Browser validation backend closed; temporary artifacts and database removed.');
}
