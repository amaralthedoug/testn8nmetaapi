// tests/integration/meta-webhook.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { startFakeN8n, type FakeN8nServer } from './helpers/n8nServer.js';
import { pool, runMigrations, truncateAll } from './helpers/db.js';

const isIntegration = process.env.INTEGRATION === 'true';

// Valid Meta webhook payload with one lead
const validMetaPayload = {
  object: 'page',
  entry: [{
    id: 'page-1',
    changes: [{
      field: 'leadgen',
      value: {
        leadgen_id: 'lead-ext-1',
        page_id: 'page-1',
        form_id: 'form-1',
        ad_id: 'ad-1',
        created_time: 1711065600,
        email: 'test@example.com',
        phone_number: '+5511999999999',
        full_name: 'Test User'
      }
    }]
  }]
};

function sign(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

describe.skipIf(!isIntegration)('POST /webhooks/meta/lead-ads (integration)', () => {
  let app: Awaited<ReturnType<typeof import('../../src/app/createApp.js').createApp>>;
  let n8n: FakeN8nServer;

  beforeAll(async () => {
    n8n = await startFakeN8n();
    vi.stubEnv('N8N_WEBHOOK_URL', n8n.getUrl());
    vi.resetModules();
    const { createApp } = await import('../../src/app/createApp.js');
    await runMigrations();
    app = await createApp();
    await app.ready();
  });

  afterEach(async () => {
    await truncateAll();
    n8n.reset();
  });

  afterAll(async () => {
    await app.close();
    await n8n.close();
    await pool.end();
    vi.unstubAllEnvs();
  });

  it('persists lead and delivers to n8n for valid HMAC payload', async () => {
    const body = JSON.stringify(validMetaPayload);
    const secret = process.env.META_APP_SECRET ?? 'test-app-secret';

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meta/lead-ads',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sign(body, secret),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('accepted');

    // Wait for setImmediate-deferred n8n delivery
    const n8nPayload = await n8n.waitForRequest();
    expect(n8nPayload).toMatchObject({ lead: { email: 'test@example.com' } });

    // Verify DB state
    const { rows: leads } = await pool.query('SELECT * FROM leads');
    expect(leads).toHaveLength(1);
    expect(leads[0].external_lead_id).toBe('lead-ext-1');

    // Poll until the webhook_event status is 'forwarded' (updateStatus runs after deliver() returns)
    let status = 'persisted';
    for (let i = 0; i < 20; i++) {
      const { rows: events } = await pool.query(
        "SELECT processing_status FROM webhook_events ORDER BY received_at DESC LIMIT 1"
      );
      status = events[0]?.processing_status;
      if (status === 'forwarded') break;
      await new Promise(r => setTimeout(r, 50));
    }
    expect(status).toBe('forwarded');
  });

  it('marks duplicate lead and does not call n8n', async () => {
    const body = JSON.stringify(validMetaPayload);
    const secret = process.env.META_APP_SECRET ?? 'test-app-secret';
    const headers = {
      'content-type': 'application/json',
      'x-hub-signature-256': sign(body, secret),
    };

    // First ingestion
    await app.inject({ method: 'POST', url: '/webhooks/meta/lead-ads', headers, payload: body });
    await n8n.waitForRequest(); // consume delivery
    n8n.reset();

    // Second ingestion — same payload, same hash
    const res = await app.inject({ method: 'POST', url: '/webhooks/meta/lead-ads', headers, payload: body });

    expect(res.statusCode).toBe(202);

    // Give setImmediate time to fire (if it were going to)
    await new Promise(r => setTimeout(r, 100));
    expect(n8n.requestCount).toBe(0);

    const { rows: events } = await pool.query(
      "SELECT processing_status FROM webhook_events ORDER BY received_at DESC LIMIT 1"
    );
    expect(events[0].processing_status).toBe('duplicate');
  });

  it('returns 401 and writes nothing to DB for invalid HMAC', async () => {
    const body = JSON.stringify(validMetaPayload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meta/lead-ads',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=invalidsignature',
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);

    const { rows: leads } = await pool.query('SELECT * FROM leads');
    expect(leads).toHaveLength(0);

    const { rows: events } = await pool.query('SELECT * FROM webhook_events');
    expect(events).toHaveLength(0);
  });
});
