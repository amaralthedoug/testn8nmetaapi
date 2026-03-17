import { pool } from '../db/client.js';

export const deliveryAttemptRepository = {
  async create(input: {
    leadId: string;
    targetSystem: string;
    attemptNumber: number;
    requestPayload: unknown;
    responseStatus?: number;
    responseBody?: string;
    errorMessage?: string;
    success: boolean;
  }) {
    await pool.query(
      `INSERT INTO delivery_attempts
      (lead_id,target_system,attempt_number,request_payload,response_status,response_body,error_message,attempted_at,success)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,now(),$8)`,
      [
        input.leadId,
        input.targetSystem,
        input.attemptNumber,
        JSON.stringify(input.requestPayload),
        input.responseStatus ?? null,
        input.responseBody ?? null,
        input.errorMessage ?? null,
        input.success
      ]
    );
  }
};
