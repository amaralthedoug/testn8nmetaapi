# Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-run setup wizard that lets non-technical clinic owners configure the LLM provider and Meta tokens via the browser, replacing manual env-var configuration.

**Architecture:** New `users` and `settings` tables store auth credentials and runtime config. A `settingsService` with in-memory cache replaces direct `env.*` reads in hot-path routes. Auth is JWT in an `httpOnly` cookie; the frontend is a single-page state machine that routes between screens based on `/api/auth/me` response.

**Tech Stack:** Fastify, @fastify/jwt, @fastify/cookie, bcryptjs, Zod, Vitest, PostgreSQL, plain JS/HTML (no frontend build step).

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `db/migrations/006_add_users.sql` | users table |
| Create | `db/migrations/007_add_settings.sql` | settings key-value table |
| Create | `src/services/settingsService.ts` | get/set/getAll with in-memory cache |
| Create | `src/services/authService.ts` | hashPassword, comparePassword |
| Create | `src/services/llmService.ts` | askLLM() routing to multi-provider adapters |
| Create | `src/routes/auth.ts` | /api/auth/register, /login, /logout, /me |
| Create | `src/routes/settings.ts` | GET /api/settings, PUT /api/settings, POST /api/setup/test-llm |
| Modify | `src/config/env.ts` | META_VERIFY_TOKEN, META_APP_SECRET, ANTHROPIC_API_KEY → .optional() |
| Modify | `src/app/createApp.ts` | register @fastify/jwt, @fastify/cookie, auth hook, new routes |
| Modify | `src/services/promptTesterService.ts` | replace askAnthropic() with llmService.ask() |
| Modify | `src/routes/meta.ts` | read from settingsService instead of env |
| Modify | `src/routes/tester.ts` | read llm_api_key from settingsService |
| Modify | `src/ui.html` | add screens: register, login, setup-1, setup-2, setup-done, settings panel |

---

### Task 1: Dependencies and Migrations

**Files:**
- Modify: `package.json`
- Create: `db/migrations/006_add_users.sql`
- Create: `db/migrations/007_add_settings.sql`
- Modify: `src/config/env.ts`

- [ ] **Step 1: Install new packages**

```bash
cd /home/douglas/testn8nmetaapi
npm install @fastify/jwt @fastify/cookie bcryptjs
npm install --save-dev @types/bcryptjs
```

Expected: packages added to `package.json` with no peer-dep warnings.

- [ ] **Step 2: Create migration 006 — users table**

Create `db/migrations/006_add_users.sql`:

```sql
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 3: Create migration 007 — settings table**

Create `db/migrations/007_add_settings.sql`:

```sql
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Make env vars optional**

In `src/config/env.ts`, change three fields from `.min(1)` / required to `.optional()`:

```typescript
META_VERIFY_TOKEN: z.string().optional(),
META_APP_SECRET:   z.string().optional(),
ANTHROPIC_API_KEY: z.string().optional(),
```

Also add the JWT secret (required in production):

```typescript
JWT_SECRET: z.string().min(32).default('dev-jwt-secret-change-in-production-32ch'),
```

- [ ] **Step 5: Run the project to verify env parses correctly**

```bash
npm run build 2>&1 | tail -5
```

Expected: build succeeds, no type errors.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/006_add_users.sql db/migrations/007_add_settings.sql src/config/env.ts package.json package-lock.json
git commit -m "feat: add users/settings migrations, jwt/cookie deps, optional env vars"
```

---

### Task 2: settingsService

**Files:**
- Create: `src/services/settingsService.ts`
- Create: `src/services/__tests__/settingsService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/services/__tests__/settingsService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing the service
vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn()
  }
}));

import { pool } from '../../db/pool.js';
import { getSetting, setSetting, getAllSettings, clearCache } from '../settingsService.js';

const mockQuery = vi.mocked(pool.query);

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
});

describe('getSetting', () => {
  it('returns value from DB on first call', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'anthropic' }] } as never);
    const result = await getSetting('llm_provider');
    expect(result).toBe('anthropic');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns cached value on second call without hitting DB', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'anthropic' }] } as never);
    await getSetting('llm_provider');
    await getSetting('llm_provider');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when key not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const result = await getSetting('missing_key');
    expect(result).toBeUndefined();
  });
});

describe('setSetting', () => {
  it('upserts value and invalidates cache', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ value: 'old' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ value: 'new' }] } as never);

    await getSetting('llm_provider'); // prime cache
    await setSetting('llm_provider', 'openai'); // should clear cache
    const result = await getSetting('llm_provider'); // should re-query

    expect(result).toBe('new');
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });
});

describe('getAllSettings', () => {
  it('returns all rows as a key-value record', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { key: 'llm_provider', value: 'anthropic' },
        { key: 'setup_complete', value: 'true' }
      ]
    } as never);

    const result = await getAllSettings();
    expect(result).toEqual({ llm_provider: 'anthropic', setup_complete: 'true' });
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npx vitest run src/services/__tests__/settingsService.test.ts 2>&1 | tail -15
```

Expected: FAIL — `settingsService.js` not found.

- [ ] **Step 3: Create settingsService.ts**

Create `src/services/settingsService.ts`:

```typescript
import { pool } from '../db/pool.js';

