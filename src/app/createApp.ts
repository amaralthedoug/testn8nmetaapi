import Fastify from 'fastify';
import fastifyRawBody from 'fastify-raw-body';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { registerMetaRoutes } from '../routes/meta.js';
import { registerHealthRoutes } from '../routes/health.js';

export const createApp = () => {
  const app = Fastify({ logger });

  app.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    routes: ['/webhooks/meta/lead-ads'],
    encoding: 'utf8',
    runFirst: true
  });

  app.register(sensible);
  app.register(helmet);
  app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW
  });

  app.register(registerHealthRoutes);
  app.register(registerMetaRoutes);

  return app;
};
