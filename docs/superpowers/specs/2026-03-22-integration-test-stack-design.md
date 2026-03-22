# Integration Test Stack — Design Spec

**Date:** 2026-03-22
**Status:** Draft

---

## Goal

Add integration tests that exercise the full request lifecycle — HTTP → business logic → real PostgreSQL — without mocking repositories or the database. A lightweight fake HTTP server replaces n8n for delivery assertions. Tests run alongside unit tests via `npm test` and in CI via GitHub Actions with a Postgres service container.

---

## Scope

Two integration test files in this task:

1. `meta-webhook.integration.test.ts` — covers `POST /webhooks/meta/lead-ads`
2. `unified-webhook.integration.test.ts` — covers `POST /webhooks/v1/leads`

Admin endpoint integration tests (`GET /admin/leads/failed`, `POST /admin/leads/:id/replay`) are deferred — those routes do not exist in the current codebase and require a separate implementation task.

---

## Architecture

### Directory structure

```
tests/
  integration/
    helpers/
      db.ts            # pool, runMigrations(), truncateAll()
      n8nServer.ts     # fake n8n HTTP server (queue-based, waitForRequest)
    meta-webhook.integration.test.ts
    unified-webhook.integration.test.ts
```

### Helper: `db.ts`

- Exports a shared `pg.Pool` connected to `process.env.DATABASE_URL`
- `runMigrations()` — reads all `.sql` files from `db/migrations/` in alphabetical order, executes each via `pool.query()`. Migrations use `IF NOT EXISTS` guards so re-running is safe.
- `truncateAll()` — truncates `delivery_attempts`, `leads`, `webhook_events` with `RESTART IDENTITY CASCADE`. Does **not** truncate `lead_sources` (reference/seed data required by FK in `leads.source_id`) or `schema_migrations` (system table).

### Helper: `n8nServer.ts`

- Starts a `http.createServer` on port `:0` (OS assigns random port) in `beforeAll`
- Always responds `200 OK` with `{"status":"ok"}`
- Uses an **internal queue** (`receivedRequests: unknown[]`) to store all incoming request bodies. This is required because the `setImmediate`-deferred delivery in `leadIngestionService.ts` may complete before or after the test calls `waitForRequest()`.
- Exposes:
  - `getUrl(): string` — returns `http://127.0.0.1:<port>`
  - `waitForRequest(timeoutMs = 3000): Promise<unknown>` — if the queue already has an item, dequeues and resolves immediately. Otherwise waits for the next request to arrive, then resolves. Rejects on timeout. Prevents both the pre-registration race (request already arrived) and the post-injection race (request not yet arrived).
  - `requestCount: number` — total requests received (including already-dequeued ones)
  - `reset()` — clears the queue and resets `requestCount` to 0; called in `afterEach`
  - `close(): Promise<void>` — shuts down the server

### Overriding `N8N_WEBHOOK_URL`

`src/config/env.ts` exports `const env = envSchema.parse(process.env)` at module load time — this value is frozen once the module is first imported. Mutating `process.env` after imports are resolved has no effect on the already-parsed `env` object.

**Correct approach:** use a dynamic `import()` inside `beforeAll`, after setting `process.env.N8N_WEBHOOK_URL`:

```ts
// tests/integration/meta-webhook.integration.test.ts
import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import { startFakeN8n } from './helpers/n8nServer.js';
import { runMigrations, truncateAll, pool } from './helpers/db.js';

// No static import of createApp here — must be dynamic

const n8n = await startFakeN8n(); // starts before env is read

describe('POST /webhooks/meta/lead-ads', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    process.env.N8N_WEBHOOK_URL = n8n.getUrl(); // set before createApp import
    const { createApp } = await import('../../src/app/createApp.js');
    await runMigrations();
    app = await createApp();
    await app.ready();
  });

  afterEach(async () => {
    await truncateAll();
    n8n.reset();
  });

  afterAll(async () => {
    await app.close();
    await n8n.close();
    await pool.end();
  });
});
```

This works because the dynamic `import()` inside `beforeAll` defers the **first evaluation** of `env.ts` (and therefore the `envSchema.parse(process.env)` call) until after `process.env.N8N_WEBHOOK_URL` is set. The frozen `env` object is then created with the fake server URL baked in.