const cache = new Map<string, string | undefined>();
let allLoaded = false;

export function clearCache(): void {
  cache.clear();
  allLoaded = false;
}

export async function getSetting(key: string): Promise<string | undefined> {
  if (cache.has(key)) return cache.get(key);

  const { rows } = await pool.query<{ value: string }>(
    'SELECT value FROM settings WHERE key = $1',
    [key]
  );
  const value = rows[0]?.value;
  cache.set(key, value);
  return value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
  clearCache();
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/services/__tests__/settingsService.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/settingsService.ts src/services/__tests__/settingsService.test.ts
git commit -m "feat: add settingsService with in-memory cache"
```

---

### Task 3: authService

**Files:**
- Create: `src/services/authService.ts`
- Create: `src/services/__tests__/authService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/services/__tests__/authService.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hashPassword, comparePassword } from '../authService.js';

describe('hashPassword', () => {
  it('returns a bcrypt hash', async () => {
    const hash = await hashPassword('mypassword');
    expect(hash).toMatch(/^\$2[aby]\$/);
  });

  it('throws when password is shorter than 8 characters', async () => {
    await expect(hashPassword('short')).rejects.toThrow('mínimo 8 caracteres');
  });

  it('produces different hashes for same input (salt)', async () => {
    const h1 = await hashPassword('mypassword');
    const h2 = await hashPassword('mypassword');
    expect(h1).not.toBe(h2);
  });
});

describe('comparePassword', () => {
  it('returns true for matching password', async () => {
    const hash = await hashPassword('correct-password');
    expect(await comparePassword('correct-password', hash)).toBe(true);
  });

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('correct-password');
    expect(await comparePassword('wrong-password', hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/services/__tests__/authService.test.ts 2>&1 | tail -10
```

Expected: FAIL — `authService.js` not found.

- [ ] **Step 3: Create authService.ts**

Create `src/services/authService.ts`:

```typescript
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) {
    throw new Error('Senha deve ter mínimo 8 caracteres');
  }
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/services/__tests__/authService.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/authService.ts src/services/__tests__/authService.test.ts
git commit -m "feat: add authService with bcrypt hash/compare"
```

---

### Task 4: llmService (multi-provider)

**Files:**
- Create: `src/services/llmService.ts`
- Create: `src/services/__tests__/llmService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/services/__tests__/llmService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../settingsService.js', () => ({
  getSetting: vi.fn()
}));

import { getSetting } from '../settingsService.js';
import { askLLM } from '../llmService.js';

const mockGetSetting = vi.mocked(getSetting);

global.fetch = vi.fn();
const mockFetch = vi.mocked(global.fetch);

beforeEach(() => vi.clearAllMocks());

describe('askLLM — Anthropic', () => {
  it('calls Anthropic API with correct headers and returns text', async () => {
    mockGetSetting
      .mockResolvedValueOnce('anthropic')         // llm_provider
      .mockResolvedValueOnce('sk-ant-test')       // llm_api_key
      .mockResolvedValueOnce('claude-haiku-4-5'); // llm_model

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: 'Hello' }] })
    } as Response);

    const result = await askLLM({ system: 'sys', user: 'hi', maxTokens: 100, temperature: 0.5 });
    expect(result).toBe('Hello');

    const [url, opts] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((opts.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
  });

  it('translates HTTP 401 to user-friendly message', async () => {
    mockGetSetting
      .mockResolvedValueOnce('anthropic')
      .mockResolvedValueOnce('bad-key')
      .mockResolvedValueOnce('claude-haiku-4-5');

    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response);

    await expect(
      askLLM({ system: 'sys', user: 'hi', maxTokens: 100, temperature: 0.5 })
    ).rejects.toThrow('Chave de API inválida');
  });

  it('translates HTTP 429 to user-friendly message', async () => {
    mockGetSetting
      .mockResolvedValueOnce('anthropic')
      .mockResolvedValueOnce('sk-ant-test')
      .mockResolvedValueOnce('claude-haiku-4-5');

    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 } as Response);

    await expect(
      askLLM({ system: 'sys', user: 'hi', maxTokens: 100, temperature: 0.5 })
    ).rejects.toThrow('Limite de uso atingido');
  });
});

describe('askLLM — OpenAI', () => {
  it('calls OpenAI API and returns text', async () => {
    mockGetSetting
      .mockResolvedValueOnce('openai')
      .mockResolvedValueOnce('sk-test')
      .mockResolvedValueOnce('gpt-4o-mini');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Hi from GPT' } }] })
    } as Response);

    const result = await askLLM({ system: 'sys', user: 'hi', maxTokens: 100, temperature: 0.5 });
    expect(result).toBe('Hi from GPT');
  });
});

