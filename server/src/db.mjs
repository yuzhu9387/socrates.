import pg from 'pg';
import {readdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export function createPool(connectionString = process.env.DATABASE_URL) {
 if(!connectionString)throw new Error('DATABASE_URL is required.');
 const pool=new pg.Pool({connectionString,max:10,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
 // Idle socket errors are handled so a database restart does not crash the process.
 pool.on('error',()=>{});
 return pool;
}
export async function migrate(pool) {
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('socrates:migrations'))");
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  const dir=fileURLToPath(new URL('../migrations/',import.meta.url));
  for(const name of (await readdir(dir)).filter(n=>/^\d+.*\.sql$/.test(n)).sort()) {
   const sql=await readFile(`${dir}/${name}`,'utf8'),checksum=createHash('sha256').update(sql).digest('hex');
   const existing=await client.query('SELECT checksum FROM schema_migrations WHERE name=$1',[name]);
   if(existing.rowCount){if(existing.rows[0].checksum!==checksum)throw new Error(`Migration ${name} changed after application.`);continue;}
   await client.query(sql);await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);
  }
  await client.query('COMMIT');
 } catch(error) {await client.query('ROLLBACK');throw error;}finally{client.release();}
}
