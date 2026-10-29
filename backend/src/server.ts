import { config } from './config.ts';
import { buildApp } from './app.ts';
const settings = config();
const app = await buildApp(settings, Date.now, true);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
await app.listen({ host: settings.host, port: settings.port });
