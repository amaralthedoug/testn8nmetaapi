# Dead-Letter Replay API with RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /admin/leads/failed` and `POST /admin/leads/:id/replay` endpoints protected by a static Bearer token, with atomic double-delivery protection.

**Architecture:** A `deadLetterRepository` owns all dead-letter SQL (listFailed, findById, claimForReplay). An `adminController` holds request handlers. `routes/admin.ts` wires up auth (preHandler) and route schemas following the exact same pattern as `routes/meta.ts`. `N8nDeliveryService.deliver()` is reused as-is — replay is fire-and-forget.

**Tech Stack:** Fastify v4, TypeScript ESM, Zod, `pg` raw SQL, `fastify-type-provider-zod`, Vitest, Node `crypto.timingSafeEqual`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `db/migrations/002_add_failed_leads_index.sql` | Create | Partial index on failed leads for fast list queries |
| `src/types/domain.ts` | Modify | Add `N8nDeliveryStatus` type |
| `src/config/env.ts` | Modify | Add `ADMIN_API_KEY` env var with test default |
| `src/repositories/deadLetterRepository.ts` | Create | `listFailed`, `findById`, `claimForReplay` SQL queries |
| `src/controllers/adminController.ts` | Create | `listFailed` and `replayLead` request handlers |
| `src/routes/admin.ts` | Create | `adminAuth` preHandler + route schema registration |
| `src/app/createApp.ts` | Modify | Register admin routes |
| `tests/admin.test.ts` | Create | All HTTP tests via `app.inject()` |

---

## Task 1: DB Migration — Partial Index

**Files:**
- Create: `db/migrations/002_add_failed_leads_index.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- db/migrations/002_add_failed_leads_index.sql
-- Partial index on failed leads only.
-- Stays small as leads succeed; covers the WHERE + ORDER BY in listFailed queries.
CREATE INDEX IF NOT EXISTS idx_leads_failed
  ON leads(updated_at)
  WHERE n8n_delivery_status = 'failed';
```

- [ ] **Step 2: Commit**

```bash
git add db/migrations/002_add_failed_leads_index.sql
git commit -m "chore: add partial index on failed leads for dead-letter list query"
```

> Note: To apply locally run `npm run db:migrate` (or execute the SQL directly). This has no effect on tests — they use mocked repositories.

---

## Task 2: Types and Env Config

**Files:**
- Modify: `src/types/domain.ts`
- Modify: `src/config/env.ts`

- [ ] **Step 1: Add `N8nDeliveryStatus` type to `domain.ts`**

Open `src/types/domain.ts` and add at the top, after the existing `ProcessingStatus` type:

```typescript
// N8nDeliveryStatus applies to leads.n8n_delivery_status only.
// Do NOT confuse with ProcessingStatus, which applies to webhook_events.processing_status.
export type N8nDeliveryStatus = 'pending' | 'success' | 'failed' | 'retrying';
```

- [ ] **Step 2: Add `ADMIN_API_KEY` to `env.ts`**

Open `src/config/env.ts`. In the test-env defaults block (the `if (process.env.NODE_ENV === 'test')` block), add:

```typescript
process.env.ADMIN_API_KEY ??= 'test-admin-api-key-32-chars-min!!';
```

In the `envSchema` Zod object, add:

```typescript
ADMIN_API_KEY: z.string().min(32),
```

The full updated `envSchema` should look like:

```typescript
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  META_VERIFY_TOKEN: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  N8N_WEBHOOK_URL: z.string().url(),
  N8N_INTERNAL_AUTH_TOKEN: z.string().min(1),
  ADMIN_API_KEY: z.string().min(32),
  RETRY_MAX_ATTEMPTS: z.coerce.number().default(5),
  RETRY_BASE_DELAY_MS: z.coerce.number().default(500),
  RETRY_POLL_INTERVAL_MS: z.coerce.number().default(5000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW: z.string().default('1 minute')
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/domain.ts src/config/env.ts
git commit -m "feat: add N8nDeliveryStatus type and ADMIN_API_KEY env var"
```

