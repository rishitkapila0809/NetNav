import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getPool } from './db.js';

const pool = getPool();
const migrationUrl = new URL('./migrations/001_create_network_measurements.sql', import.meta.url);
try {
  const sql = await readFile(fileURLToPath(migrationUrl), 'utf8');
  await pool.query(sql);
  console.log('Applied migration 001_create_network_measurements.sql');
} finally {
  await pool.end();
}
