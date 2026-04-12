import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { verifyMetaChallenge } from '../integrations/meta/verification.js';
import { correlationIdFromHeader } from '../utils/correlation.js';

export const verifyWebhookChallenge = async (request: FastifyRequest, reply: FastifyReply) => {
  const verifyToken = env.META_VERIFY_TOKEN;
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

export const receiveMetaWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
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
