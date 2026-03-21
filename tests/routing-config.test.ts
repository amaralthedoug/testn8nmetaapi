import { describe, expect, it, vi, afterEach } from 'vitest';
import * as fs from 'fs/promises';

vi.mock('fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs/promises')>();
  return { ...original };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadRoutingConfig', () => {
  it('returns null when routing.json does not exist', async () => {
    vi.spyOn(fs, 'readFile').mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );

    const { loadRoutingConfig } = await import('../src/config/routingConfig.js');
    const result = await loadRoutingConfig();
    expect(result).toBeNull();
  });

  it('returns validated config when routing.json is valid', async () => {
    const valid = JSON.stringify({
      default: { url: 'https://example.com/webhook' },
      pages: []
    });
    vi.spyOn(fs, 'readFile').mockResolvedValue(valid as never);

    const { loadRoutingConfig } = await import('../src/config/routingConfig.js');
    const result = await loadRoutingConfig();
    expect(result).toMatchObject({ default: { url: 'https://example.com/webhook' }, pages: [] });
  });

  it('throws when routing.json exists but fails Zod validation', async () => {
    const invalid = JSON.stringify({ pages: [{ pageId: 123 }] }); // pageId must be string
    vi.spyOn(fs, 'readFile').mockResolvedValue(invalid as never);

    const { loadRoutingConfig } = await import('../src/config/routingConfig.js');
    await expect(loadRoutingConfig()).rejects.toThrow();
  });

  it('throws when routing.json exists but contains invalid JSON', async () => {
    vi.spyOn(fs, 'readFile').mockResolvedValue('not valid json' as never);

    const { loadRoutingConfig } = await import('../src/config/routingConfig.js');
    await expect(loadRoutingConfig()).rejects.toThrow();
  });
});