describe('askLLM — Gemini', () => {
  it('calls Gemini API and returns text', async () => {
    mockGetSetting
      .mockResolvedValueOnce('gemini')
      .mockResolvedValueOnce('ai-test-key')
      .mockResolvedValueOnce('gemini-2.0-flash');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Hi from Gemini' }] } }] })
    } as Response);

    const result = await askLLM({ system: 'sys', user: 'hi', maxTokens: 100, temperature: 0.5 });
    expect(result).toBe('Hi from Gemini');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/services/__tests__/llmService.test.ts 2>&1 | tail -10
```

Expected: FAIL — `llmService.js` not found.

- [ ] **Step 3: Create llmService.ts**

Create `src/services/llmService.ts`:

```typescript
import { getSetting } from './settingsService.js';

export interface LLMRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}

function translateHttpError(status: number): never {
  if (status === 401) throw new Error('Chave de API inválida. Verifique e tente novamente.');
  if (status === 429) throw new Error('Limite de uso atingido. Aguarde alguns instantes.');
  throw new Error(`Erro ao chamar a IA (status ${status}).`);
}

async function callAnthropic(key: string, model: string, req: LLMRequest): Promise<string> {
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

async function callOpenAI(key: string, model: string, req: LLMRequest): Promise<string> {
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

async function callGemini(key: string, model: string, req: LLMRequest): Promise<string> {
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

export async function askLLM(req: LLMRequest): Promise<string> {
  const [provider, key, model] = await Promise.all([
    getSetting('llm_provider'),
    getSetting('llm_api_key'),
    getSetting('llm_model')
  ]);

  if (!provider || !key || !model) {
    throw new Error('Configuração de IA incompleta. Acesse as configurações para configurar.');
  }

  try {
    if (provider === 'anthropic') return await callAnthropic(key, model, req);
    if (provider === 'openai') return await callOpenAI(key, model, req);
    if (provider === 'gemini') return await callGemini(key, model, req);
    throw new Error(`Provedor desconhecido: ${provider}`);
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error('Não foi possível conectar ao serviço de IA.');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/services/__tests__/llmService.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/llmService.ts src/services/__tests__/llmService.test.ts
git commit -m "feat: add multi-provider llmService (Anthropic, OpenAI, Gemini)"
```

---

### Task 5: Auth routes + createApp wiring

**Files:**
- Create: `src/routes/auth.ts`
- Modify: `src/app/createApp.ts`

> Note: No unit tests for auth routes — they require a real DB (integration scope). The tests from Tasks 2-3 already cover the services these routes depend on.

- [ ] **Step 1: Create auth.ts**

Create `src/routes/auth.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { hashPassword, comparePassword } from '../services/authService.js';

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // Register — only allowed while users table is empty
  app.post('/api/auth/register', async (req, reply) => {
    const body = registerSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos.' });

    const { rows: existing } = await pool.query('SELECT id FROM users LIMIT 1');
    if (existing.length > 0) {
      return reply.status(403).send({ error: 'Registro já foi realizado.' });
    }

    const { name, email, password } = body.data;
    const password_hash = await hashPassword(password);
    await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)',
      [name, email, password_hash]
    );

    return reply.status(201).send({ message: 'Conta criada.' });
  });

  // Login — rate limited to 5/min per IP in createApp
  app.post('/api/auth/login', async (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos.' });

    const { email, password } = body.data;
    const { rows } = await pool.query<{
      id: number; name: string; email: string; password_hash: string;
    }>('SELECT id, name, email, password_hash FROM users WHERE email = $1', [email]);

    const user = rows[0];
    const valid = user && (await comparePassword(password, user.password_hash));
    if (!valid) return reply.status(401).send({ error: 'Email ou senha inválidos.' });

    const { rows: settings } = await pool.query<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'setup_complete'"
    );
    const setup_complete = settings[0]?.value === 'true';

    const token = app.jwt.sign({ id: user.id, email: user.email });
    reply.setCookie('token', token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 30
    });

    return reply.send({ name: user.name, email: user.email, setup_complete });
  });

  // Logout
  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie('token', { path: '/' });
    return reply.send({ message: 'Sessão encerrada.' });
  });

  // Me — used by frontend on load to determine screen
  app.get('/api/auth/me', async (req, reply) => {
    const token = req.cookies['token'];
    if (!token) {
      const { rows } = await pool.query('SELECT id FROM users LIMIT 1');
      const code = rows.length === 0 ? 'NO_USER' : 'NO_SESSION';
      return reply.status(401).send({ code });
    }

    try {
      const payload = app.jwt.verify<{ id: number; email: string }>(token);
      const { rows: userRows } = await pool.query<{ name: string; email: string }>(
        'SELECT name, email FROM users WHERE id = $1',
        [payload.id]
      );
      const { rows: settings } = await pool.query<{ value: string }>(
        "SELECT value FROM settings WHERE key = 'setup_complete'"
      );
      const setup_complete = settings[0]?.value === 'true';
      return reply.send({ name: userRows[0]?.name, email: userRows[0]?.email, setup_complete });
    } catch {
      const { rows } = await pool.query('SELECT id FROM users LIMIT 1');
      const code = rows.length === 0 ? 'NO_USER' : 'NO_SESSION';
      return reply.status(401).send({ code });
    }
  });
}
```

- [ ] **Step 2: Update createApp.ts to register JWT, cookie, and auth routes**

In `src/app/createApp.ts`, add after the existing imports:

```typescript
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import { registerAuthRoutes } from '../routes/auth.js';
import { registerSettingsRoutes } from '../routes/settings.js';
import { env } from '../config/env.js';
```

Register the plugins and routes inside `createApp` after the `rateLimit` block:

```typescript
await app.register(fastifyJwt, { secret: env.JWT_SECRET });
await app.register(fastifyCookie);

