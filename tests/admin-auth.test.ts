import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { adminAuth } from '../src/plugins/adminAuth.js';

const API_KEY = 'test-admin-key-at-least-32-chars!!';

async function buildApp(key = API_KEY) {
  const app = Fastify({ logger: false });

  app.register(async (scope) => {
    scope.register(adminAuth, { apiKey: key });
    scope.get('/admin/test', async () => ({ ok: true }));
  });

  await app.ready();
  return app;
}

describe('adminAuth plugin', () => {
  it('rejects requests with no Authorization header', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin/test' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with a wrong Bearer token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/test',
      headers: { Authorization: 'Bearer wrong-token' }
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects non-Bearer Authorization schemes', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/test',
      headers: { Authorization: `Basic ${API_KEY}` }
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts requests with the correct Bearer token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/test',
      headers: { Authorization: `Bearer ${API_KEY}` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('returns the same error message whether the token is missing or wrong', async () => {
    const app = await buildApp();

    const noHeader = await app.inject({ method: 'GET', url: '/admin/test' });
    const wrongToken = await app.inject({
      method: 'GET',
      url: '/admin/test',
      headers: { Authorization: 'Bearer wrong-token' }
    });

    expect(noHeader.json().message).toBe(wrongToken.json().message);
  });
});
