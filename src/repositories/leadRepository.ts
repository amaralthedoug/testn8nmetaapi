import { pool } from '../db/client.js';
import type { NormalizedLead } from '../types/domain.js';

export const leadRepository = {
  async findByHash(leadHash: string) {
    const result = await pool.query<{ id: string }>('SELECT id FROM leads WHERE lead_hash = $1 LIMIT 1', [leadHash]);
    return result.rows[0] ?? null;
  },

  async create(lead: NormalizedLead, leadHash: string, n8nTargetUrl: string | null = null) {
    const query = `
      INSERT INTO leads (
        external_lead_id,full_name,first_name,last_name,email,phone,city,state,campaign_id,campaign_name,
        adset_id,adset_name,ad_id,ad_name,form_id,page_id,created_time_from_provider,normalized_payload,
        lead_hash,source,n8n_delivery_status,n8n_target_url,created_at,updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18::jsonb,
        $19,$20,'pending',$21,now(),now()
      ) RETURNING id
    `;

    const values = [
      lead.externalLeadId ?? null,
      lead.fullName ?? null,
      lead.firstName ?? null,
      lead.lastName ?? null,
      lead.email ?? null,
      lead.phone ?? null,
      lead.city ?? null,
      lead.state ?? null,
      lead.campaignId ?? null,
      lead.campaignName ?? null,
      lead.adsetId ?? null,
      lead.adsetName ?? null,
      lead.adId ?? null,
      lead.adName ?? null,
      lead.formId ?? null,
      lead.pageId ?? null,
      lead.createdTime ?? null,
      JSON.stringify(lead),
      leadHash,
      lead.source,
      n8nTargetUrl
    ];

    const result = await pool.query<{ id: string }>(query, values);
    return result.rows[0].id;
  },

  async markForwardStatus(leadId: string, status: 'success' | 'failed') {
    await pool.query(
      `UPDATE leads
       SET n8n_delivery_status=$2,
           forwarded_to_n8n_at=CASE WHEN $2='success' THEN now() ELSE forwarded_to_n8n_at END,
           updated_at=now()
       WHERE id=$1`,
      [leadId, status]
    );
  },

  async incrementAttempts(leadId: string) {
    await pool.query('UPDATE leads SET delivery_attempts = delivery_attempts + 1, updated_at = now() WHERE id=$1', [leadId]);
  }
};
