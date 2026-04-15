import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { requireAuth } from '../utils/requireAuth.js';
import { runTests, buildMockResponse, askAnthropic } from '../services/promptTesterService.js';
import {
  listPrompts,
  listCases,
  listResults,
  readPrompt,
  readCase,
} from '../services/testerFileService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const registerTesterRoutes = async (app: FastifyInstance) => {
  // Public — serves the HTML shell; auth is enforced per-API-call
  app.get('/', async (_request, reply) => {
    const html = await readFile(path.join(__dirname, '..', 'ui.html'), 'utf8');
    return reply.type('text/html').send(html);
  });

  app.get('/api/config', async (request, reply) => {
    if (!(await requireAuth(app, request, reply))) return;
    return reply.send({ hasApiKey: !!env.ANTHROPIC_API_KEY });
  });

  app.get('/api/prompts', async (request, reply) => {
    if (!(await requireAuth(app, request, reply))) return;
    return reply.send(await listPrompts());
  });

  app.get('/api/cases', async (request, reply) => {
    if (!(await requireAuth(app, request, reply))) return;
    return reply.send(await listCases());
  });

  app.get('/api/results', async (request, reply) => {
    if (!(await requireAuth(app, request, reply))) return;
    return reply.send(await listResults());
  });

  app.post('/api/run', async (request, reply) => {
    if (!(await requireAuth(app, request, reply))) return;

    const { prompt: promptFile, cases: casesFile, mock, apiKey: bodyApiKey, model } = request.body as {
      prompt: string;
      cases: string;
      mock: boolean;
      apiKey?: string;
      model?: string;
    };

    const apiKey = bodyApiKey ?? env.ANTHROPIC_API_KEY;

    if (!mock && !apiKey) {
      return reply.status(400).send({ error: 'API Key obrigatória no modo real.' });
    }

    try {
      const [promptContent, cases] = await Promise.all([
        readPrompt(promptFile),
        readCase(casesFile),
      ]);

      const results = await runTests({ promptContent, casesFile: cases, mock, apiKey, model });
      const passed = results.filter((r) => r.pass).length;

      return reply.send({
        results,
        passed,
        total: results.length,
        score: Number(((passed / results.length) * 100).toFixed(1)),
        client: cases.client,
        niche: cases.niche,
      });
    } catch (err) {
      // SECURITY: Do not expose internal paths or provider details in production
      const message = env.NODE_ENV === 'production'
        ? 'Erro ao executar testes.'
        : (err as Error).message;
      return reply.status(500).send({ error: message });
    }
  });

  app.post('/api/chat', async (request, reply) => {
    if (!(await requireAuth(app, request, reply))) return;

    const { prompt: promptFile, messages, mock, apiKey: bodyApiKey, model } = request.body as {
      prompt: string;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      mock: boolean;
      apiKey?: string;
      model?: string;
    };

    const apiKey = bodyApiKey ?? env.ANTHROPIC_API_KEY;

    if (!mock && !apiKey) {
      return reply.status(400).send({ error: 'API Key obrigatória no modo real.' });
    }

    if (!messages || messages.length === 0) {
      return reply.status(400).send({ error: 'messages não pode ser vazio.' });
    }

    const lastMessage = messages[messages.length - 1].content;

    if (mock) {
      return reply.send({ output: buildMockResponse(lastMessage) });
    }

    try {
      const promptContent = await readPrompt(promptFile);
      const output = await askAnthropic(
        apiKey,
        model ?? 'claude-haiku-4-5-20251001',
        promptContent,
        lastMessage,
        220,
        0.3,
      );
      return reply.send({ output });
    } catch (err) {
      // SECURITY: Do not expose internal paths or provider details in production
      const message = env.NODE_ENV === 'production'
        ? 'Erro ao processar chat.'
        : (err as Error).message;
      return reply.status(500).send({ error: message });
    }
  });
};
