# Facebook Lead Ads Ingestion Service

Production-grade hybrid backend: **Meta Webhook → Ingestion API → PostgreSQL → n8n orchestrator**

> The backend owns ingestion, deduplication, persistence, and retry logic. n8n only receives a clean, trusted payload.

---

## Table of Contents

- [Architecture](#architecture)
- [Endpoints](#endpoints)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Docker](#docker)
- [Project Structure](#project-structure)
- [Idempotency](#idempotency)
- [Failure Handling & Retries](#failure-handling--retries)
- [Security](#security)
- [Observability](#observability)
- [Roadmap](#roadmap)
- [Assumptions](#assumptions)

---

## Architecture

```
Meta Platform
    │
    │  POST /webhooks/meta/lead-ads
    ▼
Ingestion API  ──── HMAC validation ────► 401 Rejected
    │
    ├── Store raw event (webhook_events)
    ├── Normalize payload
    ├── Deduplicate (externalLeadId or SHA-256 hash)
    ├── Persist lead (leads)
    │
    └── Async delivery ──► n8n Webhook
            │
            └── Retry worker (exponential backoff)
                └── delivery_attempts log
```

**Why hybrid?**
- Backend owns mission-critical ingestion and persistence.
- n8n receives a trusted, normalized payload — never raw webhook data.
- Idempotency, retries, auditing, and observability stay under backend control.

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe |
| `GET` | `/ready` | Readiness probe (checks DB connection) |
| `GET` | `/webhooks/meta/lead-ads` | Meta webhook verification challenge |
| `POST` | `/webhooks/meta/lead-ads` | Lead ingestion |
| `GET` | `/docs` | Swagger UI *(dev/staging only)* |
| `GET` | `/docs/json` | OpenAPI 3.0 spec *(dev/staging only)* |
| `GET` | `/metrics` | Prometheus scrape endpoint |
| `GET` | `/admin/leads/failed` | List permanently-failed leads (paginated) — requires `ADMIN_API_KEY` |
| `POST` | `/admin/leads/:id/replay` | Re-enqueue a failed lead to n8n — requires `ADMIN_API_KEY` |

---

## Quick Start

```bash
npm install
cp .env.example .env   # fill in required values
npm run db:migrate
npm run dev
```

Then open:
- API: `http://localhost:3000/health`
- Swagger UI: `http://localhost:3000/docs`
- Metrics: `http://localhost:3000/metrics`

---

## Environment Variables

Copy `.env.example` to `.env` and set:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `META_VERIFY_TOKEN` | Token used to verify Meta webhook challenge |
| `META_APP_SECRET` | Meta app secret for `X-Hub-Signature-256` HMAC validation |
| `N8N_WEBHOOK_URL` | n8n production webhook URL |
| `N8N_INTERNAL_AUTH_TOKEN` | Bearer token sent to n8n |
| `RETRY_MAX_ATTEMPTS` | Max delivery retry attempts (default: `5`) |
| `RETRY_BASE_DELAY_MS` | Base delay for exponential backoff (default: `500`) |
| `RETRY_POLL_INTERVAL_MS` | Retry worker polling interval (default: `5000`) |
| `ADMIN_API_KEY` | Static bearer token for admin endpoints (dead-letter replay, etc.) |
| `RATE_LIMIT_MAX` | Max requests per window (default: `100`) |
| `RATE_LIMIT_WINDOW` | Rate limit window (default: `1 minute`) |

---

## Docker

```bash
docker compose up --build
```

Run migrations inside the container:

```bash
docker compose exec app npm run db:migrate
```

---

## Project Structure

```
src/
  app/              # Fastify app factory (createApp)
  config/           # Environment variable validation (Zod)
  routes/           # Route registration (health, meta webhook)
  controllers/      # Request handlers
  services/         # Business logic (ingestion, n8n delivery)
  integrations/
    meta/           # Signature verification, payload normalizer
    n8n/            # n8n HTTP client
  db/               # PostgreSQL pool
  repositories/     # Data access layer
  workers/          # Retry worker
  schemas/          # Zod schemas (Meta webhook payload)
  utils/            # Logger, hash, correlation ID
  types/            # Shared domain types
tests/              # Vitest unit tests
db/migrations/      # SQL migrations
docs/               # Specs, plans, workflow guides
```

---

## Idempotency

Every lead event is deduplicated before persistence:

1. **Primary key** — `externalLeadId` when present in the payload.
2. **Fallback key** — SHA-256 hash of `phone|email|formId|createdTime`.

Duplicate events update `webhook_events.processing_status = 'duplicate'` and skip downstream dispatch.

---

## Failure Handling & Retries

| Scenario | Behavior |
|---|---|
| Invalid signature | `401` — event rejected before storage |
| Validation failure | Event stored as `failed` with error details |
| n8n delivery failure | Retried with exponential backoff up to `RETRY_MAX_ATTEMPTS` |
| Permanent failure | `leads.n8n_delivery_status = 'failed'`; picked up by retry worker |

Every delivery attempt is logged in `delivery_attempts` for full auditability.

See `docs/n8n-workflow.md` for n8n node-by-node setup and production webhook configuration.

---

## Security

- **HMAC validation** — Every POST is verified against `X-Hub-Signature-256` using the Meta app secret. Requests with invalid or missing signatures are rejected with `401` before any processing.
- **Webhook challenge** — Meta's `hub.verify_token` challenge is validated on `GET /webhooks/meta/lead-ads`.
- **Schema validation** — All payloads are validated with Zod before processing.
- **Secrets from env only** — No secrets in code or config files.
- **Structured logging** — JSON logs via pino with secret redaction enabled.
- **Rate limiting** — Configurable via `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW`.
- **Helmet** — Security headers on all routes.

---

## Observability

| Endpoint | Description |
|---|---|
| `GET /metrics` | Prometheus text format. Includes `http_request_duration_seconds` histogram by method, route, and status code. Available in all environments. |
| `GET /docs` | Swagger UI with full OpenAPI 3.0 spec. Available in development and staging (`NODE_ENV !== 'production'`). |

Metrics are instrumented automatically via `fastify-metrics`. Query parameters are stripped from route labels to prevent label cardinality explosion.

---

## Roadmap

| Status | Item |
|---|---|
| ✅ Done | Facebook Lead Ads webhook ingestion + PostgreSQL persistence |
| ✅ Done | n8n async delivery with retries and audit log |
| ✅ Done | HMAC signature validation |
| ✅ Done | OpenAPI docs (`GET /docs`) + Prometheus metrics (`GET /metrics`) |
| ✅ Done | Dead-letter replay API with RBAC (`GET /admin/leads/failed`, `POST /admin/leads/:id/replay`) |
| 🔜 Planned | Multi-tenant page/client routing + per-form field mapping |
| 🔜 Planned | Integration test container stack (app + postgres + mocked n8n) |

See `docs/ai-agent-roadmap.md` for the full delivery log and backlog.

---

## Assumptions

- Meta app and page permissions are configured externally in the Meta Developer Portal.
- n8n production webhook is active and reachable from the backend.
- HTTPS termination is handled by the deployment ingress/proxy.
- PostgreSQL is provisioned and accessible via `DATABASE_URL`.
