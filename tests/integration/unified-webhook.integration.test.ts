// tests/integration/unified-webhook.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { startFakeN8n, type FakeN8nServer } from './helpers/n8nServer.js';
import { pool, runMigrations, truncateAll } from './helpers/db.js';

const isIntegration = process.env.INTEGRATION === 'true';

const validInstagramPayload = {
  source: 'instagram',
  contractVersion: '1.0',
  raw: {
    handle: '@patient_test',
    firstMessage: 'Quero saber sobre rinoplastia',
    timestamp: '2026-03-22T10:00:00.000Z',
  },
  qualified: {
    procedimento_interesse: 'Rinoplastia',
    janela_decisao: '1-3 meses',
    regiao: 'São Paulo',
    contato_whatsapp: '+5511999999999',
    resumo: 'Paciente interessada em cirurgia.',
  },
  processedAt: '2026-03-22T10:01:00.000Z',
};

describe.skipIf(!isIntegration)('POST /webhooks/v1/leads (integration)', () => {
  let app: Awaited<ReturnType<typeof import('../../src/app/createApp.js').createApp>>;
  let n8n: FakeN8nServer;

  beforeAll(async () => {
    n8n = await startFakeN8n();
    vi.stubEnv('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/leads');
    vi.stubEnv('N8N_WEBHOOK_URL', n8n.getUrl());
    vi.resetModules();
    const { createApp } = await import('../../src/app/createApp.js');
    await runMigrations();
    await truncateAll();
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

  it('persists instagram lead with correct source for valid payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      headers: { 'x-api-key': process.env.BACKEND_API_KEY ?? 'test-api-key' },
      payload: validInstagramPayload,
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('accepted');

    const { rows: leads } = await pool.query('SELECT * FROM leads');
    expect(leads).toHaveLength(1);
    expect(leads[0].source).toBe('instagram');
    expect(leads[0].external_lead_id).toBe('@patient_test');

    const { rows: events } = await pool.query(
      "SELECT processing_status FROM webhook_events ORDER BY received_at DESC LIMIT 1"
    );
    expect(events[0].processing_status).toBe('persisted');
  });

  it('returns 200 duplicate and writes no new lead row for duplicate payload', async () => {
    const headers = { 'x-api-key': process.env.BACKEND_API_KEY ?? 'test-api-key' };

    await app.inject({ method: 'POST', url: '/webhooks/v1/leads', headers, payload: validInstagramPayload });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      headers,
      payload: validInstagramPayload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('duplicate');

    const { rows: leads } = await pool.query('SELECT * FROM leads');
    expect(leads).toHaveLength(1); // still only one

    const { rows: events } = await pool.query(
      "SELECT processing_status FROM webhook_events ORDER BY received_at DESC LIMIT 1"
    );
    expect(events[0].processing_status).toBe('duplicate');
  });

  it('returns 401 and writes nothing to DB when X-Api-Key is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      payload: validInstagramPayload,
    });

    expect(res.statusCode).toBe(401);

    const { rows: leads } = await pool.query('SELECT * FROM leads');
    expect(leads).toHaveLength(0);

    const { rows: events } = await pool.query('SELECT * FROM webhook_events');
    expect(events).toHaveLength(0);
  });

  it('returns 400 and stores failed event for unknown contract version', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      headers: { 'x-api-key': process.env.BACKEND_API_KEY ?? 'test-api-key' },
      payload: { ...validInstagramPayload, contractVersion: '9.9' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().reason).toContain('unsupported_contract');

    const { rows: events } = await pool.query(
      "SELECT processing_status FROM webhook_events ORDER BY received_at DESC LIMIT 1"
    );
    expect(events[0].processing_status).toBe('failed');
  });
});
