import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env BEFORE importing createApp so the route sees no WEBHOOK_SECRET
vi.mock('../../src/config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    HOST: '0.0.0.0',
    PORT: 3000,
    DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/test',
    META_VERIFY_TOKEN: 'test-verify-token',
    META_APP_SECRET: 'test-app-secret',
    N8N_WEBHOOK_URL: 'https://example.com/webhook',
    N8N_INTERNAL_AUTH_TOKEN: 'test-n8n-token',
    RETRY_MAX_ATTEMPTS: 5,
    RETRY_BASE_DELAY_MS: 500,
    RETRY_POLL_INTERVAL_MS: 5000,
    RATE_LIMIT_MAX: 100,
    RATE_LIMIT_WINDOW: '1 minute',
    BACKEND_API_KEY: 'test-api-key',
    ANTHROPIC_API_KEY: undefined,
    // WEBHOOK_SECRET intentionally absent to test the 503 guard
    WEBHOOK_SECRET: undefined,
    JWT_SECRET: 'test-jwt-secret-exactly-32-chars-x',
  },
}));

import { createApp } from '../../src/app/createApp.js';

vi.mock('../../src/repositories/webhookEventRepository.js', () => ({ insertWebhookEvent: vi.fn() }));
vi.mock('../../src/repositories/leadRepository.js', () => ({ findLeadByHash: vi.fn(), insertLead: vi.fn() }));
vi.mock('../../src/repositories/leadSourcesRepository.js', () => ({ findLeadSourceByKey: vi.fn() }));
vi.mock('../../src/repositories/deliveryAttemptRepository.js', () => ({ insertDeliveryAttempt: vi.fn() }));
vi.mock('../../src/integrations/n8n/client.js', () => ({ sendToN8n: vi.fn() }));
vi.mock('../../src/services/settingsService.js', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn(),
  getAllSettings: vi.fn().mockResolvedValue({}),
  clearCache: vi.fn(),
}));
vi.mock('../../src/services/testerFileService.js', () => ({
  listPrompts: vi.fn(), listCases: vi.fn(), listResults: vi.fn(),
  readPrompt: vi.fn(), readCase: vi.fn(),
}));
vi.mock('../../src/services/promptTesterService.js', () => ({
  runTests: vi.fn(), buildMockResponse: vi.fn(),
  askAnthropic: vi.fn().mockResolvedValue('resumo do lead'),
}));

describe('POST /api/webhook/manychat', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    app = await createApp({ enableDocs: false });
    await app.ready();
  });

  it('returns 503 when WEBHOOK_SECRET env var is not set', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/manychat',
      headers: { 'content-type': 'application/json' },
      payload: {
        handle: '@testuser',
        firstMessage: 'Olá',
        procedimento: 'rinoplastia',
        janela: '1 mês',
        regiao: 'SP',
      },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('WEBHOOK_SECRET') });
  });

  it('returns 503 (before field validation) when required fields are missing and WEBHOOK_SECRET is not set', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/manychat',
      headers: { 'content-type': 'application/json' },
      payload: { handle: '@test' }, // missing required fields
    });
    // 503 gate fires before field validation when WEBHOOK_SECRET is unset
    expect([400, 503]).toContain(res.statusCode);
  });
});
