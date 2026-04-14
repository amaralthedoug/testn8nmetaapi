# Engineering Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize file structure, remove redundant layers, fix known bugs, and improve internal patterns — zero external behavior change.

**Architecture:** Bottom-up execution: create shared foundations first (errors, LLM abstraction), then fix bugs, then reorganize files (moves + merges), then finalize app wiring. Each task ends with a green test suite and a commit.

**Tech Stack:** Node.js, TypeScript ESM, Fastify v4, Zod, Vitest, pg

---

## File Map

| Action | Path |
|---|---|
| Create | `src/types/errors.ts` |
| Create | `src/integrations/llm/types.ts` |
| Create | `src/integrations/llm/utils.ts` |
| Create | `src/integrations/llm/anthropic.ts` |
| Create | `src/integrations/llm/openai.ts` |
| Create | `src/integrations/llm/gemini.ts` |
| Create | `src/integrations/llm/openrouter.ts` |
| Create | `src/integrations/llm/registry.ts` |
| Create | `src/services/testerFileService.ts` |
| Create | `src/app/plugins.ts` |
| Create | `src/integrations/meta/schema.ts` |
| Create | `src/integrations/meta/routes.ts` |
| Create | `src/routing/config.ts` |
| Modify | `src/services/llmService.ts` |
| Modify | `src/services/settingsService.ts` |
| Modify | `src/services/promptTesterService.ts` |
| Modify | `src/services/authService.ts` |
| Modify | `src/services/leadIngestionService.ts` |
| Modify | `src/routes/tester.ts` |
| Modify | `src/routes/webhooks/unified.ts` |
| Modify | `src/integrations/meta/normalizer.ts` |
| Modify | `src/app/createApp.ts` |
| Modify | `tests/settingsService.test.ts` |
| Modify | `tests/ingestion-routing.test.ts` |
| Modify | `tests/routing.test.ts` |
| Modify | `tests/routing-config.test.ts` |
| Modify | `tests/validation.test.ts` |
| Delete | `src/schemas/metaWebhook.ts` |
| Delete | `src/config/routingConfig.ts` |
| Delete | `src/routes/meta.ts` |
| Delete | `src/controllers/metaWebhookController.ts` |
| Delete | `src/controllers/unifiedWebhookController.ts` |
| Delete | `src/controllers/` (folder, now empty) |

---

## Task 1: Create `types/errors.ts` and update services

**Files:**
- Create: `src/types/errors.ts`
- Modify: `src/services/authService.ts`
- Modify: `src/services/promptTesterService.ts`

- [ ] **Step 1: Create `src/types/errors.ts`**

```typescript
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class LLMError extends AppError {
  constructor(msg: string) { super(msg, 502, 'LLM_ERROR'); }
}

export class AuthError extends AppError {
  constructor(msg: string) { super(msg, 401, 'AUTH_ERROR'); }
}

export class IngestionError extends AppError {
  constructor(msg: string) { super(msg, 422, 'INGESTION_ERROR'); }
}

export class ConfigError extends AppError {
  constructor(msg: string) { super(msg, 503, 'CONFIG_ERROR'); }
}
```

- [ ] **Step 2: Update `src/services/authService.ts` to throw `AuthError`**

Replace the full file content:

```typescript
import bcrypt from 'bcryptjs';
import { AuthError } from '../types/errors.js';

const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) {
    throw new AuthError('Senha deve ter mínimo 8 caracteres');
  }
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

- [ ] **Step 3: Update `src/services/promptTesterService.ts` — replace plain Error in `loadCases`**

Find line:
```typescript
    throw new Error("Arquivo de casos inválido: inclua um array não vazio em 'cases'.");
```

Replace with:
```typescript
    throw new Error("Arquivo de casos inválido: inclua um array não vazio em 'cases'.");
```
(No change needed here — this is an input validation error thrown to callers that catch it generically. Leave as-is.)

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all tests pass. (No behavior changes — `AuthError` extends `Error`, existing `toThrow` checks still match.)

- [ ] **Step 6: Commit**

```bash
git add src/types/errors.ts src/services/authService.ts
git commit -m "refactor: add AppError hierarchy to types/errors.ts"
```

---

## Task 2: Create `integrations/llm/` provider registry

**Files:**
- Create: `src/integrations/llm/types.ts`
- Create: `src/integrations/llm/utils.ts`
- Create: `src/integrations/llm/anthropic.ts`
- Create: `src/integrations/llm/openai.ts`
- Create: `src/integrations/llm/gemini.ts`
- Create: `src/integrations/llm/openrouter.ts`
- Create: `src/integrations/llm/registry.ts`
- Modify: `src/services/llmService.ts`

- [ ] **Step 1: Create `src/integrations/llm/types.ts`**

```typescript
export interface LLMRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}
```

- [ ] **Step 2: Create `src/integrations/llm/utils.ts`**

```typescript
import { LLMError } from '../../types/errors.js';

