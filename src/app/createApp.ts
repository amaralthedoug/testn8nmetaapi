import Fastify from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import fastifyRawBody from 'fastify-raw-body';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { registerMetaRoutes } from '../routes/meta.js';
import { registerHealthRoutes } from '../routes/health.js';

interface CreateAppOptions {
  enableDocs: boolean;
}

export const createApp = async (options: CreateAppOptions = { enableDocs: false }) => {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();

  app.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    routes: ['/webhooks/meta/lead-ads'],
    encoding: 'utf8',
    runFirst: true
  });

  app.register(sensible);
  app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW
  });

  if (options.enableDocs) {
    const { jsonSchemaTransform } = await import('fastify-type-provider-zod');
    const swagger = (await import('@fastify/swagger')).default;
    const swaggerUi = (await import('@fastify/swagger-ui')).default;

    await app.register(swagger, {
      openapi: {
        info: {
          title: 'Facebook Lead Ads Ingestion API',
          description: 'Hybrid ingestion service: Meta Webhook → PostgreSQL → n8n',
          version: '1.0.0'
        }
      },
      transform: jsonSchemaTransform
    });

    // swagger-ui registered before helmet so its CSP headers for /docs are not overridden
    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list' }
    });
  }

  // helmet registered after swagger-ui (strict CSP applies to all routes except /docs)
  app.register(helmet);

  // Task 4: metrics registration goes here

  app.register(registerHealthRoutes);
  app.register(registerMetaRoutes);

  return app;
};
