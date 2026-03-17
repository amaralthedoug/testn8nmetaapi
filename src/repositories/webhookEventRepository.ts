import { pool } from '../db/client.js';
import type { ProcessingStatus } from '../types/domain.js';

export const webhookEventRepository = {
  async create(input: {
    provider: string;
    eventType: string;
    sourcePageId?: string;
    sourceFormId?: string;
    externalEventId?: string;
    rawPayload: unknown;
    headers: unknown;
    processingStatus: ProcessingStatus;
    processingError?: string;
    correlationId: string;
  }) {
    const query = `
      INSERT INTO webhook_events
      (provider,event_type,source_page_id,source_form_id,external_event_id,raw_payload,headers,received_at,processing_status,processing_error,correlation_id)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,now(),$8,$9,$10)
      RETURNING id
    `;

    const values = [
      input.provider,
      input.eventType,
      input.sourcePageId ?? null,
      input.sourceFormId ?? null,
      input.externalEventId ?? null,
      JSON.stringify(input.rawPayload),
      JSON.stringify(input.headers),
      input.processingStatus,
      input.processingError ?? null,
      input.correlationId
    ];

    const result = await pool.query<{ id: string }>(query, values);
    return result.rows[0].id;
  },

  async updateStatus(id: string, status: ProcessingStatus, error?: string) {
    await pool.query('UPDATE webhook_events SET processing_status=$2, processing_error=$3 WHERE id=$1', [id, status, error ?? null]);
  }
};
