import { describe, expect, it } from 'vitest';
import { buildLeadHash } from '../src/utils/hash.js';

describe('dedupe hash strategy', () => {
  it('uses external id when present', () => {
    expect(buildLeadHash({ externalLeadId: '123', source: 'facebook_lead_ads' })).toBe('external:123');
  });

  it('builds deterministic fallback hash', () => {
    const a = buildLeadHash({ email: 'a@b.com', phone: '1', formId: 'f', createdTime: '2020-01-01T00:00:00Z', source: 'facebook_lead_ads' });
    const b = buildLeadHash({ email: 'a@b.com', phone: '1', formId: 'f', createdTime: '2020-01-01T00:00:00Z', source: 'facebook_lead_ads' });
    expect(a).toBe(b);
  });

  it('builds hash for instagram lead using handle as external id', () => {
    const hash = buildLeadHash({ externalLeadId: '@joao_silva', source: 'instagram' });
    expect(hash).toBe('external:@joao_silva');
  });
});
