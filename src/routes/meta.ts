import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { receiveMetaWebhook, verifyWebhookChallenge } from '../controllers/metaWebhookController.js';
import { correlationIdFromHeader } from '../utils/correlation.js';
import { env } from '../config/env.js';
import { verifyMetaSignature } from '../integrations/meta/verification.js';

const ensureMetaSignature = (request: FastifyRequest, reply: FastifyReply) => {
  const signature = request.headers['x-hub-signature-256'] as string | undefined;
  const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;

  if (!rawBody || !verifyMetaSignature(rawBody, signature, env.META_APP_SECRET)) {
    const correlationId = correlationIdFromHeader(request.headers['x-correlation-id'] as string | undefined);
    void reply.status(401).send({ status: 'rejected', reason: 'invalid_signature', correlationId });
  }

  return;
};

export const registerMetaRoutes = async (app: FastifyInstance) => {
  app.get('/webhooks/meta/lead-ads', verifyWebhookChallenge);
  app.post(
    '/webhooks/meta/lead-ads',
    { preValidation: [ensureMetaSignature], bodyLimit: 1048576 },
    receiveMetaWebhook
  );
};
