import type { FastifyInstance } from 'fastify';
import { receiveMetaWebhook, verifyWebhookChallenge } from '../controllers/metaWebhookController.js';

export const registerMetaRoutes = async (app: FastifyInstance) => {
  app.get('/webhooks/meta/lead-ads', verifyWebhookChallenge);
  app.post('/webhooks/meta/lead-ads', receiveMetaWebhook);
};
