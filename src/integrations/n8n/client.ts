import { env } from '../../config/env.js';
import type { N8nLeadPayload } from '../../types/domain.js';

export type N8nResponse = {
  ok: boolean;
  status: number;
  body: string;
};

export const postToN8n = async (payload: N8nLeadPayload): Promise<N8nResponse> => {
  const response = await fetch(env.N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-auth-token': env.N8N_INTERNAL_AUTH_TOKEN
    },
    body: JSON.stringify(payload)
  });

  const body = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    body
  };
};
