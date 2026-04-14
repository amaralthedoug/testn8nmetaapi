# Engineering Cleanup — Design Spec

**Date:** 2026-04-14
**Scope:** Internal code quality improvement. No external behavior changes. No new features.
**Goal:** Reorganize file structure following good practices, eliminate redundant layers, fix known bugs, and improve internal patterns (LLM abstraction, cache TTL, DI, typed errors, route I/O separation).

---

## 1. File Structure Reorganization

### What disappears

| Path | Reason |
|---|---|
| `src/controllers/` (entire folder) | Thin pass-throughs — merged into their corresponding route files |
| `src/schemas/` (entire folder) | Single file — moved to the integration it belongs to |
| `src/config/routingConfig.ts` | Moved to `src/routing/config.ts` — belongs to the routing domain |

### What moves

| From | To |
|---|---|
| `src/controllers/metaWebhookController.ts` | Merged into `src/integrations/meta/routes.ts` |
| `src/controllers/unifiedWebhookController.ts` | Merged into `src/routes/webhooks/unified.ts` |
| `src/schemas/metaWebhook.ts` | `src/integrations/meta/schema.ts` |
| `src/config/routingConfig.ts` | `src/routing/config.ts` |
| `llmService.ts` provider functions (`callAnthropic`, `callOpenAI`, `callGemini`, `callOpenRouter`) | `src/integrations/llm/{anthropic,openai,gemini,openrouter}.ts` |

### What is created

| Path | Purpose |
|---|---|
| `src/app/plugins.ts` | Plugin registration extracted from `createApp.ts` |
| `src/integrations/llm/registry.ts` | Maps provider name → call function |
| `src/integrations/llm/anthropic.ts` | Anthropic HTTP call, isolated |
| `src/integrations/llm/openai.ts` | OpenAI HTTP call, isolated |
| `src/integrations/llm/gemini.ts` | Gemini HTTP call, isolated |
| `src/integrations/llm/openrouter.ts` | OpenRouter HTTP call, isolated |
| `src/services/testerFileService.ts` | File I/O abstraction for prompt tester |
| `src/types/errors.ts` | `AppError` base class and domain subclasses |

### Final structure

```
src/
  app/
    createApp.ts          (~40 lines: orchestrates plugins + wiring + routes)
    plugins.ts            (helmet, jwt, metrics, rateLimit, rawBody, swagger)

  config/
    env.ts

  routing/
    config.ts             (was config/routingConfig.ts)
    resolveRoute.ts
    applyFieldMap.ts

  integrations/
    meta/
      verification.ts
      normalizer.ts
      schema.ts           (was schemas/metaWebhook.ts)
      routes.ts           (merged routes/meta.ts + controllers/metaWebhookController.ts)
    n8n/
      client.ts
    instagram/
      mappers/v1.ts
      schema.ts
    llm/
      anthropic.ts
      openai.ts
      gemini.ts
      openrouter.ts
      registry.ts

  services/
    llmService.ts
    settingsService.ts
    leadIngestionService.ts
    n8nDeliveryService.ts
    authService.ts
    promptTesterService.ts
    testerFileService.ts

  routes/
    health.ts
    auth.ts
    settings.ts
    tester.ts
    manychat.ts
    webhooks/
      unified.ts

  repositories/
  workers/
    retryWorker.ts
  db/
    client.ts
  utils/
    logger.ts
    hash.ts
    correlation.ts
    normalize.ts          (verify usage — remove if dead)
  types/
    domain.ts
    errors.ts

  server.ts
  ui.html
```

---

## 2. Bug Fix — `promptTesterService.ts`

**Problem:** `askAnthropic(apiKey, model, ...)` ignores received params and delegates to `askLLM()` (reads from DB). Tester UI key/model fields have no effect.

**Fix:** When `apiKey` is provided, call Anthropic directly with the received params. When not provided, fall back to `askLLM()` (DB config).

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
    return callAnthropicDirect(apiKey, model, systemPrompt, userMessage, maxTokens, temperature);
  }
  return askLLM({ system: systemPrompt, user: userMessage, maxTokens, temperature });
}
```

`callAnthropicDirect` is the raw HTTP call extracted from `integrations/llm/anthropic.ts`.

---

## 3. LLM Provider Registry — `integrations/llm/`

**Problem:** `llmService.ts` has 4 near-identical `callX()` functions. Adding a 5th provider requires editing `askLLM()` itself.

**Design:** Each provider is a standalone file. `registry.ts` maps provider name to its function. `askLLM()` uses `getProvider(name)` — no if-chain.

```typescript
// integrations/llm/registry.ts
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

