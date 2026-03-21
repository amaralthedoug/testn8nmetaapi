import crypto from 'crypto';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

interface AdminAuthOptions {
  apiKey: string;
}

const adminAuthPlugin: FastifyPluginAsync<AdminAuthOptions> = async (app, opts) => {
  const expectedHash = crypto.createHash('sha256').update(opts.apiKey).digest();

  app.addHook('preHandler', async (req, reply) => {
    const auth = req.headers['authorization'];
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

    // Hash both sides to normalize buffer length for timingSafeEqual.
    // This prevents length-based timing attacks regardless of token size.
    const providedHash = crypto
      .createHash('sha256')
      .update(token ?? '')
      .digest();

    const valid = token !== null && crypto.timingSafeEqual(providedHash, expectedHash);

    if (!valid) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }
  });
};

export const adminAuth = fp(adminAuthPlugin, { name: 'admin-auth' });
