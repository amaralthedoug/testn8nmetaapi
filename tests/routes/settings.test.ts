import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../../src/app/createApp.js';

vi.mock('../../src/repositories/webhookEventRepository.js', () => ({ insertWebhookEvent: vi.fn() }));
vi.mock('../../src/repositories/leadRepository.js', () => ({ findLeadByHash: vi.fn(), insertLead: vi.fn() }));
vi.mock('../../src/repositories/leadSourcesRepository.js', () => ({ findLeadSourceByKey: vi.fn() }));
vi.mock('../../src/repositories/deliveryAttemptRepository.js', () => ({ insertDeliveryAttempt: vi.fn() }));
vi.mock('../../src/integrations/n8n/client.js', () => ({ sendToN8n: vi.fn() }));
vi.mock('../../src/services/promptTesterService.js', () => ({
  runTests: vi.fn(), buildMockResponse: vi.fn(), askAnthropic: vi.fn(),
}));
vi.mock('../../src/services/testerFileService.js', () => ({
  listPrompts: vi.fn(), listCases: vi.fn(), listResults: vi.fn(),
  readPrompt: vi.fn(), readCase: vi.fn(),
}));

// REASON: vi.hoisted ensures these refs are available when vi.mock factories are hoisted to top of file
const { mockSetSetting, mockGetAllSettings } = vi.hoisted(() => ({
  mockSetSetting: vi.fn().mockResolvedValue(undefined),
  mockGetAllSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/services/settingsService.js', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: mockSetSetting,
  getAllSettings: mockGetAllSettings,
  clearCache: vi.fn(),
}));

describe('PUT /api/settings — allowlist enforcement', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createApp({ enableDocs: false });
    await app.ready();
    token = app.jwt.sign({ id: 1, email: 'a@b.com' });
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { 'content-type': 'application/json' },
      payload: { meta_verify_token: 'abc12345' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('saves allowed key meta_verify_token', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { 'content-type': 'application/json' },
      cookies: { token },
      payload: { meta_verify_token: 'abc12345' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockSetSetting).toHaveBeenCalledWith('meta_verify_token', 'abc12345');
  });

  it('saves allowed key meta_app_secret', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { 'content-type': 'application/json' },
      cookies: { token },
      payload: { meta_app_secret: 'supersecret' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockSetSetting).toHaveBeenCalledWith('meta_app_secret', 'supersecret');
  });

  it('rejects disallowed key setup_complete with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { 'content-type': 'application/json' },
      cookies: { token },
      payload: { setup_complete: 'false' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('setup_complete') });
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it('rejects arbitrary injected key with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { 'content-type': 'application/json' },
      cookies: { token },
      payload: { malicious_key: 'value' },
    });
    expect(res.statusCode).toBe(400);
    expect(mockSetSetting).not.toHaveBeenCalled();
  });
});
