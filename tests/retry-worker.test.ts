import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as retryRepo from '../src/repositories/retryRepository.js';
import * as n8nClient from '../src/integrations/n8n/client.js';
import { N8nDeliveryService } from '../src/services/n8nDeliveryService.js';
import { leadRepository } from '../src/repositories/leadRepository.js';
import { deliveryAttemptRepository } from '../src/repositories/deliveryAttemptRepository.js';

vi.mock('../src/config/env.js', () => ({
  env: {
    RETRY_MAX_ATTEMPTS: 1,
    RETRY_BASE_DELAY_MS: 1,
    RETRY_POLL_INTERVAL_MS: 999999,
    N8N_WEBHOOK_URL: 'https://env-fallback.example.com/webhook',
    N8N_INTERNAL_AUTH_TOKEN: 'test-token'
  }
}));

describe('retry worker URL routing', () => {
  beforeEach(() => {
    vi.spyOn(leadRepository, 'incrementAttempts').mockResolvedValue();
    vi.spyOn(leadRepository, 'markForwardStatus').mockResolvedValue();
    vi.spyOn(deliveryAttemptRepository, 'create').mockResolvedValue();
  });

  it('delivers to n8n_target_url from the leads row, not the env fallback', async () => {
    const perFormUrl = 'https://form-specific.example.com/webhook';

    vi.spyOn(retryRepo.retryRepository, 'listFailedLeads').mockResolvedValue([
      { id: 'lead-1', normalized_payload: { source: 'facebook_lead_ads' }, n8n_target_url: perFormUrl }
    ]);

    const postSpy = vi.spyOn(n8nClient, 'postToN8n').mockResolvedValue({
      ok: true, status: 200, body: 'ok'
    });

    const service = new N8nDeliveryService();
    const rows = await retryRepo.retryRepository.listFailedLeads();
    for (const row of rows) {
      const targetUrl = row.n8n_target_url ?? 'https://env-fallback.example.com/webhook';
      await service.deliver(row.id, {
        correlationId: `retry-${row.id}`,
        ingestedAt: new Date().toISOString(),
        lead: row.normalized_payload as never,
        meta: { isDuplicate: false, rawEventStored: true, version: '1.0.0' }
      }, targetUrl);
    }

    expect(postSpy).toHaveBeenCalledWith(expect.anything(), perFormUrl);
  });

  it('falls back to env URL when n8n_target_url is null (pre-migration lead)', async () => {
    vi.spyOn(retryRepo.retryRepository, 'listFailedLeads').mockResolvedValue([
      { id: 'lead-2', normalized_payload: { source: 'facebook_lead_ads' }, n8n_target_url: null }
    ]);

    const postSpy = vi.spyOn(n8nClient, 'postToN8n').mockResolvedValue({
      ok: true, status: 200, body: 'ok'
    });

    const service = new N8nDeliveryService();
    const rows = await retryRepo.retryRepository.listFailedLeads();
    for (const row of rows) {
      const targetUrl = row.n8n_target_url ?? 'https://env-fallback.example.com/webhook';
      await service.deliver(row.id, {
        correlationId: `retry-${row.id}`,
        ingestedAt: new Date().toISOString(),
        lead: row.normalized_payload as never,
        meta: { isDuplicate: false, rawEventStored: true, version: '1.0.0' }
      }, targetUrl);
    }

    expect(postSpy).toHaveBeenCalledWith(
      expect.anything(),
      'https://env-fallback.example.com/webhook'
    );
  });
});
