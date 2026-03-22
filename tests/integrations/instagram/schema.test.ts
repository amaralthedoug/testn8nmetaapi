import { describe, expect, it } from 'vitest';
import { instagramWebhookSchema } from '../../../src/integrations/instagram/schema.js';

const validPayload = {
  source: 'instagram', contractVersion: '1.0',
  raw: { handle: '@joao_silva', firstMessage: 'Quero saber sobre limpeza de pele', timestamp: '2026-03-22T10:00:00.000Z' },
  qualified: { procedimento_interesse: 'Limpeza de pele', janela_decisao: 'até 30 dias', regiao: 'São Paulo', resumo: 'Lead qualificado' },
  processedAt: '2026-03-22T10:01:00.000Z'
};

describe('instagramWebhookSchema', () => {
  it('accepts a valid payload', () => { expect(instagramWebhookSchema.safeParse(validPayload).success).toBe(true); });
  it('rejects missing handle', () => { expect(instagramWebhookSchema.safeParse({ ...validPayload, raw: { ...validPayload.raw, handle: undefined } }).success).toBe(false); });
  it('rejects invalid timestamp', () => { expect(instagramWebhookSchema.safeParse({ ...validPayload, raw: { ...validPayload.raw, timestamp: 'not-a-date' } }).success).toBe(false); });
  it('rejects unknown contractVersion', () => { expect(instagramWebhookSchema.safeParse({ ...validPayload, contractVersion: '9.9' }).success).toBe(false); });
  it('rejects wrong source', () => { expect(instagramWebhookSchema.safeParse({ ...validPayload, source: 'facebook' }).success).toBe(false); });
});
