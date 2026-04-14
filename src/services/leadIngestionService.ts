import { metaWebhookSchema, type MetaWebhookPayload } from '../schemas/metaWebhook.js';
import { normalizeMetaPayload } from '../integrations/meta/normalizer.js';
import { webhookEventRepository } from '../repositories/webhookEventRepository.js';
import { leadRepository } from '../repositories/leadRepository.js';
import { buildLeadHash } from '../utils/hash.js';
import type { N8nLeadPayload } from '../types/domain.js';
import { N8nDeliveryService } from './n8nDeliveryService.js';
import { logger } from '../utils/logger.js';
import { resolveRoute } from '../routing/resolveRoute.js';
import { applyFieldMap } from '../routing/applyFieldMap.js';
import { env } from '../config/env.js';
import type { RoutingConfig } from '../routing/config.js';

export type LeadIngestionResult =
  | { accepted: true }
  | { accepted: false; reason: 'validation_error' };

export class LeadIngestionService {
  constructor(
    private readonly deliveryService = new N8nDeliveryService(),
    private readonly routingConfig: RoutingConfig | null = null
  ) {}

  async ingest(input: {
    correlationId: string;
    payload: unknown;
    headers: Record<string, unknown>;
  }): Promise<LeadIngestionResult> {
    const safeHeaders = { ...input.headers };
    delete (safeHeaders as Record<string, unknown>)['x-hub-signature-256'];
    delete (safeHeaders as Record<string, unknown>)['x-api-key'];
    delete (safeHeaders as Record<string, unknown>)['authorization'];
    delete (safeHeaders as Record<string, unknown>)['x-internal-auth-token'];

    const parsed = metaWebhookSchema.safeParse(input.payload);
    if (!parsed.success) {
      await webhookEventRepository.create({
        provider: 'meta',
        eventType: 'leadgen',
        rawPayload: input.payload,
        headers: safeHeaders,
        processingStatus: 'failed',
        processingError: parsed.error.message,
        correlationId: input.correlationId
      });
      return { accepted: false, reason: 'validation_error' };
    }

    return this.processValidatedPayload(parsed.data, input, safeHeaders);
  }

  private async processValidatedPayload(
    payload: MetaWebhookPayload,
    input: { correlationId: string; payload: unknown; headers: Record<string, unknown> },
    safeHeaders: Record<string, unknown>
  ): Promise<LeadIngestionResult> {
    const normalizedLeads = normalizeMetaPayload(payload);

    for (const lead of normalizedLeads) {
      // 1. Resolve route
      const route = resolveRoute(lead.formId, lead.pageId, this.routingConfig, env.N8N_WEBHOOK_URL);

      // 2. Apply field map BEFORE hash and persistence
      const mappedLead = applyFieldMap(lead, route.fieldMap);

      // 3. Hash computed on mapped lead (promotion may affect phone/email used for dedup)
      const leadHash = buildLeadHash(mappedLead);

      const eventId = await webhookEventRepository.create({
        provider: 'meta',
        eventType: 'leadgen',
        sourcePageId: mappedLead.pageId,
        sourceFormId: mappedLead.formId,
        externalEventId: mappedLead.externalLeadId,
        rawPayload: input.payload,
        headers: safeHeaders,
        processingStatus: 'persisted',
        correlationId: input.correlationId
      });

      const existing = await leadRepository.findByHash(leadHash);
      if (existing) {
        await webhookEventRepository.updateStatus(eventId, 'duplicate');
        logger.info({ correlationId: input.correlationId, leadHash }, 'duplicate lead ignored');
        continue;
      }

      // 4. Persist mapped lead with resolved URL
      const leadId = await leadRepository.create(mappedLead, leadHash, route.url);

      logger.info(
        { correlationId: input.correlationId, formId: lead.formId, routeSource: route.source },
        'lead routed'
      );

      // 5. Build n8n payload from mapped lead
      const n8nPayload: N8nLeadPayload = {
        correlationId: input.correlationId,
        ingestedAt: new Date().toISOString(),
        lead: mappedLead,
        meta: { isDuplicate: false, rawEventStored: true, version: '1.0.0' }
      };

      setImmediate(async () => {
        try {
          await this.deliveryService.deliver(leadId, n8nPayload, route.url);
          await webhookEventRepository.updateStatus(eventId, 'forwarded');
        } catch (err) {
          logger.error({ err, eventId }, 'Async n8n delivery failed');
        }
      });
    }

    return { accepted: true };
  }
}