export function translateHttpError(status: number): never {
  if (status === 401) throw new LLMError('Chave de API inválida. Verifique e tente novamente.');
  if (status === 429) throw new LLMError('Limite de uso atingido. Aguarde alguns instantes.');
  throw new LLMError(`Erro ao chamar a IA (status ${status}).`);
}
```

- [ ] **Step 3: Create `src/integrations/llm/anthropic.ts`**

```typescript
import type { LLMRequest } from './types.js';
import { translateHttpError } from './utils.js';

export async function callAnthropic(key: string, model: string, req: LLMRequest): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      system: req.system,
      messages: [{ role: 'user', content: req.user }]
    })
  });
  if (!res.ok) translateHttpError(res.status);
  const data = await res.json() as { content: Array<{ text: string }> };
  return data.content[0].text;
}
```

- [ ] **Step 4: Create `src/integrations/llm/openai.ts`**

```typescript
import type { LLMRequest } from './types.js';
import { translateHttpError } from './utils.js';

export async function callOpenAI(key: string, model: string, req: LLMRequest): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user }
      ]
    })
  });
  if (!res.ok) translateHttpError(res.status);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}
```

- [ ] **Step 5: Create `src/integrations/llm/gemini.ts`**

```typescript
import type { LLMRequest } from './types.js';
import { translateHttpError } from './utils.js';

export async function callGemini(key: string, model: string, req: LLMRequest): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: req.system }] },
      contents: [{ parts: [{ text: req.user }] }],
      generationConfig: { maxOutputTokens: req.maxTokens, temperature: req.temperature }
    })
  });
  if (!res.ok) translateHttpError(res.status);
  const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
  return data.candidates[0].content.parts[0].text;
}
```

- [ ] **Step 6: Create `src/integrations/llm/openrouter.ts`**

```typescript
import type { LLMRequest } from './types.js';
import { translateHttpError } from './utils.js';

// BUSINESS RULE: OpenRouter uses an OpenAI-compatible API but requires HTTP-Referer
// for attribution and routes to 300+ models including free-tier ones (suffix :free).
export async function callOpenRouter(key: string, model: string, req: LLMRequest): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'HTTP-Referer': 'https://testn8nmetaapi.onrender.com',
      'X-Title': 'SDR AI'
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user }
      ]
    })
  });
  if (!res.ok) translateHttpError(res.status);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}
```

- [ ] **Step 7: Create `src/integrations/llm/registry.ts`**

```typescript
import { callAnthropic } from './anthropic.js';
import { callOpenAI } from './openai.js';
import { callGemini } from './gemini.js';
import { callOpenRouter } from './openrouter.js';
import { LLMError } from '../../types/errors.js';
import type { LLMRequest } from './types.js';

type ProviderFn = (key: string, model: string, req: LLMRequest) => Promise<string>;

const providers: Record<string, ProviderFn> = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  gemini: callGemini,
  openrouter: callOpenRouter,
};

export function getProvider(name: string): ProviderFn {
  const fn = providers[name];
  if (!fn) throw new LLMError(`Provedor desconhecido: ${name}`);
  return fn;
}
```

- [ ] **Step 8: Rewrite `src/services/llmService.ts`**

Replace the full file content:

```typescript
import { getSetting } from './settingsService.js';
import { getProvider } from '../integrations/llm/registry.js';
import { LLMError } from '../types/errors.js';
import type { LLMRequest } from '../integrations/llm/types.js';

export type { LLMRequest };

export async function askLLM(req: LLMRequest): Promise<string> {
  const [provider, key, model] = await Promise.all([
    getSetting('llm_provider'),
    getSetting('llm_api_key'),
    getSetting('llm_model'),
  ]);

  if (!provider || !key || !model) {
    throw new LLMError('Configuração de IA incompleta. Acesse as configurações para configurar.');
  }

  try {
    return await getProvider(provider)(key, model, req);
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new LLMError('Não foi possível conectar ao serviço de IA.');
  }
}
```

- [ ] **Step 9: Run existing LLM tests**

```bash
npm test -- tests/llmService.test.ts
```

Expected: all 5 tests pass. The tests mock `settingsService` and `global.fetch` — the registry is transparent to them.

- [ ] **Step 10: Run full suite**

```bash
npm test && npx tsc --noEmit
```

Expected: all tests pass, zero TypeScript errors.

- [ ] **Step 11: Commit**

```bash
git add src/integrations/llm/ src/services/llmService.ts
git commit -m "refactor: extract LLM providers to integrations/llm/ with registry pattern"
```

---

## Task 3: Fix `promptTesterService.ts` bug

**Files:**
- Modify: `src/services/promptTesterService.ts`

The bug: `askAnthropic(apiKey, model, ...)` ignores its `apiKey` and `model` params, always delegating to `askLLM()` (DB settings). When a user passes a key from the UI, it is silently ignored.

- [ ] **Step 1: Write the failing test**

Add to `tests/settingsService.test.ts` — actually add a new test file `tests/promptTesterService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/llmService.js', () => ({
  askLLM: vi.fn()
}));

import { askLLM } from '../src/services/llmService.js';
import { askAnthropic } from '../src/services/promptTesterService.js';

const mockAskLLM = vi.mocked(askLLM);

