import { describe, expect, it } from 'vitest';
import { metaWebhookSchema } from '../src/integrations/meta/schema.js';

describe('metaWebhookSchema', () => {
  it('rejects malformed payload', () => {
    const parsed = metaWebhookSchema.safeParse({ foo: 'bar' });
    expect(parsed.success).toBe(false);
  });

  it('accepts basic payload', () => {
    const parsed = metaWebhookSchema.safeParse({ object: 'page', entry: [] });
    expect(parsed.success).toBe(true);
  });
});
