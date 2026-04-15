import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getSetting, setSetting, getAllSettings, clearCache } from '../services/settingsService.js';
import { askLLM } from '../services/llmService.js';
import { requireAuth } from '../utils/requireAuth.js';
import { env } from '../config/env.js';
import { pool } from '../db/client.js';

const SENSITIVE_KEYS = new Set([
  'llm_api_key', 'meta_app_secret',
  'llm_api_key_anthropic', 'llm_api_key_openai',
  'llm_api_key_gemini', 'llm_api_key_openrouter'
]);
const MASKED = '***';

// SECURITY: Only these keys may be written via the settings API.
// Adding a new setting here is a deliberate decision — prevents arbitrary key injection.
const WRITABLE_SETTINGS = new Set([
  'meta_verify_token',
  'meta_app_secret',
  'llm_provider',
  'llm_api_key',
  'llm_model',
  'llm_api_key_anthropic',
  'llm_api_key_openai',
  'llm_api_key_gemini',
  'llm_api_key_openrouter',
]);

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

  // PUT /api/settings — upsert allowed keys only
  app.put('/api/settings', async (req, reply) => {
    if (!(await requireAuth(app, req, reply))) return;
    const body = putBodySchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Payload inválido.' });

    for (const key of Object.keys(body.data)) {
      if (!WRITABLE_SETTINGS.has(key)) {
        return reply.status(400).send({ error: `Chave não permitida: ${key}` });
      }
    }

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
        temperature: 0
      });
      // BUSINESS RULE: also persist per-provider key so the wizard can skip re-test on return
      await setSetting(`llm_api_key_${body.data.provider}`, body.data.api_key);
      return reply.send({ ok: true, message: 'Conexão OK' });
    } catch (err) {
      if (prevProvider) { await setSetting('llm_provider', prevProvider); } else { await pool.query("DELETE FROM settings WHERE key = 'llm_provider'"); }
      if (prevKey) { await setSetting('llm_api_key', prevKey); } else { await pool.query("DELETE FROM settings WHERE key = 'llm_api_key'"); }
      if (prevModel) { await setSetting('llm_model', prevModel); } else { await pool.query("DELETE FROM settings WHERE key = 'llm_model'"); }
      clearCache();
      const msg = err instanceof Error ? err.message : 'Erro desconhecido.';
      return reply.status(400).send({ ok: false, message: msg });
    }
  });
}
