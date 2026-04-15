import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../../src/app/createApp.js';

vi.mock('../../src/services/testerFileService.js', () => ({
  listPrompts: vi.fn().mockResolvedValue(['prompt1.md']),
  listCases: vi.fn().mockResolvedValue(['cases1.json']),
  listResults: vi.fn().mockResolvedValue([]),
  readPrompt: vi.fn().mockResolvedValue('You are a test assistant.'),
  readCase: vi.fn().mockResolvedValue({ client: 'test', niche: 'test', cases: [{ input: 'hi', expected: 'hello' }] }),
}));

vi.mock('../../src/services/promptTesterService.js', () => ({
  runTests: vi.fn().mockResolvedValue([{ pass: true, input: 'hi', expected: 'hello', output: 'hello' }]),
  buildMockResponse: vi.fn().mockReturnValue('mock response'),
  askAnthropic: vi.fn().mockResolvedValue('ok'),
}));

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

const PROTECTED_ENDPOINTS = [
  { method: 'GET' as const, url: '/api/config' },
  { method: 'GET' as const, url: '/api/prompts' },
  { method: 'GET' as const, url: '/api/cases' },
  { method: 'GET' as const, url: '/api/results' },
  { method: 'POST' as const, url: '/api/run' },
  { method: 'POST' as const, url: '/api/chat' },
];

describe('Tester routes — authentication enforcement', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    app = await createApp({ enableDocs: false });
    await app.ready();
  });

  for (const { method, url } of PROTECTED_ENDPOINTS) {
    it(`${method} ${url} returns 401 without auth cookie`, async () => {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
    });
  }

  it('GET /api/prompts returns 200 with valid JWT cookie', async () => {
    const token = app.jwt.sign({ id: 1, email: 'a@b.com' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/prompts',
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
  });
});
