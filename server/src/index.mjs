import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate } from './db.mjs';
import { createApp } from './app.mjs';
import { validateEdgeProxySecret } from './proxy-client-ip.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Run npm run setup or configure .env.');
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be valid.');
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0) throw new Error('TRUST_PROXY_HOPS must be a nonnegative safe integer.');
const edgeProxySecret = process.env.EDGE_PROXY_SECRET;
validateEdgeProxySecret(edgeProxySecret);
const origin = process.env.APP_ORIGIN || `http://127.0.0.1:${port}`;
const production = process.env.NODE_ENV === 'production';
if (production && new URL(origin).protocol !== 'https:') throw new Error('Production APP_ORIGIN must use HTTPS.');
const pool = createPool(process.env.DATABASE_URL);
await migrate(pool);
const staticDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../demo/dist-app');
const app = createApp({ pool, origin, mcpApiUrl: `http://127.0.0.1:${port}`, trustProxyHops, edgeProxySecret, secureCookies: production, allowRegistration: false, staticDir });
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Socrates is ready at ${origin}`));
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  if (closing) return;
  closing = true;
  server.close(async () => { await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
});
