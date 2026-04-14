import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing the service
vi.mock('../src/db/client.js', () => ({
  pool: {
    query: vi.fn()
  }
}));

import { pool } from '../src/db/client.js';
import { getSetting, setSetting, getAllSettings, clearCache } from '../src/services/settingsService.js';

const mockQuery = vi.mocked(pool.query);

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
});

describe('getSetting', () => {
  it('returns value from DB on first call', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'anthropic' }] } as never);
    const result = await getSetting('llm_provider');
    expect(result).toBe('anthropic');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns cached value on second call without hitting DB', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'anthropic' }] } as never);
    await getSetting('llm_provider');
    await getSetting('llm_provider');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when key not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const result = await getSetting('missing_key');
    expect(result).toBeUndefined();
  });
});

describe('getSetting — TTL expiry', () => {
  it('re-queries DB after cache entry expires', async () => {
    vi.useFakeTimers();

    mockQuery
      .mockResolvedValueOnce({ rows: [{ value: 'old' }] } as never)
      .mockResolvedValueOnce({ rows: [{ value: 'new' }] } as never);

    await getSetting('llm_provider');          // prime cache
    vi.advanceTimersByTime(61_000);            // advance past 60s TTL
    const result = await getSetting('llm_provider'); // should re-query

    expect(result).toBe('new');
    expect(mockQuery).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});

describe('setSetting', () => {
  it('upserts value and invalidates cache', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ value: 'old' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ value: 'new' }] } as never);

    await getSetting('llm_provider'); // prime cache
    await setSetting('llm_provider', 'openai'); // should clear cache
    const result = await getSetting('llm_provider'); // should re-query

    expect(result).toBe('new');
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });
});

describe('getAllSettings', () => {
  it('returns all rows as a key-value record', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { key: 'llm_provider', value: 'anthropic' },
        { key: 'setup_complete', value: 'true' }
      ]
    } as never);

    const result = await getAllSettings();
    expect(result).toEqual({ llm_provider: 'anthropic', setup_complete: 'true' });
  });
});
