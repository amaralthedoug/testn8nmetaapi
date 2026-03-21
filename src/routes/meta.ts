import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { receiveMetaWebhook, verifyWebhookChallenge } from '../controllers/metaWebhookController.js';
import { correlationIdFromHeader } from '../utils/correlation.js';
import { env } from '../config/env.js';
import { verifyMetaSignature } from '../integrations/meta/verification.js';

const ensureMetaSignature = async (request: FastifyRequest, reply: FastifyReply) => {
  const signature = request.headers['x-hub-signature-256'] as string | undefined;
  const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;

  if (!rawBody || !verifyMetaSignature(rawBody, signature, env.META_APP_SECRET)) {
    const correlationId = correlationIdFromHeader(request.headers['x-correlation-id'] as string | undefined);
    await reply.status(401).send({ status: 'rejected', reason: 'invalid_signature', correlationId });
  }
};

// 400: generic rejection from handler
const rejection400Schema = z.object({
  status: z.literal('rejected'),
  reason: z.string(),
  correlationId: z.string()
});

// 401: signature-specific rejection from ensureMetaSignature preValidation hook
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
      description: 'Receives Meta leadgen webhook. Body is a MetaWebhookPayload (see metaWebhookSchema in src/schemas/metaWebhookSchema.ts).',
      response: {
        202: z.object({ status: z.literal('accepted'), correlationId: z.string() }),
        400: rejection400Schema,
        401: rejection401Schema
      }
    }
  }, receiveMetaWebhook);
};
