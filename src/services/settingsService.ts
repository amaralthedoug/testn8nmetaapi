import { pool } from '../db/client.js';

const cache = new Map<string, string | undefined>();

export function clearCache(): void {
  cache.clear();
}

export async function getSetting(key: string): Promise<string | undefined> {
  if (cache.has(key)) return cache.get(key);

  const { rows } = await pool.query<{ value: string }>(
    'SELECT value FROM settings WHERE key = $1',
    [key]
  );
  const value = rows[0]?.value;
  cache.set(key, value);
  return value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
  clearCache();
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ key: string; value: string }>(
    'SELECT key, value FROM settings'
  );
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}
