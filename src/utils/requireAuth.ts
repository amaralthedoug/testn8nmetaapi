import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

/**
 * BUSINESS RULE: All protected routes use JWT from httpOnly cookie `token`.
 * Returns true if authenticated; sends 401 and returns false otherwise.
 */
export async function requireAuth(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const token = req.cookies?.['token'];
  if (!token) {
    await reply.status(401).send({ error: 'Não autenticado.' });
    return false;
  }
  try {
    app.jwt.verify(token);
    return true;
  } catch {
    await reply.status(401).send({ error: 'Sessão expirada.' });
    return false;
  }
}