global.fetch = vi.fn();
const mockFetch = vi.mocked(global.fetch);

beforeEach(() => vi.clearAllMocks());

describe('askAnthropic', () => {
  it('calls Anthropic directly when apiKey is provided — does NOT delegate to askLLM', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: 'direct response' }] })
    } as Response);

    const result = await askAnthropic('sk-ant-real', 'claude-haiku-4-5-20251001', 'sys', 'user', 100, 0.3);

    expect(result).toBe('direct response');
    expect(mockAskLLM).not.toHaveBeenCalled();
    const [url] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('falls back to askLLM when apiKey is undefined', async () => {
    mockAskLLM.mockResolvedValueOnce('llm response');

    const result = await askAnthropic(undefined as unknown as string, 'any-model', 'sys', 'user', 100, 0.3);

    expect(result).toBe('llm response');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- tests/promptTesterService.test.ts
```

Expected: FAIL — first test fails because `askAnthropic` currently ignores `apiKey` and calls `askLLM`.

- [ ] **Step 3: Fix `src/services/promptTesterService.ts`**

Replace the `askAnthropic` function (lines 52–61):

```typescript
export async function askAnthropic(
  apiKey: string | undefined,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  temperature: number,
): Promise<string> {
  if (apiKey) {
    return callAnthropic(apiKey, model, {
      system: systemPrompt,
      user: userMessage,
      maxTokens,
      temperature,
    });
  }
  return askLLM({ system: systemPrompt, user: userMessage, maxTokens, temperature });
}
```

Also add the import at the top of the file (after existing imports):

```typescript
import { callAnthropic } from '../integrations/llm/anthropic.js';
```

And remove the import of `askLLM` from `llmService` if it only existed for this use case — check: `askLLM` is used in the fallback branch, so keep it:

The top of `src/services/promptTesterService.ts` should have:
```typescript
import { readFile } from 'node:fs/promises';
import { askLLM } from './llmService.js';
import { callAnthropic } from '../integrations/llm/anthropic.js';
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test -- tests/promptTesterService.test.ts
```

Expected: PASS — both tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test && npx tsc --noEmit
```

Expected: all tests pass, zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/promptTesterService.ts tests/promptTesterService.test.ts
git commit -m "fix: askAnthropic now uses passed apiKey/model instead of ignoring them"
```

---

## Task 4: Add TTL cache to `settingsService.ts`

**Files:**
- Modify: `src/services/settingsService.ts`
- Modify: `tests/settingsService.test.ts`

- [ ] **Step 1: Write the new failing TTL test**

Add to `tests/settingsService.test.ts`, after the existing `getSetting` describe block:

```typescript
describe('getSetting — TTL expiry', () => {
  it('re-queries DB after cache entry expires', async () => {
    vi.useFakeTimers();

    mockQuery
      .mockResolvedValueOnce({ rows: [{ value: 'old' }] } as never)
      .mockResolvedValueOnce({ rows: [{ value: 'new' }] } as never);

    await getSetting('llm_provider');          // prime cache
    vi.advanceTimersByTime(61_000);            // advance past 60s TTL
    const result = await getSetting('llm_provider'); // should re-query

    expect(result).toBe('new');
    expect(mockQuery).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- tests/settingsService.test.ts
```

Expected: FAIL — TTL test fails because current cache has no expiry.

- [ ] **Step 3: Rewrite `src/services/settingsService.ts`**

Replace the full file content:

```typescript
import { pool } from '../db/client.js';

const TTL_MS = 60_000;

interface CacheEntry {
  value: string | undefined;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function isFresh(entry: CacheEntry): boolean {
  return Date.now() < entry.expiresAt;
}

export function clearCache(): void {
  cache.clear();
}

export async function getSetting(key: string): Promise<string | undefined> {
  const entry = cache.get(key);
  if (entry && isFresh(entry)) return entry.value;

  const { rows } = await pool.query<{ value: string }>(
    'SELECT value FROM settings WHERE key = $1',
    [key]
  );
  const value = rows[0]?.value;
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
  cache.delete(key);
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ key: string; value: string }>(
    'SELECT key, value FROM settings'
  );
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}
```

- [ ] **Step 4: Run all settings tests**

```bash
npm test -- tests/settingsService.test.ts
```

Expected: all tests pass including the new TTL test.

- [ ] **Step 5: Run full suite**

```bash
npm test && npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/settingsService.ts tests/settingsService.test.ts
git commit -m "refactor: add 60s TTL to settingsService cache"
```

---

## Task 5: Create `testerFileService.ts` and clean `routes/tester.ts`

**Files:**
- Create: `src/services/testerFileService.ts`
- Modify: `src/routes/tester.ts`

- [ ] **Step 1: Create `src/services/testerFileService.ts`**

```typescript
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CasesFile } from './promptTesterService.js';

const PROMPTS_DIR = join(process.cwd(), 'prompts');
const CASES_DIR = join(process.cwd(), 'cases');
const RESULTS_DIR = join(process.cwd(), 'results');

export interface ResultMeta {
  file: string;
  [key: string]: unknown;
}

export async function listPrompts(): Promise<string[]> {
  try {
    const files = await readdir(PROMPTS_DIR);
    return files.filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

export async function listCases(): Promise<string[]> {
  try {
    const files = await readdir(CASES_DIR);
    return files.filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
}

export async function listResults(): Promise<ResultMeta[]> {
  try {
    const files = (await readdir(RESULTS_DIR).catch(() => []))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 30);

    return Promise.all(
      files.map(async (f) => {
        const raw = await readFile(join(RESULTS_DIR, f), 'utf8');
        const { metadata } = JSON.parse(raw) as { metadata: Record<string, unknown> };
        return { file: f, ...metadata };
      })
    );
  } catch {
    return [];
  }
}

export async function readPrompt(name: string): Promise<string> {
  return readFile(join(PROMPTS_DIR, name), 'utf8');
}

export async function readCase(name: string): Promise<CasesFile> {
  const raw = await readFile(join(CASES_DIR, name), 'utf8');
  const parsed = JSON.parse(raw) as CasesFile;
  if (!parsed.cases || !Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error("Arquivo de casos inválido: inclua um array não vazio em 'cases'.");
  }
  return parsed;
}
```

- [ ] **Step 2: Rewrite `src/routes/tester.ts`**

Replace the full file content:

```typescript
import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
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
  app.get('/', async (_request, reply) => {
    const html = await readFile(path.join(__dirname, '..', 'ui.html'), 'utf8');
    return reply.type('text/html').send(html);
  });

  app.get('/api/config', async (_request, reply) => {
    return reply.send({ hasApiKey: !!env.ANTHROPIC_API_KEY });
  });

  app.get('/api/prompts', async (_request, reply) => {
    return reply.send(await listPrompts());
  });

  app.get('/api/cases', async (_request, reply) => {
    return reply.send(await listCases());
  });

  app.get('/api/results', async (_request, reply) => {
    return reply.send(await listResults());
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
      return reply.status(500).send({ error: (err as Error).message });
    }
  });
};
```

- [ ] **Step 3: Run full suite**

```bash
npm test && npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/testerFileService.ts src/routes/tester.ts
git commit -m "refactor: extract file I/O from tester routes into testerFileService"
```

---

## Task 6: Move `config/routingConfig.ts` → `routing/config.ts`

**Files:**
- Create: `src/routing/config.ts`
- Delete: `src/config/routingConfig.ts`
- Modify: `src/services/leadIngestionService.ts` (import path)
- Modify: `src/app/createApp.ts` (import path)
- Modify: `tests/ingestion-routing.test.ts` (import path)
- Modify: `tests/routing.test.ts` (import path)
- Modify: `tests/routing-config.test.ts` (import path × 4)

- [ ] **Step 1: Create `src/routing/config.ts`**

Copy the entire content of `src/config/routingConfig.ts` into this new file. The content is:

```typescript
import * as fs from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';

const promotableFieldSchema = z.enum([
  'phone', 'email', 'fullName', 'firstName', 'lastName',
  'city', 'state', 'productInterest', 'budgetRange', 'purchaseTimeline',
  'campaignName', 'adsetName', 'adName'
]);

const fieldMapSchema = z.record(z.string(), promotableFieldSchema);

const formEntrySchema = z.object({
  formId: z.string().min(1),
  url: z.string().url(),
  fieldMap: fieldMapSchema.optional().default({})
});

const pageEntrySchema = z.object({
  pageId: z.string().min(1),
  url: z.string().url(),
  forms: z.array(formEntrySchema).optional().default([])
});

const routingConfigSchema = z.object({
  default: z.object({ url: z.string().url() }).optional(),
  pages: z.array(pageEntrySchema).optional().default([])
});

export type RoutingConfig = z.infer<typeof routingConfigSchema>;
export type PromotableField = z.infer<typeof promotableFieldSchema>;

const configPath = join(process.cwd(), 'config', 'routing.json');

export const loadRoutingConfig = async (): Promise<RoutingConfig | null> => {
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    return routingConfigSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
};
```

- [ ] **Step 2: Update `src/services/leadIngestionService.ts`**

Find:
```typescript
import type { RoutingConfig } from '../config/routingConfig.js';
```
Replace with:
```typescript
import type { RoutingConfig } from '../routing/config.js';
```

- [ ] **Step 3: Update `src/app/createApp.ts`**

Find:
```typescript
import { loadRoutingConfig } from '../config/routingConfig.js';
```
Replace with:
```typescript
import { loadRoutingConfig } from '../routing/config.js';
```

- [ ] **Step 4: Update `tests/ingestion-routing.test.ts`**

Find:
```typescript
import type { RoutingConfig } from '../src/config/routingConfig.js';
```
Replace with:
```typescript
import type { RoutingConfig } from '../src/routing/config.js';
```

- [ ] **Step 5: Update `tests/routing.test.ts`**

Find:
```typescript
import type { RoutingConfig } from '../src/config/routingConfig.js';
```
Replace with:
```typescript
import type { RoutingConfig } from '../src/routing/config.js';
```

- [ ] **Step 6: Update `tests/routing-config.test.ts`**

Replace all 4 occurrences of `'../src/config/routingConfig.js'` with `'../src/routing/config.js'`.

Run first to find them:
```bash
grep -n "routingConfig" tests/routing-config.test.ts
```

Replace each occurrence.

- [ ] **Step 7: Delete the old file**

```bash
rm src/config/routingConfig.ts
```

- [ ] **Step 8: Run full suite**

```bash
npm test && npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/routing/config.ts src/services/leadIngestionService.ts src/app/createApp.ts tests/ingestion-routing.test.ts tests/routing.test.ts tests/routing-config.test.ts
git rm src/config/routingConfig.ts
git commit -m "refactor: move routingConfig from config/ to routing/config.ts"
```

---

## Task 7: Move `schemas/metaWebhook.ts` → `integrations/meta/schema.ts`

**Files:**
- Create: `src/integrations/meta/schema.ts`
- Delete: `src/schemas/metaWebhook.ts`
- Modify: `src/integrations/meta/normalizer.ts` (import path)
- Modify: `tests/validation.test.ts` (import path)

- [ ] **Step 1: Create `src/integrations/meta/schema.ts`**

```typescript
import { z } from 'zod';

const changeSchema = z.object({
  field: z.string(),
  value: z.object({
    leadgen_id: z.string().optional(),
    page_id: z.string().optional(),
    form_id: z.string().optional(),
    ad_id: z.string().optional(),
    adgroup_id: z.string().optional(),
    created_time: z.number().optional(),
    campaign_id: z.string().optional(),
    custom: z.record(z.unknown()).optional(),
    email: z.string().optional(),
    phone_number: z.string().optional(),
    full_name: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional()
  }).passthrough()
});

export const metaWebhookSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string().optional(),
      changes: z.array(changeSchema).default([])
    })
  )
});

