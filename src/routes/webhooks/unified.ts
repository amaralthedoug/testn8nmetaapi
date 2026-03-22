import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { receiveUnifiedWebhook } from '../../controllers/unifiedWebhookController.js';

export const registerUnifiedWebhookRoutes = async (app: FastifyInstance) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.post('/webhooks/v1/leads', {
    schema: {
      description: 'Unified lead ingestion. Auth: X-Api-Key header.',
      response: {
        202: z.object({ status: z.literal('accepted'), correlationId: z.string(), leadId: z.string() }),
        200: z.object({ status: z.literal('duplicate'), correlationId: z.string() }),
        400: z.object({ status: z.literal('rejected'), reason: z.string(), correlationId: z.string() }),
        401: z.object({ status: z.literal('rejected'), reason: z.string(), correlationId: z.string() }),
        500: z.object({ status: z.literal('rejected'), reason: z.string(), correlationId: z.string() })
      }
    }
  }, receiveUnifiedWebhook);
};
