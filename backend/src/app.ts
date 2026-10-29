import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.ts';
import { openDatabase } from './database.ts';
import { ApiError, authService } from './auth.ts';
import { snapshotService, writeRequest } from './snapshot.ts';
export async function buildApp(config: Config, now = Date.now, logger = false) {
  const db = openDatabase(config.dataDir);
  const app = Fastify({ logger: logger ? { redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers.set-cookie', 'password', 'token'], serializers: { req: req => ({ method: req.method, url: req.url.split('?')[0] }) } } : false, bodyLimit: 2 * 1024 * 1024, trustProxy: false });
  app.addHook('onClose', async () => db.close());
  const auth = authService(db, config, now);
  const snapshots = snapshotService(db,now);
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute' });
  const cookieOptions = { httpOnly: true, secure: config.secure, sameSite: 'strict' as const, path: '/' };
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.origin) throw new ApiError(403, 'ORIGIN_DENIED', '请求来源不被允许');
  });
  app.setErrorHandler((error, _req, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode;
    const status = error instanceof ApiError ? error.status : (statusCode && statusCode < 500 ? statusCode : 500);
    reply.code(status).send({ error: { code: error instanceof ApiError ? error.code : status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 429 ? 'RATE_LIMITED' : status < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR', message: error instanceof ApiError ? error.message : status === 429 ? '请求过于频繁，请稍后重试' : status < 500 ? '请求无效' : '服务暂时不可用' }, serverTime: now() });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({error: {code:'NOT_FOUND',message:'接口不存在'},serverTime:now()}));
  app.get('/health', async () => ({ status: 'ok', serverTime: now() }));
  for (const action of ['register', 'login'] as const) {
    app.post(`/v1/auth/${action}`, { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      const result = await auth[action](req.body);
      auth.logout(req.cookies.session);
      reply.setCookie('session', result.token, { ...cookieOptions, maxAge: config.sessionMs / 1000 });
      const {token: _token,...response}=result;
      return reply.code(action === 'register' ? 201 : 200).send({ ...response, serverTime: now() });
    });
  }
  app.get('/v1/auth/session', async req => ({ account: auth.session(req.cookies.session), serverTime: now() }));
  app.get('/v1/time', async req => { const serverReceivedAt=now();auth.session(req.cookies.session);return {schemaVersion:1,serverReceivedAt,serverSentAt:now()}; });
  app.post('/v1/auth/logout', async (req, reply) => {
    auth.logout(req.cookies.session); reply.clearCookie('session', cookieOptions);
    return { loggedOut: true, serverTime: now() };
  });
  // Ownership always derives from the session; no caller-supplied account is trusted.
  for (const method of ['GET', 'PUT'] as const) app.route({ method, url: '/v1/accounts/:accountId/snapshot', handler: async req => {
    const account = auth.session(req.cookies.session);
    if ((req.params as {accountId:string}).accountId !== account.id) throw new ApiError(403, 'FORBIDDEN', '无权访问此账户');
    if(method==='GET')return {...snapshots.read(account.id),serverTime:now()};
    return {...snapshots.write(account.id,writeRequest(req.body)),serverTime:now()};
  } });
  return app;
}
