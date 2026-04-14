import { describe, expect, it } from 'vitest';
import { resolveRoute } from '../src/routing/resolveRoute.js';
import type { RoutingConfig } from '../src/routing/config.js';
import { applyFieldMap } from '../src/routing/applyFieldMap.js';
import type { NormalizedLead } from '../src/types/domain.js';

const ENV_URL = 'https://env.example.com/webhook';

const config: RoutingConfig = {
  default: { url: 'https://default.example.com/webhook' },
  pages: [
    {
      pageId: 'page-1',
      url: 'https://page1.example.com/webhook',
      forms: [
        {
          formId: 'form-1',
          url: 'https://form1.example.com/webhook',
          fieldMap: { 'mobile phone': 'phone' }
        }
      ]
    }
  ]
};

describe('resolveRoute', () => {
  it('matches by formId and returns form URL and fieldMap', () => {
    const result = resolveRoute('form-1', 'page-1', config, ENV_URL);
    expect(result.url).toBe('https://form1.example.com/webhook');
    expect(result.fieldMap).toEqual({ 'mobile phone': 'phone' });
    expect(result.source).toBe('form');
  });

  it('falls back to page URL when formId has no config', () => {
    const result = resolveRoute('unknown-form', 'page-1', config, ENV_URL);
    expect(result.url).toBe('https://page1.example.com/webhook');
    expect(result.fieldMap).toEqual({});
    expect(result.source).toBe('page');
  });

  it('falls back to default URL when pageId has no config', () => {
    const result = resolveRoute('unknown-form', 'unknown-page', config, ENV_URL);
    expect(result.url).toBe('https://default.example.com/webhook');
    expect(result.fieldMap).toEqual({});
    expect(result.source).toBe('default');
  });

  it('falls back to env URL when no default is configured', () => {
    const noDefault: RoutingConfig = { pages: [] };
    const result = resolveRoute('unknown-form', 'unknown-page', noDefault, ENV_URL);
    expect(result.url).toBe(ENV_URL);
    expect(result.fieldMap).toEqual({});
    expect(result.source).toBe('env');
  });

  it('falls back to env URL when config is null', () => {
    const result = resolveRoute('form-1', 'page-1', null, ENV_URL);
    expect(result.url).toBe(ENV_URL);
    expect(result.source).toBe('env');
  });

  it('handles undefined formId and pageId gracefully', () => {
    const result = resolveRoute(undefined, undefined, config, ENV_URL);
    expect(result.url).toBe('https://default.example.com/webhook');
    expect(result.source).toBe('default');
  });
});

describe('applyFieldMap', () => {
  const baseLead: NormalizedLead = {
    source: 'facebook_lead_ads',
    rawCustomFields: {
      'mobile phone': '11999999999',
      'budget range': '50k-100k',
      'some other field': 'value'
    }
  };

  it('promotes rawCustomFields entries to typed lead fields', () => {
    const result = applyFieldMap(baseLead, {
      'mobile phone': 'phone',
      'budget range': 'budgetRange'
    });
    expect(result.phone).toBe('11999999999');
    expect(result.budgetRange).toBe('50k-100k');
  });

  it('removes promoted keys from rawCustomFields', () => {
    const result = applyFieldMap(baseLead, { 'mobile phone': 'phone' });
    expect(result.rawCustomFields).not.toHaveProperty('mobile phone');
    expect(result.rawCustomFields).toHaveProperty('some other field');
  });

  it('does not mutate the original lead', () => {
    applyFieldMap(baseLead, { 'mobile phone': 'phone' });
    expect(baseLead.phone).toBeUndefined();
    expect(baseLead.rawCustomFields).toHaveProperty('mobile phone');
  });

  it('does not overwrite a field already set by the Meta payload', () => {
    const leadWithPhone: NormalizedLead = { ...baseLead, phone: '+5511888888888' };
    const result = applyFieldMap(leadWithPhone, { 'mobile phone': 'phone' });
    expect(result.phone).toBe('+5511888888888');
  });

  it('skips rawCustomFields values that are not strings', () => {
    const leadWithNonString: NormalizedLead = {
      source: 'facebook_lead_ads',
      rawCustomFields: { score: 42, tags: ['a', 'b'] }
    };
    const result = applyFieldMap(leadWithNonString as never, {
      score: 'productInterest' as never,
      tags: 'budgetRange' as never
    });
    expect(result.productInterest).toBeUndefined();
    expect(result.budgetRange).toBeUndefined();
  });

  it('returns original lead unchanged when fieldMap is empty', () => {
    const result = applyFieldMap(baseLead, {});
    expect(result).toEqual(baseLead);
  });

  it('silently skips fieldMap keys absent from rawCustomFields', () => {
    const result = applyFieldMap(baseLead, { 'nonexistent key': 'phone' });
    expect(result.phone).toBeUndefined();
  });
});