---

## Task 3: `deadLetterRepository`

**Files:**
- Create: `src/repositories/deadLetterRepository.ts`
- Test: `tests/admin.test.ts` (repository section — mocked in route tests; no direct DB unit tests needed since pattern is the same as other repos)

> The repository follows the exact same pattern as `src/repositories/leadRepository.ts` and `src/repositories/webhookEventRepository.ts` — plain SQL via `pool.query`, no ORM.

- [ ] **Step 1: Create `src/repositories/deadLetterRepository.ts`**

```typescript
import { pool } from '../db/client.js';
import type { N8nDeliveryStatus, NormalizedLead } from '../types/domain.js';

export type LeadSummary = {
  id: string;
  externalLeadId: string | null;
  email: string | null;
  n8nDeliveryStatus: N8nDeliveryStatus;
  deliveryAttempts: number;
  updatedAt: string;
};

export type LeadDetail = {
  id: string;
  normalizedPayload: NormalizedLead;
  n8nDeliveryStatus: N8nDeliveryStatus;
};

export const deadLetterRepository = {
  async listFailed(limit: number, offset: number): Promise<{ rows: LeadSummary[]; total: number }> {
    const result = await pool.query<LeadSummary & { total: string }>(
      `SELECT
         id,
         external_lead_id   AS "externalLeadId",
         email,
         n8n_delivery_status AS "n8nDeliveryStatus",
         delivery_attempts   AS "deliveryAttempts",
         updated_at          AS "updatedAt",
         COUNT(*) OVER()     AS total
       FROM leads
       WHERE n8n_delivery_status = 'failed'
       ORDER BY updated_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const total = result.rows.length > 0 ? parseInt(result.rows[0].total, 10) : 0;
    const rows = result.rows.map(({ total: _total, ...row }) => row as LeadSummary);
    return { rows, total };
  },

  async findById(id: string): Promise<LeadDetail | null> {
    const result = await pool.query<{
      id: string;
      normalized_payload: NormalizedLead;
      n8n_delivery_status: N8nDeliveryStatus;
    }>(
      `SELECT id, normalized_payload, n8n_delivery_status
       FROM leads
       WHERE id = $1`,
      [id]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      normalizedPayload: row.normalized_payload,
      n8nDeliveryStatus: row.n8n_delivery_status
    };
  },

  async claimForReplay(id: string): Promise<string | null> {
    const result = await pool.query<{ id: string }>(
      `UPDATE leads
       SET n8n_delivery_status = 'retrying', updated_at = now()
       WHERE id = $1 AND n8n_delivery_status = 'failed'
       RETURNING id`,
      [id]
    );

    return result.rows[0]?.id ?? null;
  }
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/repositories/deadLetterRepository.ts
git commit -m "feat: add deadLetterRepository with listFailed, findById, claimForReplay"
```

---

## Task 4: `adminController`

**Files:**
- Create: `src/controllers/adminController.ts`

> Follow the exact same pattern as `src/controllers/metaWebhookController.ts` — exported async functions that accept `FastifyRequest` and `FastifyReply`, delegate to services/repositories.

- [ ] **Step 1: Create `src/controllers/adminController.ts`**

```typescript
import type { FastifyReply, FastifyRequest } from 'fastify';
import { deadLetterRepository } from '../repositories/deadLetterRepository.js';
import { N8nDeliveryService } from '../services/n8nDeliveryService.js';
import type { N8nLeadPayload } from '../types/domain.js';

export const listFailedLeads = async (request: FastifyRequest, reply: FastifyReply) => {
  const query = request.query as { limit?: string; offset?: string };
  const limit = Math.min(parseInt(query.limit ?? '20', 10), 100);
  const offset = parseInt(query.offset ?? '0', 10);

  const { rows, total } = await deadLetterRepository.listFailed(limit, offset);

  return reply.status(200).send({ leads: rows, total, limit, offset });
};

