import type { FastifyInstance } from 'fastify';
import { pool } from '../db/client.js';

export const registerHealthRoutes = async (app: FastifyInstance) => {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'not_ready' });
    }
  });
};