export type MetaWebhookPayload = z.infer<typeof metaWebhookSchema>;
```

- [ ] **Step 2: Update `src/integrations/meta/normalizer.ts`**

Find:
```typescript
import type { MetaWebhookPayload } from '../../schemas/metaWebhook.js';
```
Replace with:
```typescript
import type { MetaWebhookPayload } from './schema.js';
```

- [ ] **Step 3: Update `tests/validation.test.ts`**

Find:
```typescript
import { metaWebhookSchema } from '../src/schemas/metaWebhook.js';
```
Replace with:
```typescript
import { metaWebhookSchema } from '../src/integrations/meta/schema.js';
```

- [ ] **Step 4: Check for any other importers**

```bash
grep -r "schemas/metaWebhook" src/ tests/
```

Update any remaining occurrences found.

- [ ] **Step 5: Delete old file and folder**

```bash
rm src/schemas/metaWebhook.ts
rmdir src/schemas
```

- [ ] **Step 6: Run full suite**

```bash
npm test && npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/integrations/meta/schema.ts src/integrations/meta/normalizer.ts tests/validation.test.ts
git rm src/schemas/metaWebhook.ts
git commit -m "refactor: move metaWebhook schema to integrations/meta/schema.ts"
```

---

## Task 8: Merge `controllers/metaWebhookController.ts` into `integrations/meta/routes.ts`

**Files:**
- Create: `src/integrations/meta/routes.ts`
- Delete: `src/routes/meta.ts`
- Delete: `src/controllers/metaWebhookController.ts`
- Modify: `src/app/createApp.ts` (import path)

- [ ] **Step 1: Create `src/integrations/meta/routes.ts`**

This file combines all Meta webhook concerns: HMAC hook, route schemas, and request handlers.

```typescript
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { verifyMetaChallenge, verifyMetaSignature } from './verification.js';
import { correlationIdFromHeader } from '../../utils/correlation.js';
import { getSetting } from '../../services/settingsService.js';

