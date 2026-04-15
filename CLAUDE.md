# CLAUDE.md

This file gives Claude Code the context it needs to work effectively in this repository. Read it fully before writing any code.

---

## Current State — read this first

**Last updated:** 2026-04-14

### What is built and working

| Layer | Status | Notes |
|---|---|---|
| Meta webhook ingestion | ✅ Production | HMAC validation, dedup, PostgreSQL, n8n delivery, retries |
| Multi-tenant routing | ✅ Production | `routing.json` cascade: form → page → default → env |
| Instagram SDR unified endpoint | ✅ Production | `POST /webhooks/v1/leads`, mapper registry, `lead_sources` table |
| Dead-letter replay API | ✅ Production | `GET /admin/leads/failed`, `POST /admin/leads/:id/replay`, Bearer auth |
| OpenAPI docs + Prometheus metrics | ✅ Production | `/docs`, `/metrics` |
| Auth system | ✅ Production | JWT cookie, register (auto-login), login, logout, `/api/auth/me` |
| Setup wizard UI (`src/ui.html`) | ✅ Production | Screens: register → setup-1 (LLM) → setup-2 (Meta) → done → app + settings panel |
| LLM settings service | ✅ Production | Anthropic, OpenAI, Gemini, OpenRouter; `settingsService` with cache; `007_add_settings.sql` |
| Prompt tester | ✅ Production | Tester tab + demo tab + history tab; JWT-protected; reads LLM config from DB |
| Security hardening | ✅ Production | Path traversal guard, tester auth, settings allowlist, timing-safe comparisons |

### Known issues / tech debt

| Issue | Location | Impact |
|---|---|---|
| `askAnthropic()` in promptTesterService ignores `apiKey`/`model` params — calls `askLLM()` (DB settings) instead | `src/services/promptTesterService.ts:52` | Tester tab always uses DB key, not the key passed via UI |
| Settings panel has no "test connection" button | `src/ui.html` panel-settings | User must re-run wizard to validate a changed key |
| E2E coverage missing for setup-2, done screen, settings panel | `tests/` | Those flows tested manually only |
| `leadHash` format changed — production leads stored with old `external:<id>` format may dedup incorrectly | `src/utils/hash.ts` | Run `SELECT lead_hash FROM leads WHERE lead_hash LIKE 'external:%' AND lead_hash NOT LIKE 'external:%:%'` before deploying to assess impact. One-off re-hash migration may be needed. |

### What was E2E tested (2026-04-14, Playwright, 41/41 pass)

- Register → auto-login → setup-1 redirect
- All 4 provider buttons visible; placeholder/hint/link/guide box correct per provider
- Key field show/hide toggle
- "Próximo" gated until test passes; helper text shown/hidden correctly
- Invalid key → error shown, Próximo stays disabled
- Login with wrong password → error
- Login with correct credentials → setup-1 (setup incomplete)
- Register/login screen toggle links
- Duplicate email → 409 "Este email já está cadastrado."
- Password < 8 chars → blocked by HTML5 minlength
- Provider change resets test state (ok-msg hidden, Próximo disabled, helper shown)

### Migrations applied (in order)

```
001_init.sql          — webhook_events, leads
002_placeholder.sql   — sequence gap filler
003_add_n8n_target_url.sql
004_add_lead_sources.sql
005_add_source_fields_to_leads.sql
006_add_users.sql
007_add_settings.sql
```

### Deployment

- Platform: **Render** (`render.yaml`)
- URL: `https://testn8nmetaapi.onrender.com`
- Server starts with: `node scripts/run-migration.mjs && node dist/server.js`
- `src/ui.html` must be copied to `dist/ui.html` at build time (TypeScript compiler does not copy HTML)

---

## Project Overview

A production-grade hybrid ingestion backend for Facebook Lead Ads:

**Meta Webhook → Ingestion API → PostgreSQL → n8n orchestrator**

The backend owns ingestion, deduplication, persistence, and retries. n8n only receives a trusted, normalized payload — never raw webhook data.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js, TypeScript (ESM — `"type": "module"`) |
| Web framework | Fastify v4 |
| Validation | Zod v3 |
| ORM/DB | Raw SQL via `pg` (PostgreSQL) |
| Testing | Vitest |
| Logging | pino |
| OpenAPI | `@fastify/swagger` + `fastify-type-provider-zod` |
| Metrics | `fastify-metrics` (prom-client) |

**Fastify version is v4.** Do not install plugins that require Fastify v5. Check peer dependencies before adding any `@fastify/*` package.

---

## Commands

```bash
npm run dev          # start with hot reload (tsx watch)
npm test             # run all tests (vitest)
npm run build        # compile TypeScript
npm run lint         # ESLint
npm run db:migrate   # run SQL migrations
```

Always run `npm test && npx tsc --noEmit` before committing.

---

## Architecture

