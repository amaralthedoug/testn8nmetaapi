import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getSetting, setSetting, getAllSettings, clearCache } from '../services/settingsService.js';
import { askLLM } from '../services/llmService.js';
import { env } from '../config/env.js';
import { pool } from '../db/client.js';

const SENSITIVE_KEYS = new Set(['llm_api_key', 'meta_app_secret']);
const MASKED = '***';

async function requireAuth(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const cookies = (req as unknown as { cookies: Record<string, string> }).cookies;
  const token = cookies['token'];
  if (!token) {
    await reply.status(401).send({ error: 'Não autenticado.' });
    return false;
  }
  try {
    app.jwt.verify(token);
    return true;
  } catch {
    await reply.status(401).send({ error: 'Sessão expirada.' });
    return false;
  }
}

const putBodySchema = z.record(z.string(), z.string());

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/settings — returns all settings with sensitive values masked
  app.get('/api/settings', async (req, reply) => {
    if (!(await requireAuth(app, req, reply))) return;
    const all = await getAllSettings();
    const masked: Record<string, string> = {};
    for (const [k, v] of Object.entries(all)) {
      masked[k] = SENSITIVE_KEYS.has(k) ? MASKED : v;
    }
    return reply.send(masked);
  });

  // PUT /api/settings — upsert one or more keys
  app.put('/api/settings', async (req, reply) => {
    if (!(await requireAuth(app, req, reply))) return;
    const body = putBodySchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Payload inválido.' });
    for (const [key, value] of Object.entries(body.data)) {
      await setSetting(key, value);
    }
    return reply.send({ message: 'Salvo.' });
  });

  // POST /api/setup/test-llm — validate LLM credentials before wizard advances
  app.post('/api/setup/test-llm', async (req, reply) => {
    if (!(await requireAuth(app, req, reply))) return;

    const body = z.object({
      provider: z.enum(['anthropic', 'openai', 'gemini', 'openrouter']),
      api_key: z.string().min(1),
      model: z.string().min(1)
    }).safeParse(req.body);

    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos.' });

    // Save previous values so we can restore on failure
    const prevProvider = await getSetting('llm_provider');
    const prevKey = await getSetting('llm_api_key');
    const prevModel = await getSetting('llm_model');

    await setSetting('llm_provider', body.data.provider);
    await setSetting('llm_api_key', body.data.api_key);
    await setSetting('llm_model', body.data.model);

    try {
      await askLLM({
        system: 'You are a test assistant.',
        user: 'Reply with exactly: OK',
        maxTokens: 50,
        temperature: 0
      });
      return reply.send({ ok: true, message: 'Conexão OK' });
    } catch (err) {
      // Restore previous values (or delete if there were none)
      if (prevProvider) { await setSetting('llm_provider', prevProvider); } else { await pool.query("DELETE FROM settings WHERE key = 'llm_provider'"); }
      if (prevKey) { await setSetting('llm_api_key', prevKey); } else { await pool.query("DELETE FROM settings WHERE key = 'llm_api_key'"); }
      if (prevModel) { await setSetting('llm_model', prevModel); } else { await pool.query("DELETE FROM settings WHERE key = 'llm_model'"); }
      clearCache();
      const msg = err instanceof Error ? err.message : 'Erro desconhecido.';
      return reply.status(400).send({ ok: false, message: msg });
    }
  });
}
