import { env } from '../../config/env.js';
import type { N8nLeadPayload } from '../../types/domain.js';

export type N8nResponse = {
  ok: boolean;
  status: number;
  body: string;
};

export const postToN8n = async (payload: N8nLeadPayload, url: string): Promise<N8nResponse> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-auth-token': env.N8N_INTERNAL_AUTH_TOKEN
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const body = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      body
    };
  } finally {
    clearTimeout(timeoutId);
  }
};