```
src/
  app/createApp.ts       # Fastify factory — all plugin registration lives here
  config/env.ts          # Env vars parsed and validated with Zod at startup
  routes/                # Route registration only — no business logic
  controllers/           # Request/response handling — delegates to services
  services/              # Business logic (ingestion, n8n delivery)
  integrations/
    meta/                # HMAC verification, payload normalizer
    n8n/                 # HTTP client for n8n webhook
  db/client.ts           # PostgreSQL pool (singleton)
  repositories/          # All SQL queries — one file per table
  workers/retryWorker.ts # Polls and replays failed n8n deliveries
  schemas/               # Zod schemas for external payloads
  utils/                 # logger, hash, correlationId
  types/domain.ts        # Shared TypeScript types
tests/                   # Vitest tests (mirror src/ structure)
db/migrations/           # Plain SQL migration files
docs/                    # Specs, plans, workflow guides
```

---

## Critical Constraints

These rules exist because breaking them caused real bugs. Do not bypass them.

### 1. Never add a body schema to `POST /webhooks/meta/lead-ads`

`fastify-raw-body` captures the raw request bytes for HMAC signature validation (`X-Hub-Signature-256`). If a Zod body schema is added to this route, Fastify will consume the body stream before `fastify-raw-body` captures it — `rawBody` becomes `undefined` and every POST is rejected with 401.

The POST route intentionally has `description` only (no `body` schema key).

### 2. All Fastify plugins must be v4-compatible

Fastify v4 uses `fastify-plugin@4.x`. The following were downgraded from their incorrect v5-only versions:
- `fastify-raw-body` → `^4.x`
- `@fastify/helmet` → `^11.x`
- `@fastify/swagger-ui` → `^4.x`

Before installing any new `@fastify/*` plugin, run:
```bash
npm info <package> peerDependencies
```
and confirm `fastify` peer is `^4.x`, not `^5.x`.

### 3. Zod schemas require compiler wiring

`fastify-type-provider-zod` requires `validatorCompiler` and `serializerCompiler` to be set on the Fastify instance. This is already done in `createApp.ts`. If you add a new app factory or test helper, you must call both:
```typescript
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
```

### 4. `createApp` is async

`createApp` uses dynamic `await import()` for swagger and metrics plugins. Always `await` it:
```typescript
const app = await createApp({ enableDocs: true });
```

### 5. Prometheus registry must be cleared in tests

`prom-client` uses a global singleton registry. Each test that creates a `createApp()` instance will conflict unless `clearRegisterOnInit: true` is set on `fastify-metrics`. This is already configured. Do not remove it.

---

## Patterns

### Route schemas

All routes use Zod schemas via `withTypeProvider<ZodTypeProvider>()` scoped locally in each route file:

```typescript
export const registerHealthRoutes = async (app: FastifyInstance) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/health', {
    schema: {
      response: { 200: z.object({ status: z.literal('ok') }) }
    }
  }, async () => ({ status: 'ok' as const }));
};
```

Never use `app.register()` with a plain `FastifyInstance` type for routes that need Zod schemas — always scope with `withTypeProvider`.

### Repository pattern

All database access goes through `src/repositories/`. No SQL in controllers or services. Each repository file maps to one database table.

### Correlation IDs

Every inbound request gets a `correlationId` (from `X-Correlation-Id` header or generated). Pass it through to all log entries and response bodies. Use `correlationIdFromHeader()` from `src/utils/correlation.ts`.

### Error handling

Validation failures are stored in `webhook_events` with `processing_status = 'failed'` before returning an error response. Never reject a webhook silently — always persist the raw event first.

---

## Testing

- Tests live in `tests/` and mirror the `src/` structure.
- Use `vitest` — not Jest.
- Use `app.inject()` for HTTP tests — do not start a real server.
- Call `await app.ready()` before `app.inject()` when swagger or metrics plugins are registered.
- Mock external dependencies (`n8nClient`, `pool`, repositories) with `vi.spyOn()`.
- Do not mock the Zod schemas or env config.
- Follow TDD: write the failing test first, then implement.

---

## Docs & Delivery Log

- **`docs/ai-agent-roadmap.md`** — delivery log and prioritized backlog. Read the latest entry before starting. Add a new row when done.
- **`docs/superpowers/specs/`** — design specs for each feature.
- **`docs/superpowers/plans/`** — implementation plans for each feature.
- **`docs/n8n-workflow.md`** — n8n node-by-node setup guide.

After any change that affects the API surface, infrastructure, or contracts: update `README.md` and `docs/ai-agent-roadmap.md`.

---

## Commit Style

```
type: short imperative description

# Types: feat | fix | chore | docs | test | refactor
# Examples:
feat: add dead-letter replay endpoint
fix: strip query params from Prometheus route labels
docs: update README with observability section
test: add spec-coverage test for /webhooks/meta/lead-ads
```

One logical change per commit. Run tests before committing.
