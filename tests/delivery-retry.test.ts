import { beforeEach, describe, expect, it, vi } from 'vitest';
import { N8nDeliveryService } from '../src/services/n8nDeliveryService.js';
import { leadRepository } from '../src/repositories/leadRepository.js';
import { deliveryAttemptRepository } from '../src/repositories/deliveryAttemptRepository.js';
import * as n8nClient from '../src/integrations/n8n/client.js';

vi.mock('../src/config/env.js', () => ({
  env: {
    RETRY_MAX_ATTEMPTS: 3,
    RETRY_BASE_DELAY_MS: 1
  }
}));

describe('N8nDeliveryService', () => {
  beforeEach(() => {
    vi.spyOn(leadRepository, 'incrementAttempts').mockResolvedValue();
    vi.spyOn(leadRepository, 'markForwardStatus').mockResolvedValue();
    vi.spyOn(deliveryAttemptRepository, 'create').mockResolvedValue();
  });

  it('retries then succeeds', async () => {
    const postSpy = vi.spyOn(n8nClient, 'postToN8n')
      .mockResolvedValueOnce({ ok: false, status: 503, body: 'unavailable' })
      .mockResolvedValueOnce({ ok: true, status: 200, body: 'ok' });

    const service = new N8nDeliveryService();
    await service.deliver('lead-id', {
      correlationId: 'c1',
      ingestedAt: new Date().toISOString(),
      lead: { source: 'facebook_lead_ads' },
      meta: { isDuplicate: false, rawEventStored: true, version: '1.0.0' }
    });

    expect(postSpy).toHaveBeenCalledTimes(2);
  });
});
