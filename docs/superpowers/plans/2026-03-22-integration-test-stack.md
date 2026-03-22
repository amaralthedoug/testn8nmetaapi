# Integration Test Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add integration tests for `POST /webhooks/meta/lead-ads` and `POST /webhooks/v1/leads` that exercise the full HTTP → business logic → real PostgreSQL path, with a queue-based fake n8n HTTP server for delivery assertions.

**Architecture:** Two helpers (`db.ts`, `n8nServer.ts`) provide shared infrastructure. Two test files exercise full request lifecycles with real DB and no mocks. CI gains a Postgres service container and `INTEGRATION=true` env var to enable these tests.

**Tech Stack:** Node.js 22, TypeScript ESM, Fastify v4, pg, Vitest, Node `http` (built-in), `vi.stubEnv` + `vi.resetModules` for env isolation.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `tests/integration/helpers/db.ts` | Create | Pool, `runMigrations()`, `truncateAll()` |
| `tests/integration/helpers/n8nServer.ts` | Create | Fake n8n HTTP server, queue-based `waitForRequest()` |
| `tests/integration/meta-webhook.integration.test.ts` | Create | Integration tests for `POST /webhooks/meta/lead-ads` |
| `tests/integration/unified-webhook.integration.test.ts` | Create | Integration tests for `POST /webhooks/v1/leads` |
| `.github/workflows/ci.yml` | Modify | Add Postgres service + `INTEGRATION=true` |
| `.env.example` | Modify | Document `INTEGRATION` var |

---

## Task 1: DB helper

**Files:**
- Create: `tests/integration/helpers/db.ts`

- [ ] **Step 1: Create the file**

```typescript
// tests/integration/helpers/db.ts
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '../../../db/migrations');

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/leads',
});

export async function runMigrations(): Promise<void> {
  const files = (await readdir(migrationsDir))
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    await pool.query(sql);
  }
}

export async function truncateAll(): Promise<void> {
  await pool.query(
    'TRUNCATE delivery_attempts, leads, webhook_events RESTART IDENTITY CASCADE'
  );
}
```

Note: `runMigrations()` runs all files unconditionally — all use `IF NOT EXISTS` so re-running is safe. Does NOT truncate `lead_sources` (seed data) or `schema_migrations` (system table).

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/helpers/db.ts
git commit -m "test: add integration test DB helper (pool, runMigrations, truncateAll)"
```

---

## Task 2: Fake n8n server helper

**Files:**
- Create: `tests/integration/helpers/n8nServer.ts`

- [ ] **Step 1: Create the file**

```typescript
// tests/integration/helpers/n8nServer.ts
import http from 'node:http';

export interface FakeN8nServer {
  getUrl(): string;
  waitForRequest(timeoutMs?: number): Promise<unknown>;
  requestCount: number;
  reset(): void;
  close(): Promise<void>;
}

export async function startFakeN8n(): Promise<FakeN8nServer> {
  const queue: unknown[] = [];
  const pending: Array<(body: unknown) => void> = [];
  let requestCount = 0;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requestCount++;
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { parsed = body; }

      // Send response FIRST so deliver() can complete and call updateStatus('forwarded')
      // before waitForRequest() resolves in the test — prevents the forwarded-status race.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }), () => {
        // Callback fires after response is fully written to socket.
        if (pending.length > 0) {
          pending.shift()!(parsed);
        } else {
          queue.push(parsed);
        }
      });
    });
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;

  return {
    getUrl: () => url,

    waitForRequest(timeoutMs = 3000): Promise<unknown> {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift()!);
      }
      return new Promise((resolve, reject) => {
        // Store the wrapper so the timeout handler can find and remove it by reference.
        let wrapper: ((body: unknown) => void) | undefined;
        const timer = setTimeout(() => {
          const idx = pending.indexOf(wrapper!);
          if (idx !== -1) pending.splice(idx, 1);
          reject(new Error(`waitForRequest: no request received within ${timeoutMs}ms`));
        }, timeoutMs);

        wrapper = (body: unknown) => {
          clearTimeout(timer);
          resolve(body);
        };
        pending.push(wrapper);
      });
    },

    get requestCount() { return requestCount; },

    reset() {
      queue.length = 0;
      requestCount = 0;
    },

    close(): Promise<void> {
      return new Promise((resolve, reject) =>
        server.close(err => err ? reject(err) : resolve())
      );
    },
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/helpers/n8nServer.ts
git commit -m "test: add fake n8n HTTP server helper with queue-based waitForRequest"
```

---

## Task 3: Meta webhook integration tests

**Files:**
- Create: `tests/integration/meta-webhook.integration.test.ts`

The HMAC signature format required by the production `verifyMetaSignature()` is:
`X-Hub-Signature-256: sha256=<hex-digest>` where the digest is `HMAC-SHA256(rawBody, META_APP_SECRET)`.

- [ ] **Step 1: Create the test file**

```typescript
// tests/integration/meta-webhook.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { startFakeN8n, type FakeN8nServer } from './helpers/n8nServer.js';
import { pool, runMigrations, truncateAll } from './helpers/db.js';

