import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate } from './db.mjs';
import { createApp } from './app.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Run npm run setup or configure .env.');
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be valid.');
const origin = process.env.APP_ORIGIN || `http://127.0.0.1:${port}`;
const production = process.env.NODE_ENV === 'production';
if (production && new URL(origin).protocol !== 'https:') throw new Error('Production APP_ORIGIN must use HTTPS.');
const pool = createPool(process.env.DATABASE_URL);
await migrate(pool);
const staticDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../demo/dist-app');
const app = createApp({ pool, origin, secureCookies: production, allowRegistration: false, staticDir });
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Socrates is ready at ${origin}`));
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  if (closing) return;
  closing = true;
  server.close(async () => { await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
});
