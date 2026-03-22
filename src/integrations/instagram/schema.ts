import { z } from 'zod';
export const instagramWebhookSchema = z.object({
  source: z.literal('instagram'),
  contractVersion: z.literal('1.0'),
  raw: z.object({ handle: z.string().min(1), instaId: z.string().optional(), firstMessage: z.string().min(1), timestamp: z.string().datetime() }),
  qualified: z.object({ procedimento_interesse: z.string().min(1), janela_decisao: z.string().min(1), regiao: z.string().min(1), contato_whatsapp: z.string().optional(), resumo: z.string().min(1) }),
  processedAt: z.string().datetime()
});
export type InstagramWebhookPayload = z.infer<typeof instagramWebhookSchema>;
