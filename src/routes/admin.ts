import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { adminAuth } from '../plugins/adminAuth.js';
import { env } from '../config/env.js';
import { listFailedLeads, replayLead } from '../controllers/adminController.js';

const leadSummarySchema = z.object({
  id: z.string().uuid(),
  externalLeadId: z.string().nullable(),
  email: z.string().nullable(),
  n8nDeliveryStatus: z.enum(['pending', 'success', 'failed', 'retrying']),
  deliveryAttempts: z.number(),
  updatedAt: z.string()
});

export const registerAdminRoutes = async (app: FastifyInstance) => {
  app.register(adminAuth, { apiKey: env.ADMIN_API_KEY });

  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/admin/leads/failed', {
    schema: {
      hide: true,
      querystring: z.object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0)
      }),
      response: {
        200: z.object({
          leads: z.array(leadSummarySchema),
          total: z.number(),
          limit: z.number(),
          offset: z.number()
        }),
        401: z.object({ error: z.string() })
      }
    }
  }, listFailedLeads);

  typed.post('/admin/leads/:id/replay', {
    schema: {
      hide: true,
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ replayed: z.literal(true), leadId: z.string().uuid() }),
        401: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() })
      }
    }
  }, replayLead);
};