const ensureMetaSignature = async (request: FastifyRequest, reply: FastifyReply) => {
  const appSecret = await getSetting('meta_app_secret') ?? env.META_APP_SECRET;
  if (!appSecret) {
    return reply.status(503).send({ error: 'META_APP_SECRET not configured. Complete setup wizard first.' });
  }

  const signature = request.headers['x-hub-signature-256'] as string | undefined;
  const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;

  if (!rawBody || !verifyMetaSignature(rawBody, signature, appSecret)) {
    const correlationId = correlationIdFromHeader(request.headers['x-correlation-id'] as string | undefined);
    return reply.status(401).send({ status: 'rejected', reason: 'invalid_signature', correlationId });
  }
};

const verifyWebhookChallenge = async (request: FastifyRequest, reply: FastifyReply) => {
  const verifyToken = await getSetting('meta_verify_token') ?? env.META_VERIFY_TOKEN;
  if (!verifyToken) {
    return reply.status(503).send({ error: 'META_VERIFY_TOKEN not configured. Complete setup wizard first.' });
  }

  const query = request.query as Record<string, string | undefined>;
  const challenge = verifyMetaChallenge(
    query['hub.mode'],
    query['hub.verify_token'],
    query['hub.challenge'],
    verifyToken
  );
  if (!challenge) return reply.status(403).send({ error: 'verification failed' });
  return reply.status(200).send(challenge);
};

const receiveMetaWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
  const correlationId = correlationIdFromHeader(
    request.headers['x-correlation-id'] as string | undefined
  );

  const result = await request.server.leadIngestionService.ingest({
    correlationId,
    payload: request.body,
    headers: request.headers as Record<string, unknown>
  });

  if (!result.accepted) {
    return reply.status(400).send({ status: 'rejected', reason: result.reason, correlationId });
  }

  return reply.status(202).send({ status: 'accepted', correlationId });
};

const rejection400Schema = z.object({
  status: z.literal('rejected'),
  reason: z.string(),
  correlationId: z.string()
});

const rejection401Schema = z.object({
  status: z.literal('rejected'),
  reason: z.literal('invalid_signature'),
  correlationId: z.string()
});

export const registerMetaRoutes = async (app: FastifyInstance) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/webhooks/meta/lead-ads', {
    schema: {
      querystring: z.object({
        'hub.mode': z.string(),
        'hub.verify_token': z.string(),
        'hub.challenge': z.string()
      }),
      response: {
        200: z.string(),
        403: z.object({ error: z.string() })
      }
    }
  }, verifyWebhookChallenge);

  typed.post('/webhooks/meta/lead-ads', {
    preValidation: [ensureMetaSignature],
    bodyLimit: 1048576,
    schema: {
      // No body schema — preserves fastify-raw-body raw byte capture for HMAC validation
      description: 'Receives Meta leadgen webhook. Body is a MetaWebhookPayload (see src/integrations/meta/schema.ts).',
      response: {
        202: z.object({ status: z.literal('accepted'), correlationId: z.string() }),
        400: rejection400Schema,
        401: rejection401Schema
      }
    }
  }, receiveMetaWebhook);
};
```

- [ ] **Step 2: Update `src/app/createApp.ts`**

Find:
```typescript
import { registerMetaRoutes } from '../routes/meta.js';
```
Replace with:
```typescript
import { registerMetaRoutes } from '../integrations/meta/routes.js';
```

- [ ] **Step 3: Delete old files**

```bash
rm src/routes/meta.ts
rm src/controllers/metaWebhookController.ts
```

- [ ] **Step 4: Run full suite**

```bash
npm test && npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/meta/routes.ts src/app/createApp.ts
git rm src/routes/meta.ts src/controllers/metaWebhookController.ts
git commit -m "refactor: merge meta controller into integrations/meta/routes.ts"
```

---

## Task 9: Merge `controllers/unifiedWebhookController.ts` into `routes/webhooks/unified.ts`

**Files:**
- Modify: `src/routes/webhooks/unified.ts`
- Delete: `src/controllers/unifiedWebhookController.ts`
- Delete: `src/controllers/` (folder now empty)

- [ ] **Step 1: Rewrite `src/routes/webhooks/unified.ts`**

Replace the full file content with the merged version (route registration + handler inline):

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { ZodError } from 'zod';
import { env } from '../../config/env.js';
import { correlationIdFromHeader } from '../../utils/correlation.js';
import { buildLeadHash } from '../../utils/hash.js';
import { logger } from '../../utils/logger.js';
import { webhookEventRepository } from '../../repositories/webhookEventRepository.js';
import { leadRepository } from '../../repositories/leadRepository.js';
import { leadSourcesRepository } from '../../repositories/leadSourcesRepository.js';
import { mapInstagramPayloadV1 } from '../../integrations/instagram/mappers/v1.js';
import type { NormalizedLead } from '../../types/domain.js';

type Mapper = (raw: unknown) => NormalizedLead;
const mappers: Record<string, Mapper> = { 'instagram:1.0': mapInstagramPayloadV1 };

const verifyApiKey = (provided: string | undefined): boolean => {
  if (!provided) return false;
  try {
    const expected = Buffer.from(env.BACKEND_API_KEY);
    const actual = Buffer.from(provided);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch { return false; }
};

const receiveUnifiedWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
  const correlationId = correlationIdFromHeader(request.headers['x-correlation-id'] as string | undefined);
  const log = logger.child({ correlationId });

  if (!verifyApiKey(request.headers['x-api-key'] as string | undefined)) {
    return reply.status(401).send({ status: 'rejected', reason: 'invalid_api_key', correlationId });
  }

  const body = request.body as Record<string, unknown>;
  const source = body?.source as string | undefined;
  const contractVersion = body?.contractVersion as string | undefined;

  const safeHeaders = { ...request.headers };
  delete (safeHeaders as Record<string, unknown>)['x-hub-signature-256'];
  delete (safeHeaders as Record<string, unknown>)['x-api-key'];
  delete (safeHeaders as Record<string, unknown>)['authorization'];
  delete (safeHeaders as Record<string, unknown>)['x-internal-auth-token'];

  let eventId: string;
  try {
    eventId = await webhookEventRepository.create({
      provider: source ?? 'unknown',
      eventType: 'lead_qualified',
      rawPayload: body,
      headers: safeHeaders,
      processingStatus: 'received',
      correlationId
    });
  } catch (err) {
    log.error({ err }, 'Failed to persist raw event');
    return reply.status(500).send({ status: 'rejected', reason: 'internal_error', correlationId });
  }

  const mapperKey = `${source}:${contractVersion}`;
  const mapper = mappers[mapperKey];
  if (!mapper) {
    await webhookEventRepository.updateStatus(eventId, 'failed', `Unknown contract: ${mapperKey}`);
    return reply.status(400).send({ status: 'rejected', reason: `unsupported_contract:${mapperKey}`, correlationId });
  }

  let lead: NormalizedLead;
  try {
    lead = mapper(body);
  } catch (err) {
    const reason = err instanceof ZodError ? err.message : 'mapping_failed';
    await webhookEventRepository.updateStatus(eventId, 'failed', reason);
    return reply.status(400).send({ status: 'rejected', reason: 'invalid_payload', correlationId });
  }

  try {
    const leadHash = buildLeadHash(lead);
    const existing = await leadRepository.findByHash(leadHash);
    if (existing) {
      await webhookEventRepository.updateStatus(eventId, 'duplicate');
      return reply.status(200).send({ status: 'duplicate', correlationId });
    }
    const leadSource = await leadSourcesRepository.findByName(source!);
    const leadId = await leadRepository.create(lead, leadHash, null, leadSource?.id ?? null);
    await webhookEventRepository.updateStatus(eventId, 'persisted');
    log.info({ leadId }, 'Lead persisted from instagram');
    return reply.status(202).send({ status: 'accepted', correlationId, leadId });
  } catch (err) {
    await webhookEventRepository.updateStatus(eventId, 'failed', String(err));
    log.error({ err }, 'Unexpected error');
    return reply.status(500).send({ status: 'rejected', reason: 'internal_error', correlationId });
  }
};

export const registerUnifiedWebhookRoutes = async (app: FastifyInstance) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.post('/webhooks/v1/leads', {
    schema: {
      description: 'Unified lead ingestion. Auth: X-Api-Key header.',
      response: {
        202: z.object({ status: z.literal('accepted'), correlationId: z.string(), leadId: z.string() }),
        200: z.object({ status: z.literal('duplicate'), correlationId: z.string() }),
        400: z.object({ status: z.literal('rejected'), reason: z.string(), correlationId: z.string() }),
        401: z.object({ status: z.literal('rejected'), reason: z.string(), correlationId: z.string() }),
        500: z.object({ status: z.literal('rejected'), reason: z.string(), correlationId: z.string() })
      }
    }
  }, receiveUnifiedWebhook);
};
```

