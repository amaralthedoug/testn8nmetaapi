import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app/createApp.js';

describe('observability endpoints', () => {
  it('GET /docs returns 404 when enableDocs is false', async () => {
    const app = await createApp({ enableDocs: false });
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /docs returns 200 HTML when enableDocs is true', async () => {
    const app = await createApp({ enableDocs: true });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('GET /docs/json returns OpenAPI 3.0 spec when enableDocs is true', async () => {
    const app = await createApp({ enableDocs: true });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.openapi).toMatch(/^3\.0/);
  });

  it('GET /docs/json does not expose /metrics path', async () => {
    const app = await createApp({ enableDocs: true });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    const body = JSON.parse(res.body);
    expect(body.paths).not.toHaveProperty('/metrics');
  });

  it('GET /metrics returns Prometheus text with http_request_duration_seconds', async () => {
    const app = await createApp({ enableDocs: false });
    await app.ready();
    // Make a request so at least one metric is recorded
    await app.inject({ method: 'GET', url: '/health' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.body).toContain('http_request_duration_seconds');
  });

  it('GET /docs/json includes /health and /ready routes', async () => {
    const app = await createApp({ enableDocs: true });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    const body = JSON.parse(res.body);
    expect(body.paths).toHaveProperty('/health');
    expect(body.paths).toHaveProperty('/ready');
  });
});