export const replayLead = async (request: FastifyRequest, reply: FastifyReply) => {
  const { id } = request.params as { id: string };

  const lead = await deadLetterRepository.findById(id);
  if (!lead) {
    return reply.status(404).send({ error: 'Lead not found' });
  }

  if (lead.n8nDeliveryStatus === 'success') {
    return reply.status(409).send({ error: 'Lead already delivered successfully' });
  }

  const claimed = await deadLetterRepository.claimForReplay(id);
  if (!claimed) {
    return reply.status(409).send({ error: 'Lead is already being replayed' });
  }

  const payload: N8nLeadPayload = {
    correlationId: `replay-${id}`,
    ingestedAt: new Date().toISOString(),
    lead: lead.normalizedPayload,
    meta: { isDuplicate: false, rawEventStored: true, version: '1.0.0' }
  };

  const service = new N8nDeliveryService();
  void service.deliver(id, payload);

  return reply.status(200).send({ replayed: true, leadId: id });
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/controllers/adminController.ts
git commit -m "feat: add adminController with listFailedLeads and replayLead handlers"
```

---

## Task 5: `routes/admin.ts` + Register in `createApp`

**Files:**
- Create: `src/routes/admin.ts`
- Modify: `src/app/createApp.ts`

> `adminAuth` is an inline preHandler — same pattern as `ensureMetaSignature` in `src/routes/meta.ts`. Uses `crypto.timingSafeEqual` to prevent timing attacks on the token comparison.

- [ ] **Step 1: Create `src/routes/admin.ts`**

```typescript
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../config/env.js';
import { correlationIdFromHeader } from '../utils/correlation.js';
import { logger } from '../utils/logger.js';
import { listFailedLeads, replayLead } from '../controllers/adminController.js';

const adminAuth = (request: FastifyRequest, reply: FastifyReply) => {
  const correlationId = correlationIdFromHeader(
    request.headers['x-correlation-id'] as string | undefined
  );

  const authHeader = request.headers.authorization ?? '';
  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
    void reply.status(401).send({ error: 'Unauthorized' });
    return;
  }

  const provided = Buffer.from(parts[1]);
  const expected = Buffer.from(env.ADMIN_API_KEY);

  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    logger.warn({ correlationId }, 'admin auth failed: invalid token');
    void reply.status(401).send({ error: 'Unauthorized' });
    return;
  }
};

const leadSummarySchema = z.object({
  id: z.string().uuid(),
  externalLeadId: z.string().nullable(),
  email: z.string().nullable(),
  n8nDeliveryStatus: z.enum(['pending', 'success', 'failed', 'retrying']),
  deliveryAttempts: z.number(),
  updatedAt: z.string()
});

export const registerAdminRoutes = async (app: FastifyInstance) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/admin/leads/failed', {
    preHandler: [adminAuth],
    schema: {
      hide: true,
      querystring: z.object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0)
      }),
      response: {
        200: z.object({
          leads: z.array(leadSummarySchema),
          total: z.number(),
          limit: z.number(),
          offset: z.number()
        }),
        401: z.object({ error: z.string() })
      }
    }
  }, listFailedLeads);

  typed.post('/admin/leads/:id/replay', {
    preHandler: [adminAuth],
    schema: {
      hide: true,
      params: z.object({
        id: z.string().uuid()
      }),
      response: {
        200: z.object({ replayed: z.literal(true), leadId: z.string().uuid() }),
        401: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() })
      }
    }
  }, replayLead);
};
```

- [ ] **Step 2: Register admin routes in `createApp.ts`**

Open `src/app/createApp.ts`. Add the import at the top with the other route imports:

```typescript
import { registerAdminRoutes } from '../routes/admin.js';
```

Then add the registration at the bottom of `createApp`, alongside the existing route registrations:

```typescript
app.register(registerHealthRoutes);
app.register(registerMetaRoutes);
app.register(registerAdminRoutes);  // ← add this line
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run existing tests to confirm nothing is broken**

```bash
npm test
```

