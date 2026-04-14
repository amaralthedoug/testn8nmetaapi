import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { logger } from '../utils/logger.js';
import { AppError } from '../types/errors.js';
import { registerPlugins } from './plugins.js';
import { loadRoutingConfig } from '../routing/config.js';
import { LeadIngestionService } from '../services/leadIngestionService.js';
import { N8nDeliveryService } from '../services/n8nDeliveryService.js';
import { registerAuthRoutes } from '../routes/auth.js';
import { registerMetaRoutes } from '../integrations/meta/routes.js';
import { registerHealthRoutes } from '../routes/health.js';
import { registerUnifiedWebhookRoutes } from '../routes/webhooks/unified.js';
import { registerTesterRoutes } from '../routes/tester.js';
import { registerManychatRoutes } from '../routes/manychat.js';
import { registerSettingsRoutes } from '../routes/settings.js';

declare module 'fastify' {
  interface FastifyInstance {
    leadIngestionService: LeadIngestionService;
  }
}

interface CreateAppOptions {
  enableDocs: boolean;
}

export const createApp = async (options: CreateAppOptions = { enableDocs: false }) => {
  const app = Fastify({ logger });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await registerPlugins(app, options);

  // Wire services
  const routingConfig = await loadRoutingConfig();
  app.decorate('leadIngestionService', new LeadIngestionService(new N8nDeliveryService(), routingConfig));

  // Register routes
  app.register(registerAuthRoutes);
  app.register(registerHealthRoutes);
  app.register(registerMetaRoutes);
  app.register(registerUnifiedWebhookRoutes);
  app.register(registerTesterRoutes);
  app.register(registerManychatRoutes);
  app.register(registerSettingsRoutes);

  // Global error handler: AppError → structured HTTP response; unexpected errors → 500
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: err.message, code: err.code });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'Erro interno do servidor.', code: 'INTERNAL_ERROR' });
  });

  return app;
};
