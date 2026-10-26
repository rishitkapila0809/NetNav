import 'dotenv/config';
import { Pool } from 'pg';

let pool;
export function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    pool.on('error', (error) => {
      console.error(`[NETNAV DB] Idle PostgreSQL client error${error?.code ? ` (code ${error.code})` : ''}`);
    });
  }
  return pool;
}

export function setPoolForTests(testPool) { pool = testPool; }