**Important fragility:** `env.N8N_WEBHOOK_URL` is a plain string property on the frozen `env` object — not a getter. If any transitive static import in the test file (including `n8nServer.ts` or `db.ts`) causes `env.ts` to be evaluated before `beforeAll` runs, the `envSchema.parse` will capture the wrong URL and the override will silently fail. The helpers (`db.ts`, `n8nServer.ts`) must not import anything from `src/` that transitively imports `env.ts`.

### Skip guard for local development without a DB

`src/config/env.ts` sets `DATABASE_URL ??= 'postgres://...'` as a default, so `!!process.env.DATABASE_URL` is always `true` and cannot be used as a skip guard. Use a dedicated env var instead:

```ts
const isIntegration = process.env.INTEGRATION === 'true';
describe.skipIf(!isIntegration)('POST /webhooks/meta/lead-ads', () => { ... });
```

CI sets `INTEGRATION=true`. Local runs skip integration tests unless the developer sets the var manually. Document this in README and `.env.example`.

### Test lifecycle (per file)

```
module-level  → startFakeN8n() (before any beforeAll)
beforeAll     → set process.env.N8N_WEBHOOK_URL → dynamic import createApp → runMigrations() → app.ready()
afterEach     → truncateAll() + n8n.reset()
afterAll      → app.close() + n8n.close() + pool.end()
```

No `vi.spyOn` on any repository, pool, or HTTP client.

---

## Test Coverage

### `meta-webhook.integration.test.ts`

HMAC signatures must be formatted as: `X-Hub-Signature-256: sha256=<hex-digest>` using `crypto.createHmac('sha256', process.env.META_APP_SECRET).update(rawBody).digest('hex')`. The `sha256=` prefix is required.

| Test | Assertions |
|---|---|
| Valid HMAC + valid payload → 202 | Row in `leads` with correct fields; `webhook_events.processing_status = 'forwarded'` (after `waitForRequest()`); fake n8n receives correct payload |
| Duplicate lead (same hash) → 202 | `webhook_events.processing_status = 'duplicate'`; `requestCount === 0` (n8n not called) |
| Invalid HMAC → 401 | No row in `leads`; no row in `webhook_events` |

### `unified-webhook.integration.test.ts`

Auth via `X-Api-Key: <BACKEND_API_KEY>` header. This route does **not** call n8n — it persists the lead only. No `waitForRequest()` needed.

| Test | Assertions |
|---|---|
| Valid Instagram payload + correct key → 202 | Row in `leads` with `source = 'instagram'`; `webhook_events.processing_status = 'persisted'` |
| Duplicate lead → 200 | `webhook_events.processing_status = 'duplicate'`; no new row in `leads` |
| Missing `X-Api-Key` → 401 | No row in `leads`; no row in `webhook_events` |
| Invalid contract version → 400 | `webhook_events` row with `processing_status = 'failed'` |

---

## CI Changes

Add `INTEGRATION=true` to the test step env and a `postgres` service to `.github/workflows/ci.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: leads
    ports:
      - 5432:5432
    options: >-
      --health-cmd pg_isready
      --health-interval 5s
      --health-timeout 5s
      --health-retries 5
```

Add `INTEGRATION: 'true'` to the existing `env:` block of the `Test` step. `DATABASE_URL` is already configured in CI as `postgresql://postgres:postgres@localhost:5432/leads` — the Postgres service uses `POSTGRES_DB: leads`, so these match.

---

## Constraints

- No new runtime dependencies — use Node's built-in `http` module for the fake n8n server and `pg` (already installed) for DB helpers.
- `truncateAll()` must not truncate `lead_sources` or `schema_migrations`.
- `waitForRequest()` must use a queue (not just a promise) to handle the case where delivery arrives before the assertion.
- `waitForRequest()` default timeout: 3000ms — reject with a descriptive error on timeout.
- HMAC header value format: `sha256=<hex-digest>` — the `sha256=` prefix is required.
- Integration tests must be independent — no shared state between test cases (enforced by `afterEach` truncation + `n8n.reset()`).
- Fake n8n server must be started before `createApp()` so its URL is available before the dynamic import resolves `env.ts`.
