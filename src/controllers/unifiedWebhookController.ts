import type { FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { correlationIdFromHeader } from '../utils/correlation.js';
import { buildLeadHash } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { webhookEventRepository } from '../repositories/webhookEventRepository.js';
import { leadRepository } from '../repositories/leadRepository.js';
import { leadSourcesRepository } from '../repositories/leadSourcesRepository.js';
import { mapInstagramPayloadV1 } from '../integrations/instagram/mappers/v1.js';
import type { NormalizedLead } from '../types/domain.js';

type Mapper = (raw: unknown) => NormalizedLead;
const mappers: Record<string, Mapper> = { 'instagram:1.0': mapInstagramPayloadV1 };

const verifyApiKey = (provided: string | undefined): boolean => {
  if (!provided) return false;
  try {
    const expected = Buffer.from(env.BACKEND_API_KEY);
    const actual = Buffer.from(provided);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch { return false; }
};

export const receiveUnifiedWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
  const correlationId = correlationIdFromHeader(request.headers['x-correlation-id'] as string | undefined);
  const log = logger.child({ correlationId });

  if (!verifyApiKey(request.headers['x-api-key'] as string | undefined)) {
    return reply.status(401).send({ status: 'rejected', reason: 'invalid_api_key', correlationId });
  }

  const body = request.body as Record<string, unknown>;
  const source = body?.source as string | undefined;
  const contractVersion = body?.contractVersion as string | undefined;

  const safeHeaders = { ...request.headers };
  delete (safeHeaders as Record<string, unknown>)['x-hub-signature-256'];
  delete (safeHeaders as Record<string, unknown>)['x-api-key'];
  delete (safeHeaders as Record<string, unknown>)['authorization'];
  delete (safeHeaders as Record<string, unknown>)['x-internal-auth-token'];

  let eventId: string;
  try {
    eventId = await webhookEventRepository.create({ provider: source ?? 'unknown', eventType: 'lead_qualified', rawPayload: body, headers: safeHeaders, processingStatus: 'received', correlationId });
  } catch (err) {
    log.error({ err }, 'Failed to persist raw event');
    return reply.status(500).send({ status: 'rejected', reason: 'internal_error', correlationId });
  }

  const mapperKey = `${source}:${contractVersion}`;
  const mapper = mappers[mapperKey];
  if (!mapper) {
    await webhookEventRepository.updateStatus(eventId, 'failed', `Unknown contract: ${mapperKey}`);
    return reply.status(400).send({ status: 'rejected', reason: `unsupported_contract:${mapperKey}`, correlationId });
  }

  let lead: NormalizedLead;
  try {
    lead = mapper(body);
  } catch (err) {
    const reason = err instanceof ZodError ? err.message : 'mapping_failed';
    await webhookEventRepository.updateStatus(eventId, 'failed', reason);
    return reply.status(400).send({ status: 'rejected', reason: 'invalid_payload', correlationId });
  }

  try {
    const leadHash = buildLeadHash(lead);
    const existing = await leadRepository.findByHash(leadHash);
    if (existing) {
      await webhookEventRepository.updateStatus(eventId, 'duplicate');
      return reply.status(200).send({ status: 'duplicate', correlationId });
    }
    const leadSource = await leadSourcesRepository.findByName(source!);
    const leadId = await leadRepository.create(lead, leadHash, null, leadSource?.id ?? null);
    await webhookEventRepository.updateStatus(eventId, 'persisted');
    log.info({ leadId }, 'Lead persisted from instagram');
    return reply.status(202).send({ status: 'accepted', correlationId, leadId });
  } catch (err) {
    await webhookEventRepository.updateStatus(eventId, 'failed', String(err));
    log.error({ err }, 'Unexpected error');
    return reply.status(500).send({ status: 'rejected', reason: 'internal_error', correlationId });
  }
};
