import { metaWebhookSchema, type MetaWebhookPayload } from '../schemas/metaWebhook.js';
import { normalizeMetaPayload } from '../integrations/meta/normalizer.js';
import { webhookEventRepository } from '../repositories/webhookEventRepository.js';
import { leadRepository } from '../repositories/leadRepository.js';
import { buildLeadHash } from '../utils/hash.js';
import type { N8nLeadPayload } from '../types/domain.js';
import { N8nDeliveryService } from './n8nDeliveryService.js';
import { logger } from '../utils/logger.js';

export class LeadIngestionService {
  constructor(private readonly deliveryService = new N8nDeliveryService()) {}

  async ingest(input: { correlationId: string; payload: unknown; headers: Record<string, unknown> }) {
    const parsed = metaWebhookSchema.safeParse(input.payload);
    if (!parsed.success) {
      await webhookEventRepository.create({
        provider: 'meta',
        eventType: 'leadgen',
        rawPayload: input.payload,
        headers: input.headers,
        processingStatus: 'failed',
        processingError: parsed.error.message,
        correlationId: input.correlationId
      });
      return { accepted: false, reason: 'validation_error' as const };
    }

    return this.processValidatedPayload(parsed.data, input);
  }

  private async processValidatedPayload(payload: MetaWebhookPayload, input: { correlationId: string; payload: unknown; headers: Record<string, unknown> }) {
    const normalizedLeads = normalizeMetaPayload(payload);

    for (const lead of normalizedLeads) {
      const leadHash = buildLeadHash(lead);

      const eventId = await webhookEventRepository.create({
        provider: 'meta',
        eventType: 'leadgen',
        sourcePageId: lead.pageId,
        sourceFormId: lead.formId,
        externalEventId: lead.externalLeadId,
        rawPayload: input.payload,
        headers: input.headers,
        processingStatus: 'persisted',
        correlationId: input.correlationId
      });

      const existing = await leadRepository.findByHash(leadHash);

      if (existing) {
        await webhookEventRepository.updateStatus(eventId, 'duplicate');
        logger.info({ correlationId: input.correlationId, leadHash }, 'duplicate lead ignored');
        continue;
      }

      const leadId = await leadRepository.create(lead, leadHash);
      const n8nPayload: N8nLeadPayload = {
        correlationId: input.correlationId,
        ingestedAt: new Date().toISOString(),
        lead,
        meta: {
          isDuplicate: false,
          rawEventStored: true,
          version: '1.0.0'
        }
      };

      setImmediate(async () => {
        await this.deliveryService.deliver(leadId, n8nPayload);
        await webhookEventRepository.updateStatus(eventId, 'forwarded');
      });
    }

    return { accepted: true };
  }
}