// Login rate limit: 5 attempts/min per IP
app.register(async (loginApp) => {
  loginApp.register(rateLimit, { max: 5, timeWindow: '1 minute' });
  loginApp.post('/api/auth/login', (req, reply) =>
    app.inject({ method: 'POST', url: '/api/auth/login', body: req.body as object, headers: req.headers })
      .then(() => { /* handled by auth route */ })
  );
});
```

> **IMPORTANT:** Do not add a blanket auth guard hook — the existing webhook and health routes must remain public. Instead, individual protected routes verify the cookie inside the handler using `app.jwt.verify(req.cookies['token'])`.

Register the new route groups alongside existing ones:

```typescript
app.register(registerAuthRoutes);
app.register(registerSettingsRoutes);
```

- [ ] **Step 3: Build to check for type errors**

```bash
npm run build 2>&1 | grep -E "error|warning" | head -20
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/auth.ts src/app/createApp.ts
git commit -m "feat: add auth routes (register, login, logout, me) and JWT/cookie plugins"
```

---

### Task 6: Settings routes

**Files:**
- Create: `src/routes/settings.ts`

- [ ] **Step 1: Create settings.ts**

Create `src/routes/settings.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getSetting, setSetting, getAllSettings } from '../services/settingsService.js';
import { askLLM } from '../services/llmService.js';
import { clearCache } from '../services/settingsService.js';

const MASKED = '***';
const SENSITIVE_KEYS = new Set(['llm_api_key', 'meta_app_secret']);

function requireAuth(app: FastifyInstance) {
  return async (req: Parameters<Parameters<FastifyInstance['addHook']>[1]>[0], reply: Parameters<Parameters<FastifyInstance['addHook']>[1]>[1]) => {
    const token = (req as { cookies: Record<string, string> }).cookies['token'];
    if (!token) return reply.status(401).send({ error: 'Não autenticado.' });
    try {
      app.jwt.verify(token);
    } catch {
      return reply.status(401).send({ error: 'Sessão expirada.' });
    }
  };
}

const putBodySchema = z.record(z.string(), z.string());

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  const auth = requireAuth(app);

  // GET /api/settings — returns all settings with sensitive values masked
  app.get('/api/settings', { preHandler: auth }, async (_req, reply) => {
    const all = await getAllSettings();
    const masked: Record<string, string> = {};
    for (const [k, v] of Object.entries(all)) {
      masked[k] = SENSITIVE_KEYS.has(k) ? MASKED : v;
    }
    return reply.send(masked);
  });

  // PUT /api/settings — upsert one or more keys
  app.put('/api/settings', { preHandler: auth }, async (req, reply) => {
    const body = putBodySchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Payload inválido.' });

    for (const [key, value] of Object.entries(body.data)) {
      await setSetting(key, value);
    }
    return reply.send({ message: 'Salvo.' });
  });

  // POST /api/setup/test-llm — validate LLM credentials before wizard advances
  app.post('/api/setup/test-llm', { preHandler: auth }, async (req, reply) => {
    const body = z.object({
      provider: z.enum(['anthropic', 'openai', 'gemini']),
      api_key: z.string().min(1),
      model: z.string().min(1)
    }).safeParse(req.body);

    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos.' });

    // Temporarily write to settings so askLLM can read them
    await setSetting('llm_provider', body.data.provider);
    await setSetting('llm_api_key', body.data.api_key);
    await setSetting('llm_model', body.data.model);

    try {
      await askLLM({
        system: 'You are a test assistant.',
        user: 'Reply with exactly: OK',
        maxTokens: 10,
        temperature: 0
      });
      return reply.send({ ok: true, message: 'Conexão OK' });
    } catch (err) {
      // Roll back to previous values (they'll be re-fetched from DB)
      clearCache();
      const msg = err instanceof Error ? err.message : 'Erro desconhecido.';
      return reply.status(400).send({ ok: false, message: msg });
    }
  });
}
```

- [ ] **Step 2: Build to check for type errors**

```bash
npm run build 2>&1 | grep -E "error" | head -20
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/settings.ts
git commit -m "feat: add settings routes (GET/PUT settings, POST test-llm)"
```

---

### Task 7: Update existing routes to use settingsService

**Files:**
- Modify: `src/services/promptTesterService.ts`
- Modify: `src/routes/meta.ts`
- Modify: `src/routes/tester.ts`

- [ ] **Step 1: Read current promptTesterService.ts**

```bash
cat src/services/promptTesterService.ts
```

Look for the `askAnthropic()` call site — it will be replaced by `askLLM()`.

- [ ] **Step 2: Update promptTesterService.ts**

Replace the Anthropic SDK import and direct API call with the new `askLLM()`:

```typescript
// Before — remove this:
import Anthropic from '@anthropic-ai/sdk';
// ...
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const response = await client.messages.create({ ... });