- [ ] **Step 2: Delete old files and folder**

```bash
rm src/controllers/unifiedWebhookController.ts
rmdir src/controllers
```

- [ ] **Step 3: Run full suite**

```bash
npm test && npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/routes/webhooks/unified.ts
git rm src/controllers/unifiedWebhookController.ts
git commit -m "refactor: merge unified webhook controller into routes/webhooks/unified.ts, delete controllers/"
```

---

## Task 10: Formalize DI in `LeadIngestionService`

**Files:**
- Modify: `src/services/leadIngestionService.ts`
- Modify: `src/app/createApp.ts`

The current code has `constructor(private readonly deliveryService = new N8nDeliveryService())` — a default param that creates a hidden dependency. Removing the default makes wiring explicit and visible in one place.

Note: `tests/ingestion-routing.test.ts` already calls `new LeadIngestionService(new N8nDeliveryService(), routingConfig)` explicitly — no test changes needed.

- [ ] **Step 1: Remove default param from `src/services/leadIngestionService.ts`**

Find:
```typescript
  constructor(
    private readonly deliveryService = new N8nDeliveryService(),
    private readonly routingConfig: RoutingConfig | null = null
  ) {}
```

Replace with:
```typescript
  constructor(
    private readonly deliveryService: N8nDeliveryService,
    private readonly routingConfig: RoutingConfig | null
  ) {}
```

- [ ] **Step 2: Verify `src/app/createApp.ts` already passes both args**

Check the existing `app.decorate` line in `createApp.ts`:
```typescript
app.decorate('leadIngestionService', new LeadIngestionService(new N8nDeliveryService(), routingConfig));
```

This is already correct — both args are explicit. No change needed.

- [ ] **Step 3: Run full suite**

```bash
npm test && npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/leadIngestionService.ts
git commit -m "refactor: remove default param from LeadIngestionService — explicit DI only"
```

---

## Task 11: Extract `app/plugins.ts` and add global error handler

**Files:**
- Create: `src/app/plugins.ts`
- Modify: `src/app/createApp.ts`

- [ ] **Step 1: Create `src/app/plugins.ts`**

