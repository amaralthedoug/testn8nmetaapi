import { describe, expect, it } from 'vitest';
import { resolveRoute } from '../src/routing/resolveRoute.js';
import type { RoutingConfig } from '../src/config/routingConfig.js';

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
