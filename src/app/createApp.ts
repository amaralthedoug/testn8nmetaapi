import Fastify from 'fastify';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider, jsonSchemaTransform, validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import fastifyRawBody from 'fastify-raw-body';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { registerAuthRoutes } from '../routes/auth.js';
import { registerMetaRoutes } from '../routes/meta.js';
import { registerHealthRoutes } from '../routes/health.js';
import { registerUnifiedWebhookRoutes } from '../routes/webhooks/unified.js';
import { loadRoutingConfig } from '../config/routingConfig.js';
import { registerTesterRoutes } from '../routes/tester.js';
import { registerManychatRoutes } from '../routes/manychat.js';
import { registerSettingsRoutes } from '../routes/settings.js';
import { LeadIngestionService } from '../services/leadIngestionService.js';
import { N8nDeliveryService } from '../services/n8nDeliveryService.js';

declare module 'fastify' {
  interface FastifyInstance {
    leadIngestionService: LeadIngestionService;
  }
}

interface CreateAppOptions {
  enableDocs: boolean;
}

export const createApp = async (options: CreateAppOptions = { enableDocs: false }) => {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const routingConfig = await loadRoutingConfig();
  app.decorate('leadIngestionService', new LeadIngestionService(new N8nDeliveryService(), routingConfig));

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

  await app.register(fastifyJwt, { secret: env.JWT_SECRET });
  await app.register(fastifyCookie);

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

  // NOTE: helmet applies globally. script-src allows 'unsafe-inline' for the
  // single-file ui.html which uses inline <script> blocks.
  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
        fontSrc: ["'self'", 'https:', 'data:'],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"]
      }
    }
  });

  // Metrics — always enabled, excludes /metrics and /docs from route histograms
  // fastify-metrics@11.0.0 uses CommonJS __esModule interop — the ESM default export
  // wraps the actual plugin as `.default.default`. The nullish coalescing fallback
  // handles environments where the double-nesting is already resolved.
  const { default: metricsPluginModule } = await import('fastify-metrics');
  const metricsPlugin = (metricsPluginModule as unknown as { default: FastifyPluginAsync<Record<string, unknown>> }).default ?? metricsPluginModule as unknown as FastifyPluginAsync<Record<string, unknown>>;
  await app.register(metricsPlugin, {
    defaultMetrics: { enabled: true },
    endpoint: { url: '/metrics', schema: { hide: true } },
    clearRegisterOnInit: true,
    routeMetrics: {
      enabled: true,
      routeBlacklist: ['/metrics', '/docs', '/docs/json', '/docs/yaml'],
      overrides: {
        labels: {
          getRouteLabel: (req: { routeOptions?: { url?: string }; url: string }) =>
            req.routeOptions?.url ?? req.url.split('?')[0]
        }
      }
    }
  });

  app.register(registerAuthRoutes);
  app.register(registerHealthRoutes);
  app.register(registerMetaRoutes);
  app.register(registerUnifiedWebhookRoutes);
  app.register(registerTesterRoutes);
  app.register(registerManychatRoutes);
  app.register(registerSettingsRoutes);

  return app;
};