```typescript
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fastifyRawBody from 'fastify-raw-body';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import { env } from '../config/env.js';

interface PluginOptions {
  enableDocs: boolean;
}

export const registerPlugins = async (app: FastifyInstance, options: PluginOptions): Promise<void> => {
  app.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    routes: ['/webhooks/meta/lead-ads'],
    encoding: 'utf8',
    runFirst: true
  });

  app.register(sensible);
  app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW
  });

  await app.register(fastifyJwt, { secret: env.JWT_SECRET });
  await app.register(fastifyCookie);

  if (options.enableDocs) {
    const swagger = (await import('@fastify/swagger')).default;
    const swaggerUi = (await import('@fastify/swagger-ui')).default;

    await app.register(swagger, {
      openapi: {
        info: {
          title: 'Facebook Lead Ads Ingestion API',
          description: 'Hybrid ingestion service: Meta Webhook → PostgreSQL → n8n',
          version: '1.0.0'
        }
      },
      transform: (await import('fastify-type-provider-zod')).jsonSchemaTransform
    });

    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list' }
    });
  }

  // NOTE: helmet applies globally. script-src allows 'unsafe-inline' for the
  // single-file ui.html which uses inline <script> blocks.
  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
        fontSrc: ["'self'", 'https:', 'data:'],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"]
      }
    }
  });

  // NOTE: fastify-metrics@11.0.0 uses CommonJS __esModule interop — the ESM default export
  // wraps the actual plugin as `.default.default`. The nullish coalescing fallback
  // handles environments where the double-nesting is already resolved.
  const { default: metricsPluginModule } = await import('fastify-metrics');
  const metricsPlugin = (metricsPluginModule as unknown as { default: FastifyPluginAsync<Record<string, unknown>> }).default ?? metricsPluginModule as unknown as FastifyPluginAsync<Record<string, unknown>>;
  await app.register(metricsPlugin, {
    defaultMetrics: { enabled: true },
    endpoint: { url: '/metrics', schema: { hide: true } },
    clearRegisterOnInit: true,
    routeMetrics: {
      enabled: true,
      routeBlacklist: ['/metrics', '/docs', '/docs/json', '/docs/yaml'],
      overrides: {
        labels: {
          getRouteLabel: (req: { routeOptions?: { url?: string }; url: string }) =>
            req.routeOptions?.url ?? req.url.split('?')[0]
        }
      }
    }
  });
};
```

- [ ] **Step 2: Rewrite `src/app/createApp.ts`**

Replace the full file content:

```typescript
import Fastify from 'fastify';
import { ZodTypeProvider, validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../types/errors.js';
import { registerPlugins } from './plugins.js';
import { loadRoutingConfig } from '../routing/config.js';
import { LeadIngestionService } from '../services/leadIngestionService.js';
import { N8nDeliveryService } from '../services/n8nDeliveryService.js';
import { registerAuthRoutes } from '../routes/auth.js';
import { registerMetaRoutes } from '../integrations/meta/routes.js';
import { registerHealthRoutes } from '../routes/health.js';
import { registerUnifiedWebhookRoutes } from '../routes/webhooks/unified.js';
import { registerTesterRoutes } from '../routes/tester.js';
import { registerManychatRoutes } from '../routes/manychat.js';
import { registerSettingsRoutes } from '../routes/settings.js';

declare module 'fastify' {
  interface FastifyInstance {
    leadIngestionService: LeadIngestionService;
  }
}

interface CreateAppOptions {
  enableDocs: boolean;
}

export const createApp = async (options: CreateAppOptions = { enableDocs: false }) => {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await registerPlugins(app, options);

  // Wire services
  const routingConfig = await loadRoutingConfig();
  app.decorate('leadIngestionService', new LeadIngestionService(new N8nDeliveryService(), routingConfig));

  // Register routes
  app.register(registerAuthRoutes);
  app.register(registerHealthRoutes);
  app.register(registerMetaRoutes);
  app.register(registerUnifiedWebhookRoutes);
  app.register(registerTesterRoutes);
  app.register(registerManychatRoutes);
  app.register(registerSettingsRoutes);

  // Global error handler: AppError → structured HTTP response; unexpected errors → 500
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: err.message, code: err.code });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'Erro interno do servidor.', code: 'INTERNAL_ERROR' });
  });

  return app;
};
```

- [ ] **Step 3: Run full suite**

```bash
npm test && npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/plugins.ts src/app/createApp.ts
git commit -m "refactor: extract plugin registration to app/plugins.ts, add global AppError handler"
```

---

## Checklist de cobertura

- [x] Bug `askAnthropic` corrigido (Task 3)
- [x] LLM providers isolados em `integrations/llm/` com registry (Task 2)
- [x] `types/errors.ts` com hierarquia `AppError` (Task 1)
- [x] TTL cache em `settingsService.ts` (Task 4)
- [x] I/O extraído de `routes/tester.ts` para `testerFileService.ts` (Task 5)
- [x] `config/routingConfig.ts` movido para `routing/config.ts` (Task 6)
- [x] `schemas/metaWebhook.ts` movido para `integrations/meta/schema.ts` (Task 7)
- [x] `controllers/` eliminado — meta mergeado em `integrations/meta/routes.ts` (Task 8)
- [x] `controllers/` eliminado — unified mergeado em `routes/webhooks/unified.ts` (Task 9)
- [x] DI explícita em `LeadIngestionService` (Task 10)
- [x] `createApp.ts` decomposto com `plugins.ts` e error handler global (Task 11)