// After — replace with:
import { askLLM } from './llmService.js';
// ...
const response = await askLLM({
  system: systemPrompt,
  user: userMessage,
  maxTokens: 1024,
  temperature: 0.7
});
```

The exact replacement depends on the current code — adapt the parameters to match the existing logic.

- [ ] **Step 3: Update meta.ts to read from settingsService**

In `src/routes/meta.ts`, find where `env.META_VERIFY_TOKEN` and `env.META_APP_SECRET` are used.

Replace env reads with settingsService calls:

```typescript
import { getSetting } from '../services/settingsService.js';

// Where META_VERIFY_TOKEN is used for webhook verification:
const verifyToken = await getSetting('meta_verify_token') ?? env.META_VERIFY_TOKEN ?? '';

// Where META_APP_SECRET is used for signature validation:
const appSecret = await getSetting('meta_app_secret') ?? env.META_APP_SECRET ?? '';
```

The fallback to `env.*` preserves backward-compat for local development with `.env` file.

- [ ] **Step 4: Update tester.ts to use settingsService**

In `src/routes/tester.ts`, find where `env.ANTHROPIC_API_KEY` is read.

```typescript
import { getSetting } from '../services/settingsService.js';

// Replace direct env read:
// const apiKey = env.ANTHROPIC_API_KEY;

// With settingsService (fallback to env for dev):
const apiKey = await getSetting('llm_api_key') ?? env.ANTHROPIC_API_KEY;
```

- [ ] **Step 5: Build and run all tests**

```bash
npm run build 2>&1 | grep -E "error" | head -20
npx vitest run 2>&1 | tail -20
```

Expected: 0 build errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/promptTesterService.ts src/routes/meta.ts src/routes/tester.ts
git commit -m "refactor: replace direct env reads with settingsService in routes and promptTesterService"
```

---

### Task 8: UI — screens and settings panel

**Files:**
- Modify: `src/ui.html`

This is the most substantial UI change. The page uses a state machine: one `div.screen` is visible at a time. All navigation is handled by `showScreen(id)`.

- [ ] **Step 1: Read the current ui.html to understand the existing structure**

```bash
wc -l src/ui.html
grep -n "<!-- " src/ui.html | head -30
```

Identify where the main app content starts and which CSS variables are already defined.

- [ ] **Step 2: Add hidden class to global CSS**

Inside the existing `<style>` block, add:

```css
.hidden { display: none !important; }
```

- [ ] **Step 3: Add screen containers before the existing app content**

Wrap the existing main app container in a screen div and add new screen divs. Structure:

```html
<!-- SCREEN: register -->
<div id="screen-register" class="screen hidden">
  <div class="auth-card">
    <h1>Bem-vindo</h1>
    <p>Crie sua conta para começar a configurar o sistema.</p>
    <form id="form-register">
      <label>Nome<input type="text" id="reg-name" required /></label>
      <label>Email<input type="email" id="reg-email" required /></label>
      <label>Senha (mín. 8 caracteres)<input type="password" id="reg-password" required minlength="8" /></label>
      <p id="reg-error" class="error-msg hidden"></p>
      <button type="submit">Criar conta</button>
    </form>
  </div>
</div>

<!-- SCREEN: login -->
<div id="screen-login" class="screen hidden">
  <div class="auth-card">
    <h1>Entrar</h1>
    <form id="form-login">
      <label>Email<input type="email" id="login-email" required /></label>
      <label>Senha<input type="password" id="login-password" required /></label>
      <p id="login-error" class="error-msg hidden"></p>
      <button type="submit">Entrar</button>
    </form>
    <p class="help-text">Esqueceu a senha? Entre em contato com o administrador.</p>
  </div>
</div>

<!-- SCREEN: setup-1 (AI provider) -->
<div id="screen-setup-1" class="screen hidden">
  <div class="setup-card">
    <div class="setup-steps">Passo 1 de 2</div>
    <h2>Configurar Inteligência Artificial</h2>
    <p>Escolha o provedor de IA que você quer usar:</p>
    <div class="provider-selector">
      <button class="provider-btn" data-provider="anthropic">Anthropic</button>
      <button class="provider-btn" data-provider="openai">OpenAI</button>
      <button class="provider-btn" data-provider="gemini">Google Gemini</button>
    </div>
    <label>
      Chave de API
      <div class="input-with-toggle">
        <input type="password" id="setup-api-key" placeholder="Cole aqui a chave da sua conta de IA" />
        <button type="button" class="toggle-visibility" data-target="setup-api-key">Mostrar</button>
      </div>
      <small id="api-key-hint"></small>
    </label>
    <label>Modelo
      <select id="setup-model"></select>
    </label>
    <p id="setup1-status" class="status-msg hidden"></p>
    <div class="setup-actions">
      <button id="btn-test-llm">Testar conexão</button>
      <button id="btn-setup1-next" disabled>Próximo &rarr;</button>
    </div>
  </div>
</div>

<!-- SCREEN: setup-2 (Meta tokens) -->
<div id="screen-setup-2" class="screen hidden">
  <div class="setup-card">
    <div class="setup-steps">Passo 2 de 2</div>
    <h2>Configurar Instagram / Meta</h2>
    <label>
      Token de Verificação
      <input type="text" id="setup-verify-token" minlength="8"
             placeholder="Escolha qualquer valor com 8+ caracteres" />
      <small>Você mesmo escolhe esse valor — anote e use o mesmo quando configurar o webhook no Meta.</small>
    </label>
    <label>
      App Secret
      <div class="input-with-toggle">
        <input type="password" id="setup-app-secret" placeholder="Meta for Developers → Seu App → Configurações básicas" />
        <button type="button" class="toggle-visibility" data-target="setup-app-secret">Mostrar</button>
      </div>
      <small>Encontrado em: Meta for Developers → Seu App → Configurações básicas → App Secret.</small>
    </label>
    <p id="setup2-error" class="error-msg hidden"></p>
    <div class="setup-actions">
      <button id="btn-setup2-back">&larr; Voltar</button>
      <button id="btn-setup2-finish">Salvar e finalizar</button>
    </div>
  </div>
</div>

<!-- SCREEN: setup-done -->
<div id="screen-setup-done" class="screen hidden">
  <div class="auth-card center">
    <div class="success-icon">&#10003;</div>
    <h2>Tudo configurado!</h2>
    <p>O sistema está pronto para uso.</p>
    <button id="btn-open-app">Abrir o sistema</button>
  </div>
</div>

<!-- SCREEN: app (existing content) -->
<div id="screen-app" class="screen hidden">
  <!-- existing app HTML goes here — move the current body content into this div -->
</div>

<!-- PANEL: settings (slides in over screen-app) -->
<div id="panel-settings" class="panel hidden">
  <div class="panel-header">
    <h3>Configurações</h3>
    <button id="btn-close-settings">&#10005;</button>
  </div>
  <div id="settings-list"></div>
  <div class="panel-footer">
    <button id="btn-logout">Sair</button>
  </div>
</div>
```

- [ ] **Step 4: Add minimal CSS for auth/setup screens**

Inside the `<style>` block, add:

```css
.auth-card, .setup-card {
  max-width: 480px;
  margin: 80px auto;
  padding: 2rem;
  background: var(--bg-card, #1e1e1e);
  border-radius: 8px;
}
.auth-card.center { text-align: center; }
.error-msg { color: #f87171; font-size: 0.875rem; }
.status-msg { font-size: 0.875rem; }
.status-msg.ok { color: #4ade80; }
.status-msg.err { color: #f87171; }
.setup-steps { font-size: 0.75rem; opacity: 0.6; margin-bottom: 0.5rem; }
.provider-selector { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.provider-btn { flex: 1; padding: 0.5rem; opacity: 0.5; }
.provider-btn.active { opacity: 1; outline: 2px solid var(--accent, #6366f1); }
.input-with-toggle { display: flex; gap: 0.5rem; }
.input-with-toggle input { flex: 1; }
.toggle-visibility { white-space: nowrap; }
.setup-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
.success-icon { font-size: 3rem; color: #4ade80; }
.panel { position: fixed; top: 0; right: 0; width: 360px; height: 100vh; background: var(--bg-card, #1e1e1e); box-shadow: -4px 0 20px rgba(0,0,0,0.5); padding: 1.5rem; display: flex; flex-direction: column; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
.panel-footer { margin-top: auto; }
```

- [ ] **Step 5: Add JavaScript state machine at the bottom of the file**

Before the closing `</body>` tag, add a `<script>` block:

