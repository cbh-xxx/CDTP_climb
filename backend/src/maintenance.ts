import Database from 'better-sqlite3';
import { existsSync, copyFileSync, constants, mkdirSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export function inspectDatabase(file:string){
  const db=new Database(file,{readonly:true,fileMustExist:true});
  try{
    if(db.pragma('integrity_check',{simple:true})!=='ok'||(db.pragma('foreign_key_check') as unknown[]).length)throw new Error('Database integrity check failed');
    return {schemaVersion:db.pragma('user_version',{simple:true}),accounts:(db.prepare('SELECT count(*) n FROM accounts').get() as {n:number}).n};
  }finally{db.close();}
}
function flush(file:string){const fd=openSync(file,'r+');try{fsyncSync(fd);}finally{closeSync(fd);}}
export async function backupDatabase(source:string,target:string){
  if(!isAbsolute(source)||!isAbsolute(target)||resolve(source)===resolve(target)||existsSync(target))throw new Error('Backup needs a new absolute destination');
  mkdirSync(dirname(target),{recursive:true});
  const db=new Database(source,{readonly:true,fileMustExist:true});
  try{await db.backup(target);}finally{db.close();}
  const result=inspectDatabase(target);flush(target);return result;
}
export function restoreDatabase(source:string,newDataDirectory:string){
  if(!isAbsolute(source)||!isAbsolute(newDataDirectory))throw new Error('Restore paths must be absolute');
  const info=inspectDatabase(source),target=join(newDataDirectory,'climb.sqlite');
  if(existsSync(target)||existsSync(target+'-wal')||existsSync(target+'-shm'))throw new Error('Restore only into an empty data directory; never overwrite a live database');
  mkdirSync(newDataDirectory,{recursive:true});copyFileSync(source,target,constants.COPYFILE_EXCL);flush(target);inspectDatabase(target);return info;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [operation,source,target]=process.argv.slice(2);
 if(!source)throw new Error('Usage: maintenance.js check <database> | backup <database> <new-backup> | restore <backup> <new-data-directory>');
 const result=operation==='check'?inspectDatabase(source):operation==='backup'&&target?await backupDatabase(source,target):operation==='restore'&&target?restoreDatabase(source,target):null;
 if(!result)throw new Error('Invalid maintenance command');console.log(JSON.stringify(result));
}
