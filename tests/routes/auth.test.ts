import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  runTests: vi.fn(), buildMockResponse: vi.fn(), askAnthropic: vi.fn(),
}));

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../src/db/client.js', () => ({
  pool: { query: mockQuery },
}));

describe('POST /api/auth/register — name maxLength', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createApp({ enableDocs: false });
    await app.ready();
  });

  it('rejects name longer than 100 chars with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'a'.repeat(101), email: 'a@b.com', password: 'password123' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts name of exactly 100 chars', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'a'.repeat(100), email: 'b@c.com', password: 'password123' },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('POST /api/auth/login — timing oracle fix', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createApp({ enableDocs: false });
    await app.ready();
  });

  it('returns 401 for unknown email', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // user not found
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'unknown@example.com', password: 'anypassword' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Email ou senha inválidos.' });
  });
});
