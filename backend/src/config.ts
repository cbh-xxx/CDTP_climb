import { isAbsolute, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
// src/ and dist/ have the same depth beneath demo/backend; cwd is not a trust boundary.
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
export interface Config { host: string; port: number; origin: string; secret: string; dataDir: string; secure: boolean; sessionMs: number; cookieName?: string; webRoot?:string; logDir?:string; tls?:{key:string;cert:string;passphrase?:string} }
function realPath(path:string):string {if(existsSync(path))return realpathSync(path);const parent=resolve(path,'..');if(parent===resolve(path))return resolve(path);return resolve(realPath(parent),relative(parent,resolve(path)));}
function contains(parent:string,path:string){const rel=relative(realPath(parent),realPath(path));return rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel);}
export function config(env = process.env): Config {
  const secret = env.SESSION_SECRET ?? '';
  if (Buffer.byteLength(secret) < 32) throw new Error('SESSION_SECRET must contain at least 32 bytes');
  const dataDir = env.DATA_DIR ?? '';
  if (!isAbsolute(dataDir)) throw new Error('DATA_DIR must be an absolute private directory');
  if (contains(projectRoot,dataDir)) throw new Error('DATA_DIR must be outside the project');
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const origin = new URL(env.APP_ORIGIN ?? 'http://127.0.0.1:5173').origin;
  const secure = env.COOKIE_SECURE === 'true';
  const cookieName = env.SESSION_COOKIE_NAME ?? 'session';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(cookieName)) throw new Error('Invalid SESSION_COOKIE_NAME');
  if (env.NODE_ENV === 'production' && (!secure || !origin.startsWith('https:'))) throw new Error('Production requires HTTPS and secure cookies');
  const webRoot=env.WEB_ROOT,logDir=env.LOG_DIR;
  const tls=env.TLS_KEY_FILE&&env.TLS_CERT_FILE?{key:env.TLS_KEY_FILE,cert:env.TLS_CERT_FILE,passphrase:env.TLS_KEY_PASSWORD}:undefined;
  if(env.NODE_ENV==='production'&&(!tls||!webRoot||!logDir))throw new Error('Production requires WEB_ROOT, LOG_DIR and TLS key/certificate files');
  for(const path of [webRoot,logDir,tls?.key,tls?.cert].filter((x):x is string=>!!x))if(!isAbsolute(path))throw new Error('Deployment paths must be absolute');
  if(webRoot){for(const path of [dataDir,logDir,tls?.key,tls?.cert].filter((x):x is string=>!!x))if(contains(webRoot,path))throw new Error('Private data, logs and TLS files must be outside WEB_ROOT');}
  if(logDir&&(contains(logDir,dataDir)||contains(dataDir,logDir)))throw new Error('Data and logs must be separate directories');
  return { host: env.HOST ?? '127.0.0.1', port, origin, secret, dataDir, secure, sessionMs: 7 * 86400000, cookieName,webRoot,logDir,tls };
}
