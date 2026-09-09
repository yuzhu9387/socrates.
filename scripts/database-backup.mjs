import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const url = new URL(process.env.DATABASE_URL);
const directory = path.resolve('backups');
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
const file = path.join(directory, `socrates-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)) };
const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', file], { env, stdio: ['ignore', 'inherit', 'inherit'] });
try {
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`pg_dump exited ${code}`))); });
  await fs.chmod(file, 0o600);
  console.log(`Database backup saved: ${file}`);
} catch (error) { await fs.rm(file, { force: true }); throw error; }
