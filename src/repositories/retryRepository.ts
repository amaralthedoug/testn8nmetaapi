import { pool } from '../db/client.js';

export const retryRepository = {
  async listFailedLeads(limit = 20) {
    const result = await pool.query<{ id: string; normalized_payload: unknown }>(
      `SELECT id, normalized_payload
       FROM leads
       WHERE n8n_delivery_status='failed'
       ORDER BY updated_at ASC
       LIMIT $1`,
      [limit]
    );

    return result.rows;
  }
};
