import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHmac } from 'node:crypto';
import type { Db } from './database.ts';
import type { Config } from './config.ts';
import { snapshotService, writeRequest, canonical } from './snapshot.ts';
import { ApiError } from './errors.ts';
export { ApiError } from './errors.ts';
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const pressure={active:0,peak:0,rejected:0};
export const authPressure=()=>({...pressure,limit:2});
async function hash(password: string, salt = randomBytes(16).toString('hex')) {
  if(pressure.active>=2){pressure.rejected++;throw new ApiError(503,'AUTH_BUSY','认证服务繁忙，请稍后重试原操作');}
  pressure.active++;pressure.peak=Math.max(pressure.peak,pressure.active);
  try{const key = await new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key)));return `scrypt$32768$8$1$${salt}$${key.toString('hex')}`;}
  finally{pressure.active--;}
}
const dummyHash=hash('dummy-password-for-timing');
export const prepareAuth=()=>dummyHash.then(()=>undefined);
async function verify(password: string, stored: string) {
  const parts = stored.split('$');
  const candidate = await hash(password, parts[4]);
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(stored));
}
export function credentials(body: unknown) {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b.username !== 'string' || typeof b.password !== 'string' || Object.keys(b).some(k => !['username', 'password', 'acknowledgeNoRecovery', 'initialData'].includes(k))) throw new ApiError(400, 'INVALID_INPUT', '请输入有效用户名、密码及允许的字段');
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(b.username) || b.password.length < 12 || b.password.length > 128 || Buffer.byteLength(b.password) > 512 || /[\u0000-\u001f\u007f]/.test(b.password)) throw new ApiError(400, 'INVALID_INPUT', '用户名为3—32位字母数字下划线；密码为12—128个UTF-16代码单元，不含控制字符，不裁剪空格');
  return { username: b.username.toLowerCase(), password: b.password, acknowledged: b.acknowledgeNoRecovery === true };
}
export function authService(db: Db, config: Config, now: () => number) {
  const snapshots = snapshotService(db, now);
  const digest = (token: string) => createHmac('sha256', config.secret).update(token).digest('hex');
  const dummy = dummyHash;
  function issue(accountId: string) {
    const token = randomBytes(32).toString('base64url'); const expiresAt = now() + config.sessionMs;
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), accountId, expiresAt);
    return { token, expiresAt };
  }
  return {
    async register(body: unknown) {
      const c = credentials(body);
      if (!c.acknowledged) throw new ApiError(400, 'RECOVERY_ACK_REQUIRED', '不收集邮箱，不提供密码找回或人工重置；注册前必须确认');
      const request = writeRequest((body as Record<string,unknown>).initialData, true);
      const fingerprint = createHmac('sha256',config.secret).update(canonical({username:c.username,password:c.password,request})).digest('hex');
      const passwordHash = await hash(c.password); const id = randomUUID();
      try { return db.transaction(() => {
        const existing = db.prepare('SELECT id FROM accounts WHERE username=?').get(c.username) as {id:string}|undefined;
        if(existing){
          const original=snapshots.replay(existing.id,request.operationId,fingerprint);
          if(!original)throw new ApiError(409,'USERNAME_TAKEN','用户名已被使用');
          return {account:{id:existing.id,username:c.username},...original,...issue(existing.id)};
        }
        db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(id, c.username, passwordHash, now());
        const result=snapshots.commit(id,request,fingerprint,true);
        return { account: { id, username: c.username }, ...result,...issue(id) };
      })(); }
      catch (e) { if ((e as {code?:string}).code === 'SQLITE_CONSTRAINT_UNIQUE') throw new ApiError(409, 'USERNAME_TAKEN', '用户名已被使用'); throw e; }
    },
    async login(body: unknown) {
      if(body&&typeof body==='object'&&'initialData' in body)throw new ApiError(400,'INVALID_INPUT','登录不接收游客数据');
      const c = credentials(body);
      const account = db.prepare('SELECT id, username, password_hash FROM accounts WHERE username = ?').get(c.username) as {id:string;username:string;password_hash:string}|undefined;
      const valid = await verify(c.password, account?.password_hash ?? await dummy);
      if (!valid || !account) throw new ApiError(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
      return db.transaction(()=>({ account: {id: account.id, username: account.username}, ...snapshots.read(account.id), ...issue(account.id) }))();
    },
    session(token?: string) {
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(401, 'UNAUTHENTICATED', '请重新登录');
      const row = db.prepare('SELECT a.id, a.username, s.expires_at AS expiresAt FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?').get(digest(token), now()) as {id:string;username:string;expiresAt:number}|undefined;
      if (!row) throw new ApiError(401, 'UNAUTHENTICATED', '会话已失效');
      return row;
    },
    logout(token?: string) { if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token)); }
  };
}