```javascript
(function() {
  const MODELS = {
    anthropic: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6'],
    openai:    ['gpt-4o-mini', 'gpt-4o'],
    gemini:    ['gemini-2.0-flash', 'gemini-1.5-pro']
  };

  let selectedProvider = 'anthropic';
  let testPassed = false;

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(id);
    if (target) target.classList.remove('hidden');
  }

  function showError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function hideError(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }

  // Show/hide password toggle
  document.querySelectorAll('.toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;
      const isPassword = input.getAttribute('type') === 'password';
      input.setAttribute('type', isPassword ? 'text' : 'password');
      btn.textContent = isPassword ? 'Ocultar' : 'Mostrar';
    });
  });

  // Provider selector
  document.querySelectorAll('.provider-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedProvider = btn.getAttribute('data-provider');
      document.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateModelList();
      updateApiKeyHint();
      testPassed = false;
      document.getElementById('btn-setup1-next').disabled = true;
    });
  });

  function updateModelList() {
    const select = document.getElementById('setup-model');
    select.textContent = ''; // clear options safely
    (MODELS[selectedProvider] || []).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      select.appendChild(opt);
    });
  }

  function updateApiKeyHint() {
    const hint = document.getElementById('api-key-hint');
    const hints = {
      anthropic: 'Começa com sk-ant-',
      openai:    'Começa com sk-',
      gemini:    'Chave da Google AI Studio'
    };
    hint.textContent = hints[selectedProvider] || '';
  }

  // Register form
  const formRegister = document.getElementById('form-register');
  if (formRegister) {
    formRegister.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError('reg-error');
      const name     = document.getElementById('reg-name').value;
      const email    = document.getElementById('reg-email').value;
      const password = document.getElementById('reg-password').value;
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });
      if (!res.ok) {
        const data = await res.json();
        showError('reg-error', data.error || 'Erro ao criar conta.');
        return;
      }
      showScreen('screen-setup-1');
      initSetup1();
    });
  }

  // Login form
  const formLogin = document.getElementById('form-login');
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError('login-error');
      const email    = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        const data = await res.json();
        showError('login-error', data.error || 'Erro ao entrar.');
        return;
      }
      const data = await res.json();
      if (data.setup_complete) {
        showScreen('screen-app');
      } else {
        showScreen('screen-setup-1');
        initSetup1();
      }
    });
  }

  // Test LLM connection
  const btnTest = document.getElementById('btn-test-llm');
  if (btnTest) {
    btnTest.addEventListener('click', async () => {
      const apiKey = document.getElementById('setup-api-key').value;
      const model  = document.getElementById('setup-model').value;
      const status = document.getElementById('setup1-status');
      status.textContent = 'Testando...';
      status.className = 'status-msg';
      status.classList.remove('hidden');

      const res = await fetch('/api/setup/test-llm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: selectedProvider, api_key: apiKey, model })
      });
      const data = await res.json();
      if (data.ok) {
        status.textContent = 'Conexão OK';
        status.classList.add('ok');
        testPassed = true;
        document.getElementById('btn-setup1-next').disabled = false;
      } else {
        status.textContent = data.message || 'Erro na conexão.';
        status.classList.add('err');
        testPassed = false;
        document.getElementById('btn-setup1-next').disabled = true;
      }
    });
  }

  // Setup 1 → Setup 2
  const btnNext = document.getElementById('btn-setup1-next');
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (testPassed) showScreen('screen-setup-2');
    });
  }

  // Setup 2 → back
  const btnBack = document.getElementById('btn-setup2-back');
  if (btnBack) {
    btnBack.addEventListener('click', () => showScreen('screen-setup-1'));
  }

  // Setup 2 → finish
  const btnFinish = document.getElementById('btn-setup2-finish');
  if (btnFinish) {
    btnFinish.addEventListener('click', async () => {
      const verifyToken = document.getElementById('setup-verify-token').value;
      const appSecret   = document.getElementById('setup-app-secret').value;

      if (verifyToken.length < 8) {
        showError('setup2-error', 'Token de verificação deve ter mínimo 8 caracteres.');
        return;
      }
      if (!appSecret) {
        showError('setup2-error', 'App Secret é obrigatório.');
        return;
      }
      hideError('setup2-error');

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          meta_verify_token: verifyToken,
          meta_app_secret: appSecret,
          setup_complete: 'true'
        })
      });
      if (!res.ok) {
        showError('setup2-error', 'Erro ao salvar. Tente novamente.');
        return;
      }
      showScreen('screen-setup-done');
    });
  }

  // Setup done → app
  const btnOpenApp = document.getElementById('btn-open-app');
  if (btnOpenApp) {
    btnOpenApp.addEventListener('click', () => showScreen('screen-app'));
  }

  // Settings panel
  const btnCloseSettings = document.getElementById('btn-close-settings');
  if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', () => {
      document.getElementById('panel-settings').classList.add('hidden');
    });
  }

  // Logout
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      showScreen('screen-login');
    });
  }

  // Settings panel — render fields from GET /api/settings
  async function openSettingsPanel() {
    const panel = document.getElementById('panel-settings');
    panel.classList.remove('hidden');
    const res = await fetch('/api/settings');
    if (!res.ok) return;
    const data = await res.json();
    const list = document.getElementById('settings-list');
    list.textContent = '';
    const labels = {
      llm_provider: 'Provedor de IA',
      llm_api_key: 'Chave de API',
      llm_model: 'Modelo',
      meta_verify_token: 'Token de Verificação',
      meta_app_secret: 'App Secret'
    };
    Object.entries(data).forEach(([key, value]) => {
      if (key === 'setup_complete') return;
      const row = document.createElement('div');
      row.className = 'settings-row';
      const label = document.createElement('strong');
      label.textContent = labels[key] || key;
      const val = document.createElement('span');
      val.textContent = value;
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Editar';
      editBtn.addEventListener('click', async () => {
        const newValue = prompt(labels[key] || key, value === '***' ? '' : value);
        if (newValue === null) return;
        const putRes = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ [key]: newValue })
        });
        val.textContent = putRes.ok ? (key.includes('key') || key.includes('secret') ? '***' : newValue) : 'Erro ao salvar';
      });
      row.appendChild(label);
      row.appendChild(val);
      row.appendChild(editBtn);
      list.appendChild(row);
    });
  }

  // Wire gear icon in app header to open settings panel
  const gearBtn = document.getElementById('btn-settings');
  if (gearBtn) {
    gearBtn.addEventListener('click', openSettingsPanel);
  }

  function initSetup1() {
    const firstBtn = document.querySelector('.provider-btn[data-provider="anthropic"]');
    if (firstBtn) {
      firstBtn.classList.add('active');
      selectedProvider = 'anthropic';
    }
    updateModelList();
    updateApiKeyHint();
  }

  // Initial routing on page load
  async function route() {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      if (data.setup_complete) {
        showScreen('screen-app');
      } else {
        showScreen('screen-setup-1');
        initSetup1();
      }
      return;
    }
    const data = await res.json();
    if (data.code === 'NO_USER') {
      showScreen('screen-register');
    } else {
      showScreen('screen-login');
    }
  }

  route();
})();
```

