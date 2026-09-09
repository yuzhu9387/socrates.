import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.local');
const dataDir = path.join(local, 'postgres');
const configFile = path.join(local, 'postgres-admin.json');
const action = process.argv[2] || 'start';
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw new Error(`${command} is required. Install PostgreSQL or use Docker Compose.`);
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
await fs.mkdir(local, { recursive: true, mode: 0o700 });
if (action === 'stop' || action === 'status') {
  if (!(await exists(path.join(dataDir, 'PG_VERSION')))) { console.log('Local database is not initialized.'); process.exit(0); }
  const result = spawnSync('pg_ctl', ['-D', dataDir, action, ...(action === 'stop' ? ['-m', 'fast'] : [])], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
if (action !== 'start') throw new Error('Use start, stop or status.');
let config;
if (await exists(configFile)) config = JSON.parse(await fs.readFile(configFile, 'utf8'));
else {
  if (await exists(path.join(dataDir, 'PG_VERSION'))) throw new Error('Existing database has no matching local credentials; refusing to overwrite it.');
  config = { port: 55439, adminPassword: randomBytes(32).toString('hex'), appPassword: randomBytes(32).toString('hex') };
  await fs.writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
}
if (!(await exists(path.join(dataDir, 'PG_VERSION')))) {
  const passwordFile = path.join(local, 'init-password');
  await fs.writeFile(passwordFile, config.adminPassword, { mode: 0o600 });
  try {
    run('initdb', ['-D', dataDir, '--username=socrates_admin', '--encoding=UTF8', '--locale=C', '--auth=scram-sha-256', `--pwfile=${passwordFile}`]);
  } finally { await fs.rm(passwordFile, { force: true }); }
}
const status = spawnSync('pg_ctl', ['-D', dataDir, 'status'], { stdio: 'ignore' });
if (status.status !== 0) run('pg_ctl', ['-D', dataDir, '-l', path.join(local, 'postgres.log'), '-o', `-p ${config.port} -h 127.0.0.1 -k ${local}`, '-w', 'start']);
const { default: pg } = await import('../server/node_modules/pg/lib/index.js');
const client = new pg.Client({ host: '127.0.0.1', port: config.port, user: 'socrates_admin', password: config.adminPassword, database: 'postgres' });
await client.connect();
try {
  if (!(await client.query("SELECT 1 FROM pg_roles WHERE rolname='socrates_app'")).rowCount) {
    await client.query(`CREATE ROLE socrates_app LOGIN PASSWORD '${config.appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  }
  for (const name of ['socrates', 'socrates_test']) {
    if (!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount) await client.query(`CREATE DATABASE ${name} OWNER socrates_app ENCODING 'UTF8' TEMPLATE template0`);
  }
} finally { await client.end(); }
const envPath = path.join(root, '.env');
if (!(await exists(envPath))) {
  const base = `postgresql://socrates_app:${config.appPassword}@127.0.0.1:${config.port}`;
  await fs.writeFile(envPath, `DATABASE_URL=${base}/socrates\nTEST_DATABASE_URL=${base}/socrates_test\nAPP_ORIGIN=http://127.0.0.1:3001\nHOST=127.0.0.1\nPORT=3001\nNODE_ENV=development\n`, { mode: 0o600 });
} else console.log('Existing .env preserved.');
console.log(`PostgreSQL is running on 127.0.0.1:${config.port}; databases: socrates, socrates_test. Credentials stay in local files.`);
