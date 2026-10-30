import Fastify, {LogController,type FastifyRequest} from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.ts';
import { openDatabase } from './database.ts';
import { ApiError, authService, prepareAuth } from './auth.ts';
import { snapshotService, writeRequest } from './snapshot.ts';
import { readFileSync } from 'node:fs';
import { installSite } from './static-site.ts';
import { BoundedLog } from './logging.ts';
import type { IncomingMessage } from 'node:http';
export async function buildApp(config: Config, now = Date.now, logger = false) {
  await prepareAuth();
  const sink=logger&&config.logDir?new BoundedLog(config.logDir):undefined;
  const options={ https:config.tls?{key:readFileSync(config.tls.key),cert:readFileSync(config.tls.cert),passphrase:config.tls.passphrase}:undefined,
    rewriteUrl:(req:IncomingMessage)=>req.url?.startsWith('/api/')?req.url.slice(4):req.url??'/',
    logController:new LogController({disableRequestLogging:true}),requestTimeout:15000,connectionTimeout:15000,keepAliveTimeout:5000,
    logger: logger ? { ...(sink?{stream:sink}:{}), redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers.set-cookie', 'password', 'token'], serializers: { req: (req:{method:string;url:string}) => ({ method: req.method, url: req.url.split('?')[0] }) } } : false as const, bodyLimit: 2 * 1024 * 1024, trustProxy: false };
  const app=Fastify(options);
  const db = openDatabase(config.dataDir);
  const active=new Set<FastifyRequest>();
  app.addHook('onClose', async () => db.close());
  app.addHook('onClose',async()=>{sink?.end();});
  app.addHook('onResponse',async(req,reply)=>{if(logger&&req.method!=='GET')app.log.info({method:req.method,route:req.routeOptions.url,statusCode:reply.statusCode},'request completed');});
  const auth = authService(db, config, now);
  const cookieName = config.cookieName ?? 'session';
  const snapshots = snapshotService(db,now);
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute' });
  const cookieOptions = { httpOnly: true, secure: config.secure, sameSite: 'strict' as const, path: '/' };
  app.addHook('onRequest', async (req, reply) => {
    if(active.size>=16)throw new ApiError(503,'SERVER_BUSY','服务繁忙，请稍后重试原操作');
    active.add(req);reply.raw.once('close',()=>active.delete(req));
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if(config.webRoot)reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'").header('X-Frame-Options','DENY').header('Referrer-Policy','same-origin');
    if(config.tls)reply.header('Strict-Transport-Security','max-age=31536000');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.origin) throw new ApiError(403, 'ORIGIN_DENIED', '请求来源不被允许');
  });
  app.addHook('onResponse',async req=>{active.delete(req);});
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
      auth.logout(req.cookies[cookieName]);
      reply.setCookie(cookieName, result.token, { ...cookieOptions, maxAge: config.sessionMs / 1000 });
      const {token: _token,...response}=result;
      return reply.code(action === 'register' ? 201 : 200).send({ ...response, serverTime: now() });
    });
  }
  app.get('/v1/auth/session', async req => ({ account: auth.session(req.cookies[cookieName]), serverTime: now() }));
  app.get('/v1/time', async req => { const serverReceivedAt=now();auth.session(req.cookies[cookieName]);return {schemaVersion:1,serverReceivedAt,serverSentAt:now()}; });
  app.post('/v1/auth/logout', async (req, reply) => {
    auth.logout(req.cookies[cookieName]); reply.clearCookie(cookieName, cookieOptions);
    return { loggedOut: true, serverTime: now() };
  });
  // Ownership always derives from the session; no caller-supplied account is trusted.
  for (const method of ['GET', 'PUT'] as const) app.route({ method, url: '/v1/accounts/:accountId/snapshot', handler: async req => {
    const account = auth.session(req.cookies[cookieName]);
    if ((req.params as {accountId:string}).accountId !== account.id) throw new ApiError(403, 'FORBIDDEN', '无权访问此账户');
    if(method==='GET')return {...snapshots.read(account.id),serverTime:now()};
    return {...snapshots.write(account.id,writeRequest(req.body)),serverTime:now()};
  } });
  if(config.webRoot)installSite(app,config.webRoot);
  return app;
}
