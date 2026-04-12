import type { FastifyInstance } from 'fastify';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { loadCases, runTests, buildMockResponse, askAnthropic } from '../services/promptTesterService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const registerTesterRoutes = async (app: FastifyInstance) => {
  app.get('/', async (_request, reply) => {
    const html = await readFile(path.join(__dirname, '..', 'ui.html'), 'utf8');
    return reply.type('text/html').send(html);
  });

  app.get('/api/config', async (_request, reply) => {
    return reply.send({ hasApiKey: !!env.ANTHROPIC_API_KEY });
  });

  app.get('/api/prompts', async (_request, reply) => {
    try {
      const files = await readdir(path.join(process.cwd(), 'prompts'));
      return reply.send(files.filter((f) => f.endsWith('.md')));
    } catch {
      return reply.send([]);
    }
  });

  app.get('/api/cases', async (_request, reply) => {
    try {
      const files = await readdir(path.join(process.cwd(), 'cases'));
      return reply.send(files.filter((f) => f.endsWith('.json')));
    } catch {
      return reply.send([]);
    }
  });

  app.get('/api/results', async (_request, reply) => {
    try {
      const dir = path.join(process.cwd(), 'results');
      const files = await readdir(dir).catch(() => []);
      const items = await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .sort()
          .reverse()
          .slice(0, 30)
          .map(async (f) => {
            const raw = await readFile(path.join(dir, f), 'utf8');
            const { metadata } = JSON.parse(raw) as { metadata: Record<string, unknown> };
            return { file: f, ...metadata };
          }),
      );
      return reply.send(items);
    } catch {
      return reply.send([]);
    }
  });

  app.post('/api/run', async (request, reply) => {
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
        readFile(path.join(process.cwd(), 'prompts', promptFile), 'utf8'),
        loadCases(path.join(process.cwd(), 'cases', casesFile)),
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
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  app.post('/api/chat', async (request, reply) => {
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

    const lastMessage = messages[messages.length - 1].content;

    if (mock) {
      return reply.send({ output: buildMockResponse(lastMessage) });
    }

    try {
      const promptContent = await readFile(path.join(process.cwd(), 'prompts', promptFile), 'utf8');
      const output = await askAnthropic(
        apiKey as string,
        model ?? 'claude-haiku-4-5-20251001',
        promptContent,
        lastMessage,
        220,
        0.3,
      );
      return reply.send({ output });
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });
};
