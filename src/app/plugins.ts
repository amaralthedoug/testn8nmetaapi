import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fastifyRawBody from 'fastify-raw-body';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import { env } from '../config/env.js';

interface PluginOptions {
  enableDocs: boolean;
}

// REASON: FastifyInstance is generic over Logger — using `any` here avoids
// contravariace conflicts when pino.Logger is passed from createApp.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const registerPlugins = async (app: FastifyInstance<any, any, any, any>, options: PluginOptions): Promise<void> => {
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
    const { jsonSchemaTransform } = await import('fastify-type-provider-zod');

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

  // NOTE: fastify-metrics@11.0.0 uses CommonJS __esModule interop — the ESM default export
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
};