const isIntegration = process.env.INTEGRATION === 'true';

// Valid Meta webhook payload with one lead
const validMetaPayload = {
  object: 'page',
  entry: [{
    id: 'page-1',
    changes: [{
      field: 'leadgen',
      value: {
        leadgen_id: 'lead-ext-1',
        page_id: 'page-1',
        form_id: 'form-1',
        ad_id: 'ad-1',
        created_time: 1711065600,
        email: 'test@example.com',
        phone_number: '+5511999999999',
        full_name: 'Test User'
      }
    }]
  }]
};

function sign(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

describe.skipIf(!isIntegration)('POST /webhooks/meta/lead-ads (integration)', () => {
  let app: Awaited<ReturnType<typeof import('../../src/app/createApp.js').createApp>>;
  let n8n: FakeN8nServer;

  beforeAll(async () => {
    n8n = await startFakeN8n();
    vi.stubEnv('N8N_WEBHOOK_URL', n8n.getUrl());
    vi.resetModules();
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
    vi.unstubAllEnvs();
  });

  it('persists lead and delivers to n8n for valid HMAC payload', async () => {
    const body = JSON.stringify(validMetaPayload);
    const secret = process.env.META_APP_SECRET ?? 'test-app-secret';

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meta/lead-ads',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sign(body, secret),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('accepted');

    // Wait for setImmediate-deferred n8n delivery
    const n8nPayload = await n8n.waitForRequest();
    expect(n8nPayload).toMatchObject({ lead: { email: 'test@example.com' } });

    // Verify DB state
    const { rows: leads } = await pool.query('SELECT * FROM leads');
    expect(leads).toHaveLength(1);
    expect(leads[0].external_lead_id).toBe('lead-ext-1');

    const { rows: events } = await pool.query(
      "SELECT processing_status FROM webhook_events ORDER BY received_at DESC LIMIT 1"
    );
    expect(events[0].processing_status).toBe('forwarded');
  });

  it('marks duplicate lead and does not call n8n', async () => {
    const body = JSON.stringify(validMetaPayload);
    const secret = process.env.META_APP_SECRET ?? 'test-app-secret';
    const headers = {
      'content-type': 'application/json',
      'x-hub-signature-256': sign(body, secret),
    };

    // First ingestion
    await app.inject({ method: 'POST', url: '/webhooks/meta/lead-ads', headers, payload: body });
    await n8n.waitForRequest(); // consume delivery
    n8n.reset();

    // Second ingestion — same payload, same hash
    const res = await app.inject({ method: 'POST', url: '/webhooks/meta/lead-ads', headers, payload: body });

    expect(res.statusCode).toBe(202);

    // Give setImmediate time to fire (if it were going to)
    await new Promise(r => setTimeout(r, 100));
    expect(n8n.requestCount).toBe(0);

    const { rows: events } = await pool.query(
      "SELECT processing_status FROM webhook_events ORDER BY received_at DESC LIMIT 1"
    );
    expect(events[0].processing_status).toBe('duplicate');
  });

  it('returns 401 and writes nothing to DB for invalid HMAC', async () => {
    const body = JSON.stringify(validMetaPayload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meta/lead-ads',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=invalidsignature',
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);

    const { rows: leads } = await pool.query('SELECT * FROM leads');
    expect(leads).toHaveLength(0);

    const { rows: events } = await pool.query('SELECT * FROM webhook_events');
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests with INTEGRATION=true**

```bash
INTEGRATION=true npm test -- tests/integration/meta-webhook.integration.test.ts
```

Expected: 3 tests pass. If DB connection fails, check that Postgres is running locally on port 5432.

- [ ] **Step 3: Run full test suite to verify no regressions**

```bash
npm test
```

Expected: all 14 existing test files pass; integration tests skipped (no `INTEGRATION=true`).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/meta-webhook.integration.test.ts
git commit -m "test: add meta webhook integration tests with real DB and fake n8n"
```

---

## Task 4: Unified webhook integration tests

**Files:**
- Create: `tests/integration/unified-webhook.integration.test.ts`

Note: `POST /webhooks/v1/leads` does **not** call n8n — no `waitForRequest()` needed. Tests verify DB state only.

- [ ] **Step 1: Create the test file**

```typescript
// tests/integration/unified-webhook.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { startFakeN8n, type FakeN8nServer } from './helpers/n8nServer.js';
import { pool, runMigrations, truncateAll } from './helpers/db.js';

const isIntegration = process.env.INTEGRATION === 'true';

const validInstagramPayload = {
  source: 'instagram',
  contractVersion: '1.0',
  raw: {
    handle: '@patient_test',
    firstMessage: 'Quero saber sobre rinoplastia',
    timestamp: '2026-03-22T10:00:00.000Z',
  },
  qualified: {
    procedimento_interesse: 'Rinoplastia',
    janela_decisao: '1-3 meses',
    regiao: 'São Paulo',
    contato_whatsapp: '+5511999999999',
    resumo: 'Paciente interessada em cirurgia.',
  },
  processedAt: '2026-03-22T10:01:00.000Z',
};

describe.skipIf(!isIntegration)('POST /webhooks/v1/leads (integration)', () => {
  let app: Awaited<ReturnType<typeof import('../../src/app/createApp.js').createApp>>;
  let n8n: FakeN8nServer;

  beforeAll(async () => {
    n8n = await startFakeN8n();
    vi.stubEnv('N8N_WEBHOOK_URL', n8n.getUrl());
    vi.resetModules();
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
    vi.unstubAllEnvs();
  });

  it('persists instagram lead with correct source for valid payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      headers: { 'x-api-key': process.env.BACKEND_API_KEY ?? 'test-api-key' },
      payload: validInstagramPayload,
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('accepted');

    const { rows: leads } = await pool.query('SELECT * FROM leads');
    expect(leads).toHaveLength(1);
    expect(leads[0].source).toBe('instagram');
    expect(leads[0].external_lead_id).toBe('@patient_test');

    const { rows: events } = await pool.query(
      "SELECT processing_status FROM webhook_events ORDER BY received_at DESC LIMIT 1"
    );
    expect(events[0].processing_status).toBe('persisted');
  });

  it('returns 200 duplicate and writes no new lead row for duplicate payload', async () => {
    const headers = { 'x-api-key': process.env.BACKEND_API_KEY ?? 'test-api-key' };

    await app.inject({ method: 'POST', url: '/webhooks/v1/leads', headers, payload: validInstagramPayload });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      headers,
      payload: validInstagramPayload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('duplicate');

    const { rows: leads } = await pool.query('SELECT * FROM leads');
    expect(leads).toHaveLength(1); // still only one

    const { rows: events } = await pool.query(
      "SELECT processing_status FROM webhook_events ORDER BY received_at DESC LIMIT 1"
    );
    expect(events[0].processing_status).toBe('duplicate');
  });

  it('returns 401 and writes nothing to DB when X-Api-Key is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      payload: validInstagramPayload,
    });

    expect(res.statusCode).toBe(401);

    const { rows: leads } = await pool.query('SELECT * FROM leads');
    expect(leads).toHaveLength(0);

    const { rows: events } = await pool.query('SELECT * FROM webhook_events');
    expect(events).toHaveLength(0);
  });

  it('returns 400 and stores failed event for unknown contract version', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      headers: { 'x-api-key': process.env.BACKEND_API_KEY ?? 'test-api-key' },
      payload: { ...validInstagramPayload, contractVersion: '9.9' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().reason).toContain('unsupported_contract');

    const { rows: events } = await pool.query(
      "SELECT processing_status FROM webhook_events ORDER BY received_at DESC LIMIT 1"
    );
    expect(events[0].processing_status).toBe('failed');
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
INTEGRATION=true npm test -- tests/integration/unified-webhook.integration.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all existing tests pass; integration files skipped without `INTEGRATION=true`.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/unified-webhook.integration.test.ts
git commit -m "test: add unified webhook integration tests with real DB"
```

---

## Task 5: CI changes and documentation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.env.example`

- [ ] **Step 1: Add Postgres service and INTEGRATION=true to ci.yml**

In `.github/workflows/ci.yml`, add a `services:` block to the `test` job (at the same indentation level as `steps:`):

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

And add `INTEGRATION: 'true'` to the existing `env:` block of the `Test` step:

```yaml
      - name: Test
        run: npm test
        env:
          NODE_ENV: test
          INTEGRATION: 'true'
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/leads
          # ... rest of existing env vars unchanged
```

- [ ] **Step 2: Document INTEGRATION var in .env.example**

Add to `.env.example`:

```bash
# Set to 'true' to run integration tests (requires a running PostgreSQL instance)
# INTEGRATION=true
```

- [ ] **Step 3: Run full test suite locally one last time**

```bash
npm test
```

Expected: 14 test files, 60 tests, all passing (integration tests skipped).

- [ ] **Step 4: Commit and push**

```bash
git add .github/workflows/ci.yml .env.example
git commit -m "ci: add Postgres service and INTEGRATION flag for integration tests"
git push
```

- [ ] **Step 5: Open PR and verify CI passes**

```bash
gh pr create --title "test: add integration test stack (meta webhook + unified webhook)" \
  --body "Adds real-DB integration tests for POST /webhooks/meta/lead-ads and POST /webhooks/v1/leads. Fake n8n server with queue-based waitForRequest(). CI gains Postgres service container."
```

Verify the GitHub Actions run passes with all integration tests green.
