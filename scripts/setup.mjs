import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status || 1);
}
run('npm', ['ci']);
run('npm', ['ci', '--prefix', 'server']);
run('npm', ['ci', '--prefix', 'demo']);
const database = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const usesDedicatedCluster = database?.hostname === '127.0.0.1' && database.port === '55439'
  && existsSync(path.join(root, '.local/postgres/PG_VERSION'));
if (!database || usesDedicatedCluster) run(process.execPath, ['scripts/local-db.mjs', 'start']);
run('npm', ['run', 'migrate']);
run('npm', ['run', 'build'], { ...process.env, NODE_ENV: 'production' });
console.log('Setup complete. Run npm start, then open http://127.0.0.1:3001.');
