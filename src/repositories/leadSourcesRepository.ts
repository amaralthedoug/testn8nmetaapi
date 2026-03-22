import { pool } from '../db/client.js';

export type LeadSource = {
  id: string;
  name: string;
};

export const leadSourcesRepository = {
  async findByName(name: string): Promise<LeadSource | null> {
    const result = await pool.query<{
      id: string;
      name: string;
    }>(
      'SELECT id, name FROM lead_sources WHERE name = $1 AND active = TRUE LIMIT 1',
      [name]
    );
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, name: row.name };
  }
};
