import type { NormalizedLead } from '../../../types/domain.js';
import { instagramWebhookSchema } from '../schema.js';

export const mapInstagramPayloadV1 = (raw: unknown): NormalizedLead => {
  const payload = instagramWebhookSchema.parse(raw);
  return {
    source: 'instagram',
    externalLeadId: payload.raw.handle,
    phone: payload.qualified.contato_whatsapp,
    city: payload.qualified.regiao,
    productInterest: payload.qualified.procedimento_interesse,
    purchaseTimeline: payload.qualified.janela_decisao,
    rawCustomFields: { resumo: payload.qualified.resumo, firstMessage: payload.raw.firstMessage, instaId: payload.raw.instaId }
  };
};