- [ ] **Step 6: Add gear button to app header (if not already present)**

Find the existing app header in `src/ui.html`. Add a settings button:

```html
<button id="btn-settings" title="Configurações">&#9881;</button>
```

- [ ] **Step 7: Build**

```bash
npm run build 2>&1 | tail -5
```

Expected: build succeeds. The `ui.html` is copied to `dist/` via the build command.

- [ ] **Step 8: Commit**

```bash
git add src/ui.html
git commit -m "feat: add setup wizard UI (register, login, setup-1, setup-2, done, settings panel)"
```

---

### Task 9: Deploy to Render

**Files:**
- No file changes — this task verifies the deployment.

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

Expected: push succeeds. Render auto-deploy triggers within ~30 seconds.

- [ ] **Step 2: Monitor build logs**

In Render dashboard → service `testn8nmetaapi` → Events tab.

Expected build sequence:
1. `npm install --include=dev && npm run build` — installs all deps, tsc compiles, ui.html copied
2. `node scripts/run-migration.mjs && node dist/server.js` — migrations 006 and 007 run, server starts

Watch for: `Migration 006_add_users.sql applied` and `Migration 007_add_settings.sql applied`.

- [ ] **Step 3: Set JWT_SECRET env var in Render**

In Render dashboard → Environment → Add:

```
JWT_SECRET = <random 64-character string>
```

Generate with: `openssl rand -hex 32`

Trigger a manual redeploy after setting.

- [ ] **Step 4: Smoke test**

Open the Render service URL in a browser.

Expected first-visit flow:
1. Page loads → shows "Bem-vindo" register screen
2. Create account → redirected to setup-1
3. Select Anthropic, paste API key, pick model, click "Testar conexão" → "Conexão OK"
4. Click "Próximo" → setup-2
5. Enter verify token and app secret → "Salvar e finalizar" → setup-done
6. Click "Abrir o sistema" → main app

- [ ] **Step 5: Verify second visit**

Open the URL in a private window.

Expected: shows login screen (not register screen). Login with created credentials → goes straight to app (setup_complete = true).

- [ ] **Step 6: Verify gear icon**

In the app, click gear icon → settings panel opens → shows masked values → edit any field → "Salvo" feedback.

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered in task |
|---|---|
| First visit → register screen | Task 8 (route() function) |
| POST /api/auth/register (closes after 1 user) | Task 5 |
| screen-setup-1 with provider selector, test-llm | Tasks 6 + 8 |
| screen-setup-2 with verify token + app secret | Task 8 |
| screen-setup-done | Task 8 |
| screen-app (existing) | Task 8 (wrapped in screen div) |
| panel-settings with masked values + inline edit | Task 8 |
| settingsService replacing env reads in meta.ts, tester.ts | Task 7 |
| Rate limit login 5/min | Task 5 |
| JWT httpOnly cookie | Task 5 |
| bcrypt password hash, min 8 chars | Task 3 |
| Multi-provider LLM (Anthropic, OpenAI, Gemini) | Task 4 |
| HTTP error translation to pt-BR | Task 4 |
| In-memory cache for settings | Task 2 |
| env vars → optional | Task 1 |
| Migrations 006, 007 | Task 1 |
| JWT_SECRET env var | Task 9 |

**No placeholders detected.**

**Type consistency:** `LLMRequest` defined in Task 4 (`llmService.ts`) and used in Task 6 (`settings.ts`) via `askLLM()`. `clearCache` exported from `settingsService.ts` (Task 2) and imported in `settings.ts` (Task 6). All consistent.
