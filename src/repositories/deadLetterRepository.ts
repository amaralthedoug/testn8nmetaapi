import { pool } from '../db/client.js';
import type { N8nDeliveryStatus, NormalizedLead } from '../types/domain.js';

export type LeadSummary = {
  id: string;
  externalLeadId: string | null;
  email: string | null;
  n8nDeliveryStatus: N8nDeliveryStatus;
  deliveryAttempts: number;
  updatedAt: string;
};

export type LeadDetail = {
  id: string;
  normalizedPayload: NormalizedLead;
  n8nDeliveryStatus: N8nDeliveryStatus;
};

export const deadLetterRepository = {
  async listFailed(limit: number, offset: number): Promise<{ rows: LeadSummary[]; total: number }> {
    const result = await pool.query<LeadSummary & { total: string }>(
      `SELECT
         id,
         external_lead_id    AS "externalLeadId",
         email,
         n8n_delivery_status AS "n8nDeliveryStatus",
         delivery_attempts   AS "deliveryAttempts",
         updated_at          AS "updatedAt",
         COUNT(*) OVER()     AS total
       FROM leads
       WHERE n8n_delivery_status = 'failed'
       ORDER BY updated_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const total = result.rows.length > 0 ? parseInt(result.rows[0].total, 10) : 0;
    const rows = result.rows.map(({ total: _total, ...row }) => row as LeadSummary);
    return { rows, total };
  },

  async findById(id: string): Promise<LeadDetail | null> {
    const result = await pool.query<{
      id: string;
      normalized_payload: NormalizedLead;
      n8n_delivery_status: N8nDeliveryStatus;
    }>(
      `SELECT id, normalized_payload, n8n_delivery_status
       FROM leads
       WHERE id = $1`,
      [id]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      normalizedPayload: row.normalized_payload,
      n8nDeliveryStatus: row.n8n_delivery_status
    };
  },

  async claimForReplay(id: string): Promise<string | null> {
    const result = await pool.query<{ id: string }>(
      `UPDATE leads
       SET n8n_delivery_status = 'retrying', updated_at = now()
       WHERE id = $1 AND n8n_delivery_status = 'failed'
       RETURNING id`,
      [id]
    );

    return result.rows[0]?.id ?? null;
  }
};
