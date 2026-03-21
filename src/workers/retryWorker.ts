import { env } from '../config/env.js';
import { retryRepository } from '../repositories/retryRepository.js';
import { N8nDeliveryService } from '../services/n8nDeliveryService.js';
import type { N8nLeadPayload, NormalizedLead } from '../types/domain.js';
import { logger } from '../utils/logger.js';

export const startRetryWorker = () => {
  const service = new N8nDeliveryService();

  setInterval(async () => {
    const failedLeads = await retryRepository.listFailedLeads();
    for (const row of failedLeads) {
      const lead = row.normalized_payload as NormalizedLead;
      const targetUrl = row.n8n_target_url ?? env.N8N_WEBHOOK_URL;
      const payload: N8nLeadPayload = {
        correlationId: `retry-${row.id}`,
        ingestedAt: new Date().toISOString(),
        lead,
        meta: { isDuplicate: false, rawEventStored: true, version: '1.0.0' }
      };
      await service.deliver(row.id, payload, targetUrl);
    }
  }, env.RETRY_POLL_INTERVAL_MS).unref();

  logger.info('retry worker started');
};
