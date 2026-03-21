# Dead-Letter Replay API with RBAC — Design Spec

**Date:** 2026-03-21
**Status:** Approved

---

## Overview

An HTTP API that lets ops list permanently-failed n8n deliveries and replay them on demand. Protected by a static API key (Bearer token). No new tables required.

---

## Context

Leads reach `n8n_delivery_status = 'failed'` after exhausting `RETRY_MAX_ATTEMPTS` in `N8nDeliveryService`. The existing `retryWorker` polls automatically, but ops need a manual escape hatch — particularly after n8n downtime or misconfiguration.

---

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| Auth model | Single static API key (`ADMIN_API_KEY`) | Consistent with `N8N_INTERNAL_AUTH_TOKEN`; zero DB schema changes; sufficient for an internal ops tool |
| Endpoints | `GET /admin/leads/failed` + `POST /admin/leads/:id/replay` | Bulk replay is the retry worker's job |
| Replay if already success | 409 Conflict | Prevents accidental duplicate deliveries to n8n |
| Replay execution | Fire-and-forget (async) | n8n delivery has exponential backoff; holding the HTTP connection open is unnecessary for an ops tool |
| Double-delivery protection | Set `n8n_delivery_status = 'retrying'` before async delivery | Prevents retry worker from picking up the same lead concurrently |

---

## New Files

```
src/
  routes/admin.ts                          # /admin/* route registration + adminAuth preHandler
  controllers/adminController.ts           # listFailed + replayLead request handlers
  repositories/deadLetterRepository.ts     # listFailed + findById SQL queries
db/migrations/
  002_add_failed_leads_index.sql           # Partial index on failed leads
tests/
  routes/admin.test.ts                     # HTTP tests via app.inject()
```

**Modified files:**
- `src/config/env.ts` — add `ADMIN_API_KEY` (z.string().min(32))

---

## Auth

**Env var:** `ADMIN_API_KEY` — required, minimum 32 characters. Validated by Zod at startup; process exits if missing or too short.

**Mechanism:** `Authorization: Bearer <ADMIN_API_KEY>` header on every request to `/admin/*`.

**Implementation:** A `adminAuth` preHandler function defined inline in `routes/admin.ts`, applied to the scoped Fastify instance for the admin prefix. Uses Node's `crypto.timingSafeEqual` to prevent timing attacks.

**Failure responses:**
- Missing header → `401 { error: 'Unauthorized' }`
- Wrong token → `401 { error: 'Unauthorized' }` (logged at `warn` with `correlationId`)

**OpenAPI:** Admin routes excluded from Swagger docs in production (`enableDocs` flag already gates `/docs`).

---

## API Contracts

### `GET /admin/leads/failed`

**Query params:**

| Param | Type | Default | Max |
|---|---|---|---|
| `limit` | integer | 20 | 100 |
| `offset` | integer | 0 | — |

**Response 200:**
```json
{
  "leads": [
    {
      "id": "uuid",
      "externalLeadId": "string | null",
      "email": "string | null",
      "n8nDeliveryStatus": "failed",
      "deliveryAttempts": 5,
      "updatedAt": "2026-03-21T10:00:00Z"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

### `POST /admin/leads/:id/replay`

No request body.

| Condition | Status | Body |
|---|---|---|
| Lead not found | 404 | `{ "error": "Lead not found" }` |
| Status is `success` | 409 | `{ "error": "Lead already delivered successfully" }` |
| Replay triggered | 200 | `{ "replayed": true, "leadId": "uuid" }` |

**Replay sequence:**
1. Fetch lead by ID (`deadLetterRepository.findById`)
2. Guard: 404 if missing, 409 if `n8n_delivery_status = 'success'`
3. Set `n8n_delivery_status = 'retrying'` synchronously (blocks retry worker)
4. Return `200 { replayed: true, leadId }`
5. Fire `N8nDeliveryService.deliver()` asynchronously (no await)
6. Delivery marks lead `success` or `failed` when done

---

## Database

### `deadLetterRepository`

```typescript
deadLetterRepository.listFailed(limit: number, offset: number)
// → { rows: LeadSummary[], total: number }

deadLetterRepository.findById(id: string)
// → { id, normalizedPayload, n8nDeliveryStatus } | null
```

### Migration 002 — Partial index

```sql
CREATE INDEX IF NOT EXISTS idx_leads_failed
  ON leads(updated_at)
  WHERE n8n_delivery_status = 'failed';
```

Partial index covers only failed rows — stays small as successful leads accumulate. The `listFailed` query orders by `updated_at ASC` (oldest-failed-first, consistent with retry worker).

### `leadRepository` addition

```typescript
leadRepository.setStatus(leadId: string, status: 'retrying' | 'failed' | 'success')
// → UPDATE leads SET n8n_delivery_status=$2, updated_at=now() WHERE id=$1
```

Reuses the existing `'retrying'` value already defined in `ProcessingStatus` (`domain.ts`).

---

## Security

| Concern | Mitigation |
|---|---|
| Token brute-force | `timingSafeEqual` prevents timing attacks; rate limiter (already global) limits attempts |
| Misconfigured key | `z.string().min(32)` fails fast at startup |
| Information leakage | Auth errors return identical `401` regardless of failure reason |
| Double delivery | `'retrying'` status set synchronously before async delivery starts |
| Docs exposure | Admin routes hidden from Swagger in production |

---

## Testing

All tests in `tests/routes/admin.test.ts` using `app.inject()`. External deps mocked via `vi.spyOn()`.

| Test | Covers |
|---|---|
| Missing `Authorization` → 401 | Auth gate |
| Wrong token → 401 | Auth gate |
| Correct token, no failed leads → 200 `{ leads: [], total: 0 }` | List empty state |
| Correct token, leads exist → 200 with pagination fields | List + pagination |
| Replay unknown ID → 404 | Not found guard |
| Replay `success` lead → 409 | Already-delivered guard |
| Replay `failed` lead → 200, status set to `retrying`, `deliver()` called | Replay happy path |

---

## Out of Scope (MVP)

- Multiple API keys / role differentiation (add if multi-team access needed)
- Synchronous replay with delivery result in response (fire-and-forget is sufficient)
- Bulk replay endpoint (retry worker handles this)
- Replay history / audit log beyond existing `delivery_attempts` table