```typescript
// services/llmService.ts
export async function askLLM(req: LLMRequest): Promise<string> {
  const [provider, key, model] = await Promise.all([
    getSetting('llm_provider'),
    getSetting('llm_api_key'),
    getSetting('llm_model'),
  ]);
  if (!provider || !key || !model) throw new LLMError('Configuração de IA incompleta.');
  return getProvider(provider)(key, model, req);
}
```

Adding a 6th provider = create the file + add one line to `registry.ts`.

---

## 4. Typed Domain Errors — `types/errors.ts`

**Problem:** Services throw `new Error('user-facing Portuguese message')`. HTTP handlers can't distinguish domain errors from unexpected errors — all become 500 or require string matching.

**Design:** Minimal hierarchy. No framework. Each error carries `statusCode` and `code` for uniform handling in a Fastify `onError` hook.

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

`createApp.ts` registers a global `setErrorHandler` that checks `instanceof AppError` and returns `{ error: err.message, code: err.code }` with the correct status. Unexpected errors return 500 with a generic message.

---

## 5. Settings Cache TTL — `settingsService.ts`

**Problem:** Module-level `Map` cache never expires. Stale values persist across the process lifetime with no time-based invalidation.

**Design:** Each cache entry stores `value` and `expiresAt`. Default TTL: 60 seconds. Configurable for tests.

```typescript
const TTL_MS = 60_000;

interface CacheEntry { value: string | undefined; expiresAt: number; }
const cache = new Map<string, CacheEntry>();

function isFresh(entry: CacheEntry): boolean {
  return Date.now() < entry.expiresAt;
}

export async function getSetting(key: string): Promise<string | undefined> {
  const entry = cache.get(key);
  if (entry && isFresh(entry)) return entry.value;

  const { rows } = await pool.query<{ value: string }>(
    'SELECT value FROM settings WHERE key = $1', [key]
  );
  const value = rows[0]?.value;
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
  cache.delete(key); // invalidate only this key, not the entire cache
}
```

---

## 6. File I/O Extraction — `services/testerFileService.ts`

**Problem:** `routes/tester.ts` contains `readdir`, `readFile`, and `process.cwd()` calls. I/O concerns mixed into the HTTP layer.

**Design:** New service owns all file access. Routes call the service.

```typescript
// services/testerFileService.ts
export async function listPrompts(): Promise<string[]>
export async function listCases(): Promise<string[]>
export async function listResults(): Promise<ResultMeta[]>
export async function readPrompt(name: string): Promise<string>
export async function readCase(name: string): Promise<CasesFile>
```

Route `POST /api/run` becomes:

```typescript
const [promptContent, cases] = await Promise.all([
  testerFileService.readPrompt(promptFile),
  testerFileService.readCase(casesFile),
]);
```

---

## 7. Dependency Injection — `LeadIngestionService`

**Problem:** `constructor(private deliveryService = new N8nDeliveryService())` creates a hidden dependency. The default param makes the coupling implicit and harder to see in tests.

**Fix:** Remove the default. `createApp.ts` is the single place that instantiates and injects all dependencies.

```typescript
// services/leadIngestionService.ts
constructor(
  private readonly deliveryService: N8nDeliveryService,
  private readonly routingConfig: RoutingConfig | null
) {}

// app/createApp.ts
const routingConfig = await loadRoutingConfig();
const deliveryService = new N8nDeliveryService();
app.decorate('leadIngestionService', new LeadIngestionService(deliveryService, routingConfig));
```

---

## 8. `createApp.ts` Decomposition

**Problem:** `createApp.ts` (~130 lines) mixes plugin registration, service wiring, and route registration in a single function.

**Design:** Extract plugin registration to `app/plugins.ts`. `createApp.ts` orchestrates three steps: register plugins → wire services → register routes.

```typescript
// app/createApp.ts (~40 lines)
export const createApp = async (options: CreateAppOptions) => {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await registerPlugins(app, options);  // app/plugins.ts
  await wireServices(app);              // inline: decorate + routing config
  registerRoutes(app);                  // inline: all app.register() calls
  registerErrorHandler(app);            // inline: AppError → HTTP response

  return app;
};
```

---

## Dead Code Audit

During implementation, verify:

- `src/utils/normalize.ts` — check if imported anywhere; remove if unused
- All `export` symbols in `types/domain.ts` — check for unreferenced types
- `routing/` — verify `RoutingConfig` type is not duplicated between `config.ts` and `domain.ts`

---

## Constraints

- All existing tests must pass after each step — no skipping
- No change to public API routes, request/response contracts, or DB schema
- No new npm dependencies
- Fastify v4 compatibility maintained throughout
- Each step is an independent commit with passing `npm test && npx tsc --noEmit`
