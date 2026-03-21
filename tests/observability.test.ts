import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app/createApp.js';

describe('observability endpoints', () => {
  it('GET /docs returns 404 when enableDocs is false', async () => {
    const app = createApp({ enableDocs: false });
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(404);
  });
});
