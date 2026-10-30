import { readdirSync, lstatSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
const types: Record<string,string> = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.otf':'font/otf','.ico':'image/x-icon'};
export function installSite(app: FastifyInstance, root: string) {
  const files = new Map<string,{path:string;type:string}>();
  function visit(dir: string) {
    for (const entry of readdirSync(dir,{withFileTypes:true})) {
      if (entry.name.startsWith('.')) continue;
      const path=join(dir,entry.name);
      if(lstatSync(path).isSymbolicLink()) throw new Error('Static files cannot contain links');
      if(entry.isDirectory()){visit(path);continue;}
      const extension=entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
      const key='/'+relative(root,path).split(sep).join('/');
      if(types[extension]&&(extension!=='.html'||key==='/index.html'))files.set(key,{path,type:types[extension]});
    }
  }
  visit(root);
  if(!files.has('/index.html'))throw new Error('WEB_ROOT must contain index.html');
  app.get('/*',async(req,reply)=>{
    let key:string;try{key=decodeURIComponent(req.url.split('?')[0]);}catch{return reply.code(400).send({error:{code:'BAD_PATH',message:'无效路径'}});}
    const item=files.get(key==='/'?'/index.html':key);
    if(!item)return reply.code(404).send({error:{code:'NOT_FOUND',message:'资源不存在'}});
    reply.type(item.type).header('Cache-Control',key.startsWith('/assets/')?'public, max-age=31536000, immutable':key==='/'||key==='/index.html'?'no-cache':'public, max-age=3600');
    return reply.send(createReadStream(item.path));
  });
}
