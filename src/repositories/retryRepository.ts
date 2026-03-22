import { pool } from '../db/client.js';

export const retryRepository = {
  async listFailedLeads(limit = 20, maxAttempts = 5) {
    const result = await pool.query<{
      id: string;
      normalized_payload: unknown;
      n8n_target_url: string | null;
    }>(
      `SELECT id, normalized_payload, n8n_target_url
       FROM leads
       WHERE n8n_delivery_status = 'failed'
         AND (SELECT COUNT(*) FROM delivery_attempts WHERE lead_id = leads.id) < $2
       ORDER BY updated_at ASC
       LIMIT $1`,
      [limit, maxAttempts]
    );

    return result.rows;
  }
};
