import { Writable } from 'node:stream';
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
/** Synchronous bounded disk sink: no unbounded async log queue. Own files only. */
export class BoundedLog extends Writable {
  private index=0; private bytes=0; private day=''; private file='';
  private dir:string;private limit:number;private retained:number;
  constructor(dir:string,limit=10*1024*1024,retained=10){super();this.dir=dir;this.limit=limit;this.retained=retained;mkdirSync(dir,{recursive:true});}
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error|null)=>void){
    try{
      const day=new Date().toISOString().slice(0,10);
      if(day!==this.day||this.bytes+chunk.length>this.limit){
        this.day=day;this.file=join(this.dir,`climb-${day}-${Date.now()}-${this.index++}.log`);this.bytes=0;
        const files=readdirSync(this.dir).filter(x=>/^climb-\d{4}-\d{2}-\d{2}-\d+-\d+\.log$/.test(x)).map(name=>({name,time:statSync(join(this.dir,name)).mtimeMs})).sort((a,b)=>b.time-a.time);
        for(const old of files.slice(this.retained-1))unlinkSync(join(this.dir,old.name));
      }
      appendFileSync(this.file,chunk);this.bytes+=chunk.length;callback();
    }catch(error){callback(error as Error);}
  }
}
