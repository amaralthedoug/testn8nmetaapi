import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { verifyMetaChallenge, verifyMetaSignature } from './verification.js';
import { correlationIdFromHeader } from '../../utils/correlation.js';
import { getSetting } from '../../services/settingsService.js';

const ensureMetaSignature = async (request: FastifyRequest, reply: FastifyReply) => {
  const appSecret = await getSetting('meta_app_secret') ?? env.META_APP_SECRET;
  if (!appSecret) {
    return reply.status(503).send({ error: 'META_APP_SECRET not configured. Complete setup wizard first.' });
  }

  const signature = request.headers['x-hub-signature-256'] as string | undefined;
  const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;

  if (!rawBody || !verifyMetaSignature(rawBody, signature, appSecret)) {
    const correlationId = correlationIdFromHeader(request.headers['x-correlation-id'] as string | undefined);
    return reply.status(401).send({ status: 'rejected', reason: 'invalid_signature', correlationId });
  }
};

const verifyWebhookChallenge = async (request: FastifyRequest, reply: FastifyReply) => {
  const verifyToken = await getSetting('meta_verify_token') ?? env.META_VERIFY_TOKEN;
  if (!verifyToken) {
    return reply.status(503).send({ error: 'META_VERIFY_TOKEN not configured. Complete setup wizard first.' });
  }

  const query = request.query as Record<string, string | undefined>;
  const challenge = verifyMetaChallenge(
    query['hub.mode'],
    query['hub.verify_token'],
    query['hub.challenge'],
    verifyToken
  );
  if (!challenge) return reply.status(403).send({ error: 'verification failed' });
  return reply.status(200).send(challenge);
};

const receiveMetaWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
  const correlationId = correlationIdFromHeader(
    request.headers['x-correlation-id'] as string | undefined
  );

  const result = await request.server.leadIngestionService.ingest({
    correlationId,
    payload: request.body,
    headers: request.headers as Record<string, unknown>
  });

  if (!result.accepted) {
    return reply.status(400).send({ status: 'rejected', reason: result.reason, correlationId });
  }

  return reply.status(202).send({ status: 'accepted', correlationId });
};

const rejection400Schema = z.object({
  status: z.literal('rejected'),
  reason: z.string(),
  correlationId: z.string()
});

const rejection401Schema = z.object({
  status: z.literal('rejected'),
  reason: z.literal('invalid_signature'),
  correlationId: z.string()
});

export const registerMetaRoutes = async (app: FastifyInstance) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/webhooks/meta/lead-ads', {
    schema: {
      querystring: z.object({
        'hub.mode': z.string(),
        'hub.verify_token': z.string(),
        'hub.challenge': z.string()
      }),
      response: {
        200: z.string(),
        403: z.object({ error: z.string() })
      }
    }
  }, verifyWebhookChallenge);

  typed.post('/webhooks/meta/lead-ads', {
    preValidation: [ensureMetaSignature],
    bodyLimit: 1048576,
    schema: {
      // No body schema — preserves fastify-raw-body raw byte capture for HMAC validation
      description: 'Receives Meta leadgen webhook. Body is a MetaWebhookPayload (see src/integrations/meta/schema.ts).',
      response: {
        202: z.object({ status: z.literal('accepted'), correlationId: z.string() }),
        400: rejection400Schema,
        401: rejection401Schema
      }
    }
  }, receiveMetaWebhook);
};
