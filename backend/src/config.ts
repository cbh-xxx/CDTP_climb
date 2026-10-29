import { isAbsolute, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
// src/ and dist/ have the same depth beneath demo/backend; cwd is not a trust boundary.
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
export interface Config { host: string; port: number; origin: string; secret: string; dataDir: string; secure: boolean; sessionMs: number }
export function config(env = process.env): Config {
  const secret = env.SESSION_SECRET ?? '';
  if (Buffer.byteLength(secret) < 32) throw new Error('SESSION_SECRET must contain at least 32 bytes');
  const dataDir = env.DATA_DIR ?? '';
  if (!isAbsolute(dataDir)) throw new Error('DATA_DIR must be an absolute private directory');
  const rel = relative(projectRoot, resolve(dataDir));
  if (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) throw new Error('DATA_DIR must be outside the project');
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const origin = new URL(env.APP_ORIGIN ?? 'http://127.0.0.1:5173').origin;
  const secure = env.COOKIE_SECURE === 'true';
  if (env.NODE_ENV === 'production' && (!secure || !origin.startsWith('https:'))) throw new Error('Production requires HTTPS and secure cookies');
  return { host: env.HOST ?? '127.0.0.1', port, origin, secret, dataDir, secure, sessionMs: 7 * 86400000 };
}
