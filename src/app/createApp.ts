import Fastify from 'fastify';
import { ZodTypeProvider, jsonSchemaTransform } from 'fastify-type-provider-zod';
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

    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list' }
    });
  }

  // NOTE: helmet applies globally to all routes (uses fastify-plugin).
  // If Swagger UI fails to render in browser due to CSP, pass staticCSP: true
  // to the swaggerUi registration options above.
  app.register(helmet);

  // Metrics — always enabled, excludes /metrics and /docs from route histograms
  const metricsPlugin = (await import('fastify-metrics')).default;
  await app.register(metricsPlugin, {
    defaultMetrics: { enabled: true },
    endpoint: { url: '/metrics', schema: { hide: true } },
    clearRegisterOnInit: true,
    routeMetrics: {
      enabled: true,
      routeBlacklist: ['/metrics', '/docs', '/docs/json', '/docs/yaml'],
      overrides: {
        histogram: {
          labelNames: ['method', 'route', 'status_code']
        }
      }
    },
    requestPathTransform: (req: { url: string }) => req.url.split('?')[0]
  });

  app.register(registerHealthRoutes);
  app.register(registerMetaRoutes);

  return app;
};
