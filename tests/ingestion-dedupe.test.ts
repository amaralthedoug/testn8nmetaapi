import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadIngestionService } from '../src/services/leadIngestionService.js';
import { webhookEventRepository } from '../src/repositories/webhookEventRepository.js';
import { leadRepository } from '../src/repositories/leadRepository.js';

describe('LeadIngestionService dedupe', () => {
  beforeEach(() => {
    vi.spyOn(webhookEventRepository, 'create').mockResolvedValue('event-id');
    vi.spyOn(webhookEventRepository, 'updateStatus').mockResolvedValue();
    vi.spyOn(leadRepository, 'findByHash').mockResolvedValue({ id: 'existing' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks duplicate and skips create', async () => {
    const createSpy = vi.spyOn(leadRepository, 'create');
    const service = new LeadIngestionService({ deliver: vi.fn() } as never);

    const result = await service.ingest({
      correlationId: 'cid',
      headers: {},
      payload: {
        object: 'page',
        entry: [{ id: 'p1', changes: [{ field: 'leadgen', value: { leadgen_id: 'x' } }] }]
      }
    });

    expect(result.accepted).toBe(true);
    expect(createSpy).not.toHaveBeenCalled();
    expect(webhookEventRepository.updateStatus).toHaveBeenCalledWith('event-id', 'duplicate');
  });
});
