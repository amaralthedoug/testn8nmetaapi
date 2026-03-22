import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createApp } from '../../../src/app/createApp.js';
import { webhookEventRepository } from '../../../src/repositories/webhookEventRepository.js';
import { leadRepository } from '../../../src/repositories/leadRepository.js';
import { leadSourcesRepository } from '../../../src/repositories/leadSourcesRepository.js';

const validPayload = {
  source: 'instagram', contractVersion: '1.0',
  raw: { handle: '@maria_test', firstMessage: 'Quero botox', timestamp: '2026-03-22T10:00:00.000Z' },
  qualified: { procedimento_interesse: 'Botox', janela_decisao: '15 dias', regiao: 'Rio de Janeiro', resumo: 'Qualificado' },
  processedAt: '2026-03-22T10:01:00.000Z'
};

describe('POST /webhooks/v1/leads', () => {
  beforeEach(() => {
    vi.spyOn(webhookEventRepository, 'create').mockResolvedValue('event-id-1');
    vi.spyOn(webhookEventRepository, 'updateStatus').mockResolvedValue();
    vi.spyOn(leadRepository, 'findByHash').mockResolvedValue(null);
    vi.spyOn(leadRepository, 'create').mockResolvedValue('lead-id-1');
    vi.spyOn(leadSourcesRepository, 'findByName').mockResolvedValue({ id: 'source-id-1', name: 'instagram', contractVersion: '1.0', mapperVersion: '1.0' });
  });

  it('returns 401 when X-Api-Key is missing', async () => {
    const app = await createApp(); await app.ready();
    const res = await app.inject({ method: 'POST', url: '/webhooks/v1/leads', payload: validPayload });
    expect(res.statusCode).toBe(401);
    expect(res.json().reason).toBe('invalid_api_key');
  });

  it('returns 401 when X-Api-Key is wrong', async () => {
    const app = await createApp(); await app.ready();
    const res = await app.inject({ method: 'POST', url: '/webhooks/v1/leads', headers: { 'x-api-key': 'wrong' }, payload: validPayload });
    expect(res.statusCode).toBe(401);
  });

  it('returns 202 for valid new lead', async () => {
    const app = await createApp(); await app.ready();
    const res = await app.inject({ method: 'POST', url: '/webhooks/v1/leads', headers: { 'x-api-key': 'test-api-key' }, payload: validPayload });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('accepted');
    expect(res.json().leadId).toBe('lead-id-1');
  });

  it('returns 200 for duplicate lead', async () => {
    vi.spyOn(leadRepository, 'findByHash').mockResolvedValue({ id: 'existing-id' });
    const app = await createApp(); await app.ready();
    const res = await app.inject({ method: 'POST', url: '/webhooks/v1/leads', headers: { 'x-api-key': 'test-api-key' }, payload: validPayload });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('duplicate');
  });

  it('returns 400 for unknown contractVersion', async () => {
    const app = await createApp(); await app.ready();
    const res = await app.inject({ method: 'POST', url: '/webhooks/v1/leads', headers: { 'x-api-key': 'test-api-key' }, payload: { ...validPayload, contractVersion: '9.9' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().reason).toContain('unsupported_contract');
  });

  it('returns 400 for missing required fields', async () => {
    const app = await createApp(); await app.ready();
    const res = await app.inject({ method: 'POST', url: '/webhooks/v1/leads', headers: { 'x-api-key': 'test-api-key' }, payload: { source: 'instagram', contractVersion: '1.0' } });
    expect(res.statusCode).toBe(400);
  });

  it('always persists raw event even for duplicate', async () => {
    vi.spyOn(leadRepository, 'findByHash').mockResolvedValue({ id: 'existing-id' });
    const createSpy = vi.spyOn(webhookEventRepository, 'create').mockResolvedValue('event-dup');
    const app = await createApp(); await app.ready();
    await app.inject({ method: 'POST', url: '/webhooks/v1/leads', headers: { 'x-api-key': 'test-api-key' }, payload: validPayload });
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ provider: 'instagram', eventType: 'lead_qualified' }));
  });

  it('returns 500 when raw event persistence fails', async () => {
    vi.spyOn(webhookEventRepository, 'create').mockRejectedValue(new Error('DB down'));
    const app = await createApp(); await app.ready();
    const res = await app.inject({ method: 'POST', url: '/webhooks/v1/leads', headers: { 'x-api-key': 'test-api-key' }, payload: validPayload });
    expect(res.statusCode).toBe(500);
    expect(res.json().reason).toBe('internal_error');
  });
});
