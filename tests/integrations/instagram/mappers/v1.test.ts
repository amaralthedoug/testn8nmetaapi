import { describe, expect, it } from 'vitest';
import { mapInstagramPayloadV1 } from '../../../../src/integrations/instagram/mappers/v1.js';

const base = { source: 'instagram', contractVersion: '1.0', raw: { handle: '@joao_silva', firstMessage: 'msg', timestamp: '2026-03-22T10:00:00.000Z' }, qualified: { procedimento_interesse: 'Botox', janela_decisao: '30 dias', regiao: 'SP', resumo: 'ok' }, processedAt: '2026-03-22T10:01:00.000Z' };

describe('mapInstagramPayloadV1', () => {
  it('maps handle to externalLeadId', () => { expect(mapInstagramPayloadV1(base).externalLeadId).toBe('@joao_silva'); });
  it('maps procedimento to productInterest', () => { expect(mapInstagramPayloadV1(base).productInterest).toBe('Botox'); });
  it('maps janela to purchaseTimeline', () => { expect(mapInstagramPayloadV1(base).purchaseTimeline).toBe('30 dias'); });
  it('maps regiao to city', () => { expect(mapInstagramPayloadV1(base).city).toBe('SP'); });
  it('maps contato_whatsapp to phone when present', () => { expect(mapInstagramPayloadV1({ ...base, qualified: { ...base.qualified, contato_whatsapp: '+55119999' } }).phone).toBe('+55119999'); });
  it('leaves phone undefined when absent', () => { expect(mapInstagramPayloadV1(base).phone).toBeUndefined(); });
  it('sets source to instagram', () => { expect(mapInstagramPayloadV1(base).source).toBe('instagram'); });
  it('stores resumo in rawCustomFields', () => { expect(mapInstagramPayloadV1(base).rawCustomFields?.resumo).toBe('ok'); });
  it('throws on invalid payload', () => { expect(() => mapInstagramPayloadV1({ source: 'instagram' })).toThrow(); });
});
