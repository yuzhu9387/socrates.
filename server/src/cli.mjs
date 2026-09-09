import { createPool, migrate } from './db.mjs';
import { createAccount, hashPassword, validateCredentials } from './auth.mjs';
const command = process.argv[2];
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const pool = createPool(process.env.DATABASE_URL);
try {
  if (command === 'migrate') { await migrate(pool); console.log('Database migrations applied.'); }
  else if (command === 'user:create' || command === 'user:password') {
    const credentials = validateCredentials({ email: process.argv[3], password: process.env.SOCRATES_ACCOUNT_PASSWORD });
    if (command === 'user:create') { await createAccount(pool, credentials, false); console.log('Account created.'); }
    else {
      const passwordHash = await hashPassword(credentials.password);
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const result = await db.query('UPDATE users SET password_hash=$1 WHERE email=$2 RETURNING id', [passwordHash, credentials.email]);
        if (!result.rowCount) throw new Error('Account not found.');
        await db.query('DELETE FROM sessions WHERE user_id=$1', [result.rows[0].id]);
        await db.query('UPDATE api_connections SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [result.rows[0].id]);
        await db.query('COMMIT'); console.log('Password reset; existing sessions and API tokens revoked.');
      } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
    }
  } else throw new Error('Usage: cli.mjs migrate | user:create <email> | user:password <email>. Account commands read SOCRATES_ACCOUNT_PASSWORD from the environment.');
} finally { await pool.end(); }
