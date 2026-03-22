import { env } from '../config/env.js';
import { postToN8n } from '../integrations/n8n/client.js';
import { deliveryAttemptRepository } from '../repositories/deliveryAttemptRepository.js';
import { leadRepository } from '../repositories/leadRepository.js';
import { logger } from '../utils/logger.js';
import type { N8nLeadPayload } from '../types/domain.js';

const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class N8nDeliveryService {
  async deliver(leadId: string, payload: N8nLeadPayload, url: string): Promise<void> {
    for (let attempt = 1; attempt <= env.RETRY_MAX_ATTEMPTS; attempt += 1) {
      await leadRepository.incrementAttempts(leadId);

      try {
        const response = await postToN8n(payload, url);

        if (response.ok) {
          await deliveryAttemptRepository.create({
            leadId,
            targetSystem: 'n8n',
            attemptNumber: attempt,
            requestPayload: payload,
            responseStatus: response.status,
            responseBody: response.body,
            success: true
          });
          await leadRepository.markForwardStatus(leadId, 'success');
          return;
        }

        throw new Error(`n8n returned ${response.status}`);
      } catch (error) {
        await deliveryAttemptRepository.create({
          leadId,
          targetSystem: 'n8n',
          attemptNumber: attempt,
          requestPayload: payload,
          errorMessage: error instanceof Error ? error.message : String(error),
          success: false
        });

        if (attempt >= env.RETRY_MAX_ATTEMPTS) {
          await leadRepository.markForwardStatus(leadId, 'failed');
          logger.error({ leadId, err: error }, 'delivery failed permanently');
          return;
        }

        const backoff = env.RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        logger.warn({ leadId, attempt, backoff }, 'delivery retry scheduled');
        await sleep(backoff);
      }
    }
  }
}
