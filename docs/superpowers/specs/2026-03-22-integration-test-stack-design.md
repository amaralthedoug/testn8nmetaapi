# Integration Test Stack — Design Spec

**Date:** 2026-03-22
**Status:** Approved

---

## Goal

Add integration tests that exercise the full request lifecycle — HTTP → business logic → real PostgreSQL — without mocking repositories or the database. A lightweight fake HTTP server replaces n8n for delivery assertions. Tests run alongside unit tests via `npm test` and in CI via GitHub Actions with a Postgres service container.

---

## Architecture

### Directory structure

```
tests/
  integration/
    helpers/
      db.ts            # pool, runMigrations(), truncateAll()
      n8nServer.ts     # fake n8n HTTP server (captures payloads, returns 200)
    meta-webhook.integration.test.ts
    unified-webhook.integration.test.ts
    admin-replay.integration.test.ts
```

Integration tests live in `tests/integration/` — separate from unit tests in `tests/` to make clear which tests require a real database. This follows the common pattern of separating unit and integration test categories without breaking the project's mirror convention (integration tests span multiple `src/` layers and have no single module to mirror).

### Helpers

**`db.ts`**
- Exports a shared `pg.Pool` connected to `DATABASE_URL`
- `runMigrations()` — runs all SQL files from `db/migrations/` in order (same logic as `scripts/run-migration.mjs`)
- `truncateAll()` — `TRUNCATE` on `delivery_attempts`, `leads`, `webhook_events`, `lead_sources`, `schema_migrations` with `CASCADE` to reset state between tests

**`n8nServer.ts`**
- Starts a `http.createServer` on port `:0` (OS assigns random port) in `beforeAll`
- Always responds `200 OK`
- Exposes `lastPayload` and `requestCount` for test assertions
- `getUrl()` returns the bound address so tests can pass it as `N8N_WEBHOOK_URL`

### Test lifecycle (per file)

```
beforeAll  → runMigrations() + start fake n8n server
afterEach  → truncateAll() — isolates each test
afterAll   → pool.end() + fake n8n server close
```

No `vi.spyOn` on any repository, pool, or HTTP client. Every call goes through real code paths.

---

## Test Coverage

### `meta-webhook.integration.test.ts`

Covers `POST /webhooks/meta/lead-ads` end-to-end:

- Valid HMAC signature → lead persisted in `leads` table → n8n fake receives correct payload
- Duplicate lead (same hash) → `webhook_events.processing_status = 'duplicate'` → n8n not called
- Invalid HMAC → `401` → nothing written to DB

### `unified-webhook.integration.test.ts`

Covers `POST /webhooks/v1/leads` end-to-end:

- Valid Instagram payload + correct `X-Api-Key` → lead persisted with `source = 'instagram'` → n8n fake receives payload
- Duplicate lead → `200 duplicate` → n8n not called
- Missing `X-Api-Key` → `401` → nothing written to DB
- Invalid contract version → `400` → `webhook_events` row with `status = 'failed'`

### `admin-replay.integration.test.ts`

Covers the dead-letter admin endpoints:

- `GET /admin/leads/failed` → returns leads with `n8n_delivery_status = 'failed'` from real DB
- `POST /admin/leads/:id/replay` → re-delivers to n8n fake → updates `n8n_delivery_status = 'delivered'`
- Replay of already-delivered lead → `409 Conflict`

---

## CI Changes

Add a `postgres` service to `.github/workflows/ci.yml`:

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

`DATABASE_URL` is already set in the CI env — no changes needed there. Integration tests run in the same `npm test` invocation as unit tests.

---

## Constraints

- No new runtime dependencies — use Node's built-in `http` module for the fake n8n server and `pg` (already a dependency) for the DB helpers.
- HMAC signatures in `meta-webhook` tests must be computed correctly using `crypto.createHmac('sha256', META_APP_SECRET)` — the same algorithm as production.
- `truncateAll()` must truncate in dependency order to avoid FK violations (`delivery_attempts` before `leads`).
- Integration tests must be independent of each other — no shared state between test cases.
