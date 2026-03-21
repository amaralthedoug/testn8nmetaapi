import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pool } from '../db/client.js';

export const registerHealthRoutes = async (app: FastifyInstance) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/health', {
    schema: {
      response: {
        200: z.object({ status: z.literal('ok') })
      }
    }
  }, async () => ({ status: 'ok' as const }));

  typed.get('/ready', {
    schema: {
      response: {
        200: z.object({ status: z.literal('ready') }),
        503: z.object({ status: z.literal('not_ready') })
      }
    }
  }, async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ready' as const };
    } catch {
      return reply.status(503).send({ status: 'not_ready' as const });
    }
  });
};
