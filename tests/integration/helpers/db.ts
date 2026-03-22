// tests/integration/helpers/db.ts
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '../../../db/migrations');

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/leads',
});

export async function runMigrations(): Promise<void> {
  const files = (await readdir(migrationsDir))
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    await pool.query(sql);
  }
}

export async function truncateAll(): Promise<void> {
  await pool.query(
    'TRUNCATE delivery_attempts, leads, webhook_events RESTART IDENTITY CASCADE'
  );
}
