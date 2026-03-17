import { describe, expect, it } from 'vitest';
import { normalizeMetaPayload } from '../src/integrations/meta/normalizer.js';

describe('normalizeMetaPayload', () => {
  it('normalizes and maps leadgen fields', () => {
    const leads = normalizeMetaPayload({
      object: 'page',
      entry: [
        {
          id: 'page_1',
          changes: [
            {
              field: 'leadgen',
              value: {
                leadgen_id: 'lead_1',
                phone_number: ' +1 (222) 333-4444 ',
                email: 'TEST@Example.com ',
                created_time: 1700000000
              }
            }
          ]
        }
      ]
    });

    expect(leads[0].externalLeadId).toBe('lead_1');
    expect(leads[0].email).toBe('test@example.com');
    expect(leads[0].phone).toBe('+12223334444');
    expect(leads[0].source).toBe('facebook_lead_ads');
  });
});