Expected: all existing tests pass. If any fail, fix before proceeding.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.ts src/app/createApp.ts
git commit -m "feat: add admin routes with Bearer token auth and dead-letter endpoints"
```

---

## Task 6: Tests

**Files:**
- Create: `tests/admin.test.ts`

> All tests use `app.inject()` — no real server, no real DB. External deps are mocked with `vi.spyOn()`. Follow the pattern in `tests/observability.test.ts` and `tests/delivery-retry.test.ts`.

- [ ] **Step 1: Write the failing test file**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../src/app/createApp.js';
import * as deadLetterRepo from '../src/repositories/deadLetterRepository.js';
import { N8nDeliveryService } from '../src/services/n8nDeliveryService.js';

const VALID_TOKEN = 'test-admin-api-key-32-chars-min!!';
const AUTH = `Bearer ${VALID_TOKEN}`;

const LEAD_SUMMARY = {
  id: '00000000-0000-0000-0000-000000000001',
  externalLeadId: 'ext-1',
  email: 'test@example.com',
  n8nDeliveryStatus: 'failed' as const,
  deliveryAttempts: 5,
  updatedAt: '2026-03-21T10:00:00.000Z'
};

const LEAD_DETAIL = {
  id: '00000000-0000-0000-0000-000000000001',
  normalizedPayload: {
    source: 'facebook_lead_ads' as const,
    email: 'test@example.com'
  },
  n8nDeliveryStatus: 'failed' as const
};

describe('admin routes', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    app = await createApp({ enableDocs: false });
    await app.ready();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  // --- auth ---

  it('GET /admin/leads/failed returns 401 when Authorization header is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/leads/failed' });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Unauthorized' });
  });

  it('GET /admin/leads/failed returns 401 when header has no Bearer prefix', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/leads/failed',
      headers: { authorization: VALID_TOKEN }
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /admin/leads/failed returns 401 for wrong token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/leads/failed',
      headers: { authorization: 'Bearer wrong-token-that-is-definitely-invalid!!' }
    });
    expect(res.statusCode).toBe(401);
  });

  // --- GET /admin/leads/failed ---

  it('returns 200 with empty list when no failed leads', async () => {
    vi.spyOn(deadLetterRepo.deadLetterRepository, 'listFailed').mockResolvedValue({ rows: [], total: 0 });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/leads/failed',
      headers: { authorization: AUTH }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ leads: [], total: 0, limit: 20, offset: 0 });
  });

  it('returns 200 with leads and pagination metadata', async () => {
    vi.spyOn(deadLetterRepo.deadLetterRepository, 'listFailed').mockResolvedValue({
      rows: [LEAD_SUMMARY],
      total: 42
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/leads/failed?limit=10&offset=5',
      headers: { authorization: AUTH }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(42);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(5);
    expect(body.leads).toHaveLength(1);
    expect(body.leads[0].id).toBe(LEAD_SUMMARY.id);
  });

  // --- POST /admin/leads/:id/replay ---

  it('returns 400 for non-UUID :id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/leads/not-a-uuid/replay',
      headers: { authorization: AUTH }
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when lead does not exist', async () => {
    vi.spyOn(deadLetterRepo.deadLetterRepository, 'findById').mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/leads/${LEAD_SUMMARY.id}/replay`,
      headers: { authorization: AUTH }
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Lead not found' });
  });

  it('returns 409 when lead is already successfully delivered', async () => {
    vi.spyOn(deadLetterRepo.deadLetterRepository, 'findById').mockResolvedValue({
      ...LEAD_DETAIL,
      n8nDeliveryStatus: 'success' as const
    });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/leads/${LEAD_SUMMARY.id}/replay`,
      headers: { authorization: AUTH }
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'Lead already delivered successfully' });
  });

  it('returns 409 when concurrent replay wins the race (claimForReplay returns null)', async () => {
    vi.spyOn(deadLetterRepo.deadLetterRepository, 'findById').mockResolvedValue(LEAD_DETAIL);
    vi.spyOn(deadLetterRepo.deadLetterRepository, 'claimForReplay').mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/leads/${LEAD_SUMMARY.id}/replay`,
      headers: { authorization: AUTH }
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'Lead is already being replayed' });
  });

  it('returns 200, claims the lead, and fires deliver() for a failed lead', async () => {
    vi.spyOn(deadLetterRepo.deadLetterRepository, 'findById').mockResolvedValue(LEAD_DETAIL);
    vi.spyOn(deadLetterRepo.deadLetterRepository, 'claimForReplay').mockResolvedValue(LEAD_SUMMARY.id);
    const deliverSpy = vi.spyOn(N8nDeliveryService.prototype, 'deliver').mockResolvedValue();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/leads/${LEAD_SUMMARY.id}/replay`,
      headers: { authorization: AUTH }
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ replayed: true, leadId: LEAD_SUMMARY.id });
    // deliver() is fire-and-forget — give the event loop one tick to confirm it was called
    await new Promise((resolve) => setImmediate(resolve));
    expect(deliverSpy).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests — verify they FAIL**

```bash
npm test -- --reporter=verbose tests/admin.test.ts
```

Expected: tests fail because `registerAdminRoutes` doesn't exist yet (if Task 5 not done) or due to import errors. If Task 5 is done, some tests may fail for logic reasons. Either way, all tests must fail at this step before the implementation is wired up.

- [ ] **Step 3: Run all tests — confirm nothing else broken**

```bash
npm test
```

Expected: existing 16 tests pass; new admin tests fail.

- [ ] **Step 4: Run admin tests again — all should now pass**

(All implementation was done in Tasks 3–5. If any test still fails, debug and fix.)

```bash
npm test -- --reporter=verbose tests/admin.test.ts
```

Expected: all 10 admin tests pass.

- [ ] **Step 5: Run full test suite + TypeScript check**

```bash
npm test && npx tsc --noEmit
```

Expected: all tests pass, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add tests/admin.test.ts
git commit -m "test: add admin route tests for dead-letter replay API"
```

---

## Task 7: Update Delivery Log and README

**Files:**
- Modify: `docs/ai-agent-roadmap.md`

> Per project convention in `CLAUDE.md`: after any change that affects the API surface, update `docs/ai-agent-roadmap.md`.

- [ ] **Step 1: Add new row at the top of the delivery table in `docs/ai-agent-roadmap.md`**

```markdown
| 2026-03-21 | Claude Code | Dead-letter replay API with RBAC. `GET /admin/leads/failed` (paginated) + `POST /admin/leads/:id/replay` (fire-and-forget). Bearer token auth (`ADMIN_API_KEY`), `timingSafeEqual`, atomic `claimForReplay` race guard, partial DB index. 10 tests. | `docs/superpowers/specs/2026-03-21-dead-letter-replay-rbac-design.md` | Multi-tenant routing + per-form field mapping |
```

- [ ] **Step 2: Update the Backlog section** — mark dead-letter replay as done, confirm next priority is "Multi-tenant routing":

```markdown
| Priority | Item | Notes |
|---|---|---|
| 🔴 High | Multi-tenant routing + per-form field mapping | Route leads to different n8n flows based on `page_id` or `form_id`. |
| 🟡 Medium | Integration test container stack | Run `app + postgres + mocked n8n` in CI. Prevent mock/prod divergence. |
| 🟢 Low | Prometheus alerting rules | Define alert thresholds for delivery failure rate and latency. |
| 🟢 Low | Grafana dashboard | Visualize `http_request_duration_seconds` and delivery attempt metrics. |
```

- [ ] **Step 3: Commit**

```bash
git add docs/ai-agent-roadmap.md
git commit -m "docs: update delivery log for dead-letter replay API"
```

---

## Done

Run the final check:

```bash
npm test && npx tsc --noEmit
```

Expected output: all tests pass (existing 16 + new 10 = 26 total), zero TypeScript errors.
