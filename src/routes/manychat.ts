import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { askAnthropic } from '../services/promptTesterService.js';

export const registerManychatRoutes = async (app: FastifyInstance) => {
  app.post('/api/webhook/manychat', async (request, reply) => {
    const secret = request.headers['x-webhook-secret'] as string | undefined;
    if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { handle, instaId, firstMessage, procedimento, janela, regiao, whatsapp } = request.body as {
      handle: string;
      instaId?: string;
      firstMessage: string;
      procedimento: string;
      janela: string;
      regiao: string;
      whatsapp?: string;
    };

    if (!handle || !firstMessage || !procedimento || !janela || !regiao) {
      return reply.status(400).send({
        error: 'Campos obrigatórios: handle, firstMessage, procedimento, janela, regiao',
      });
    }

    let resumo: string;
    if (env.ANTHROPIC_API_KEY) {
      const system = 'Você gera resumos concisos de leads qualificados para uma clínica. Responda em português, máximo 2 frases diretas, sem saudação.';
      const user = `Handle: ${handle}. Procedimento: ${procedimento}. Janela de decisão: ${janela}. Região: ${regiao}. WhatsApp: ${whatsapp ?? 'não informado'}. Primeira mensagem: "${firstMessage}".`;
      resumo = await askAnthropic(env.ANTHROPIC_API_KEY, 'claude-haiku-4-5-20251001', system, user, 150, 0.3);
    } else {
      resumo = `Lead interessado em ${procedimento}, janela de decisão: ${janela}, região: ${regiao}.`;
    }

    const now = new Date().toISOString();
    const payload = {
      source: 'instagram',
      contractVersion: '1.0',
      raw: { handle, instaId, firstMessage, timestamp: now },
      qualified: {
        procedimento_interesse: procedimento,
        janela_decisao: janela,
        regiao,
        contato_whatsapp: whatsapp,
        resumo,
      },
      processedAt: now,
    };

    const result = await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.BACKEND_API_KEY,
        'x-correlation-id': randomUUID(),
      },
      payload,
    });

    if (result.statusCode === 202 || result.statusCode === 200) {
      return reply.send({ ok: true });
    }

    return reply.status(result.statusCode).send({ error: `Backend rejeitou lead: ${result.statusCode}` });
  });
};
