import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { requireAuth } from '../src/utils/requireAuth.js';

async function buildApp() {
  const app = Fastify();
  await app.register(cookie);
  await app.register(jwt, { secret: 'test-secret-exactly-32-characters-x' });

  app.get('/protected', async (req, reply) => {
    const ok = await requireAuth(app, req, reply);
    if (!ok) return;
    return reply.send({ ok: true });
  });

  await app.ready();
  return app;
}

describe('requireAuth', () => {
  it('returns 401 when no cookie is present', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Não autenticado.' });
  });

  it('returns 401 when token is invalid', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      cookies: { token: 'invalid.token.here' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Sessão expirada.' });
  });

  it('returns true and does not reply when token is valid', async () => {
    const app = await buildApp();
    const token = app.jwt.sign({ id: 1, email: 'a@b.com' });
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
