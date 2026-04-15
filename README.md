# Lead Ads Ingestion Service

Production-grade hybrid backend for lead ingestion from multiple sources:

**Webhook → Ingestion API → PostgreSQL → n8n orchestrator**

The backend owns ingestion, deduplication, persistence, and retries. n8n only receives a clean, trusted payload — never raw webhook data.

---

## Table of Contents

- [Architecture](#architecture)
- [Endpoints](#endpoints)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Multi-Tenant Routing](#multi-tenant-routing)
- [Instagram Integration](#instagram-integration)
- [n8n Workflow Automation](#n8n-workflow-automation)
- [Database Migrations](#database-migrations)
- [Project Structure](#project-structure)
- [Idempotency](#idempotency)
- [Failure Handling & Retries](#failure-handling--retries)
- [Security](#security)
- [Observability](#observability)
- [Testing](#testing)
- [Roadmap](#roadmap)

---

## Architecture

```
Sources
  │
  ├── Meta Platform ─────── POST /webhooks/meta/lead-ads  (HMAC-verified)
  │
  └── Instagram SDR ──────── POST /webhooks/v1/leads       (API-key auth)
              │
              ▼
      Ingestion API
        │
        ├── Persist raw event  (webhook_events)
        ├── Validate & normalize payload
        ├── Deduplicate  (externalLeadId or SHA-256 hash)
        ├── Resolve n8n target URL  (form → page → default cascade)
        ├── Persist lead  (leads)
        │
        └── Async delivery ──► n8n Webhook
                │
                └── Retry worker (exponential backoff, delivery_attempts log)
```

**Why hybrid?**
- Backend owns mission-critical ingestion and persistence.
- n8n receives a trusted, normalized payload — never raw webhook data.
- Idempotency, retries, auditing, and observability stay under backend control.

---

## Endpoints

### Webhook Ingestion

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/webhooks/meta/lead-ads` | Public | Meta webhook challenge verification |
| `POST` | `/webhooks/meta/lead-ads` | HMAC `X-Hub-Signature-256` | Facebook Lead Ads ingestion |
| `POST` | `/webhooks/v1/leads` | `X-Api-Key` header | Unified lead ingestion (Instagram, etc.) |

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | Public | Create account + auto-login (issues JWT cookie) |
| `POST` | `/api/auth/login` | Public | Login — returns `setup_complete` flag |
| `POST` | `/api/auth/logout` | — | Clear JWT cookie |
| `GET` | `/api/auth/me` | Cookie | Current session info + `setup_complete` |

### Setup & Settings

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/setup/test-llm` | Cookie | Validate LLM provider + key + model, save on success |
| `GET` | `/api/settings` | Cookie | All settings (sensitive values masked as `***`) |
| `PUT` | `/api/settings` | Cookie | Upsert one or more settings keys |

### Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/admin/leads/failed` | `Authorization: Bearer <ADMIN_API_KEY>` | List failed leads (dead-letter queue) |
| `POST` | `/admin/leads/:id/replay` | `Authorization: Bearer <ADMIN_API_KEY>` | Replay a failed lead to n8n |

### Infrastructure

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe |
| `GET` | `/ready` | Readiness probe (checks DB connection) |
| `GET` | `/metrics` | Prometheus scrape endpoint |
| `GET` | `/docs` | Swagger UI *(non-production only)* |
| `GET` | `/docs/json` | OpenAPI 3.0 spec *(non-production only)* |

---

## Quick Start

```bash
npm install
cp .env.example .env         # fill in required values
cp config/routing.example.json config/routing.json  # configure n8n target URLs
npm run db:migrate
npm run dev
```

Verify the service is up:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

- Swagger UI: `http://localhost:3000/docs`
- Metrics: `http://localhost:3000/metrics`

---

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `META_VERIFY_TOKEN` | Yes | — | Token for Meta webhook challenge |
| `META_APP_SECRET` | Yes | — | Meta app secret for HMAC signature validation |
| `N8N_WEBHOOK_URL` | Yes | — | Default n8n webhook URL (overridden by routing config) |
| `N8N_INTERNAL_AUTH_TOKEN` | Yes | — | Bearer token sent to n8n on every delivery |
| `ADMIN_API_KEY` | Yes | — | Static bearer token for admin endpoints |
| `BACKEND_API_KEY` | Yes | — | Shared secret for `POST /webhooks/v1/leads` (`X-Api-Key` header) |
| `RETRY_MAX_ATTEMPTS` | No | `5` | Max delivery retry attempts |
| `RETRY_BASE_DELAY_MS` | No | `500` | Base delay for exponential backoff (ms) |
| `RETRY_POLL_INTERVAL_MS` | No | `5000` | Retry worker polling interval (ms) |
| `RATE_LIMIT_MAX` | No | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW` | No | `1 minute` | Rate limit window |

---

## Multi-Tenant Routing

The service routes each lead to the correct n8n webhook URL based on the originating form or page, with a cascade fallback:

```
form-level URL → page-level URL → config default URL → N8N_WEBHOOK_URL env var
```

Copy the example and adjust for your setup:

```bash
cp config/routing.example.json config/routing.json
```

```json
{
  "default": {
    "url": "https://n8n.example.com/webhook/default"
  },
  "pages": [
    {
      "pageId": "111111111",
      "url": "https://n8n.example.com/webhook/page-a",
      "forms": [
        {
          "formId": "222222222",
          "url": "https://n8n.example.com/webhook/form-b",
          "fieldMap": {
            "mobile phone": "phone",
            "product interest": "productInterest"
          }
        }
      ]
    }
  ]
}
```

`fieldMap` promotes raw Meta custom fields (arbitrary strings) to typed `NormalizedLead` fields before persistence.

The resolved target URL is stored on the `leads` row so the retry worker always replays to the correct endpoint.

---

## Instagram Integration

The unified endpoint `POST /webhooks/v1/leads` accepts structured payloads from external integrations (e.g. Instagram DM qualification flows via n8n).

**Authentication:** `X-Api-Key: <BACKEND_API_KEY>` header.

**Instagram contract (`source: "instagram"`, `contractVersion: "1.0"`):**

```json
{
  "source": "instagram",
  "contractVersion": "1.0",
  "raw": {
    "handle": "@user",
    "instaId": "optional-id",
    "firstMessage": "Quero saber mais sobre rinoplastia",
    "timestamp": "2026-03-22T10:00:00.000Z"
  },
  "qualified": {
    "procedimento_interesse": "Rinoplastia",
    "janela_decisao": "1-3 meses",
    "regiao": "São Paulo",
    "contato_whatsapp": "+5511999999999",
    "resumo": "Paciente interessada em rinoplastia com cirurgia planejada para breve."
  },
  "processedAt": "2026-03-22T10:01:00.000Z"
}
```

**Responses:**

| Status | Body | Meaning |
|---|---|---|
| `202` | `{ status: "accepted", correlationId, leadId }` | Lead persisted and queued for delivery |
| `200` | `{ status: "duplicate", correlationId }` | Lead already exists (deduplicated) |
| `400` | `{ status: "rejected", reason, correlationId }` | Invalid payload or unknown contract |
| `401` | `{ status: "rejected", reason: "invalid_api_key", correlationId }` | Authentication failed |
| `500` | `{ status: "rejected", reason: "internal_error", correlationId }` | Unexpected server error |

To add a new integration, register a mapper under `src/integrations/<source>/mappers/` and add the `"source:contractVersion"` key to the `mappers` map in `unifiedWebhookController.ts`.

---

## n8n Workflow Automation

Instead of configuring n8n manually, use [n8n-mcp](https://github.com/czlonkowski/n8n-mcp) to let an AI agent build and deploy the receiving workflow in minutes.

```
Manual n8n setup:   30–45 minutes
AI prompt + n8n-mcp: ~3 minutes
```

### Quick start

1. Connect [n8n-mcp](https://github.com/czlonkowski/n8n-mcp) to Claude Code (or another AI agent).
2. Paste a prompt from `skills/n8n-lead-pipeline/examples/prompt-templates.md`.
3. The agent calls `search_nodes` → `get_node` → `validate_workflow` → `create_workflow` automatically.
4. Add the returned production webhook URL to `config/routing.json`.

### Included resources

| File | Purpose |
|---|---|
| `docs/n8n-mcp-integration.md` | Full integration guide: payload contract, headers, 3 importable workflow templates, routing config examples, testing and troubleshooting |
| `skills/n8n-lead-pipeline/SKILL.md` | Claude Code skill — step-by-step n8n-mcp workflow for any AI agent, niche templates (clinic, dental, real estate, gym), common patterns and anti-patterns |
| `skills/n8n-lead-pipeline/examples/prompt-templates.md` | 5 self-contained prompts (basic, WhatsApp, Slack+CRM, scoring, full pipeline) — paste directly into Claude Code |

See `docs/n8n-workflow.md` for the manual node-by-node setup guide.

---

## Database Migrations

Migrations live in `db/migrations/` and run in filename order:

| File | Description |
|---|---|
| `001_init.sql` | Core tables: `webhook_events`, `leads`, `delivery_attempts` |
| `002_placeholder.sql` | Sequence gap filler |
| `003_add_n8n_target_url.sql` | Adds `n8n_target_url` to `leads` for per-form routing |
| `004_add_lead_sources.sql` | Adds `lead_sources` lookup table |
| `005_add_source_fields_to_leads.sql` | Adds `source` and `source_id` columns to `leads` |
| `006_add_users.sql` | Adds `users` table for JWT auth |
| `007_add_settings.sql` | Adds `settings` table (key/value store for LLM config, Meta tokens, wizard state) |

Run all pending migrations:

```bash
npm run db:migrate
```

---

## Project Structure

```
src/
  app/
    createApp.ts              # Fastify factory (~40 lines) — wires plugins, services, routes
    plugins.ts                # Plugin registration (helmet, jwt, metrics, rateLimit, swagger…)
  config/
    env.ts                    # Env vars validated with Zod at startup
  routing/
    config.ts                 # routing.json loader and cascade resolver
    resolveRoute.ts           # form → page → default cascade
    applyFieldMap.ts          # promotes raw Meta custom fields to typed fields
  routes/
    health.ts
    auth.ts                   # Register, login, logout, /api/auth/me
    settings.ts               # GET/PUT /api/settings, POST /api/setup/test-llm
    tester.ts                 # Prompt tester API routes
    manychat.ts
    webhooks/unified.ts       # POST /webhooks/v1/leads
  integrations/
    meta/
      routes.ts               # GET/POST /webhooks/meta/lead-ads
      verification.ts         # HMAC and challenge verification
      normalizer.ts           # Meta payload → NormalizedLead
      schema.ts               # Zod schema for Meta webhook payload
    instagram/
      schema.ts               # Zod schema for Instagram contract v1.0
      mappers/v1.ts           # Maps Instagram payload → NormalizedLead
    llm/
      anthropic.ts            # Anthropic HTTP call
      openai.ts               # OpenAI HTTP call
      gemini.ts               # Gemini HTTP call
      openrouter.ts           # OpenRouter HTTP call
      registry.ts             # Maps provider name → call function (no if-chain)
      types.ts                # LLMRequest interface
      utils.ts                # translateHttpError
    n8n/client.ts             # HTTP client for n8n
  services/
    authService.ts            # bcrypt hash + compare
    leadIngestionService.ts   # Core ingestion + routing + delivery
    llmService.ts             # askLLM — reads settings and dispatches to registry
    n8nDeliveryService.ts
    promptTesterService.ts
    settingsService.ts        # DB-backed key/value store with 60s TTL cache
    testerFileService.ts      # File I/O for prompt/cases/results directories
  db/client.ts                # PostgreSQL pool (singleton)
  repositories/
    leadRepository.ts
    leadSourcesRepository.ts
    webhookEventRepository.ts
    retryRepository.ts
  workers/retryWorker.ts      # Polls and replays failed deliveries
  utils/                      # logger, hash, correlationId
  types/
    domain.ts                 # Shared TypeScript types (NormalizedLead, etc.)
    errors.ts                 # AppError hierarchy (LLMError, AuthError, IngestionError, ConfigError)
tests/                        # Vitest tests (mirrors src/)
db/migrations/                # Plain SQL files
config/
  routing.example.json        # Routing config template
docs/                         # Specs, plans, n8n workflow guide
```

---

## Idempotency

Every lead is deduplicated before persistence:

1. **Primary key** — `externalLeadId` when present in the payload.
2. **Fallback key** — SHA-256 hash of `phone|email|formId|createdTime`.

Duplicate events update `webhook_events.processing_status = 'duplicate'` and skip downstream dispatch.

---

## Failure Handling & Retries

| Scenario | Behavior |
|---|---|
| Invalid HMAC signature | `401` — rejected before any storage |
| Invalid `X-Api-Key` | `401` — rejected before any storage |
| Payload validation failure | Raw event stored as `failed` with error detail |
| Unknown contract version | Raw event stored as `failed`; `400` returned |
| n8n delivery failure | Retried with exponential backoff up to `RETRY_MAX_ATTEMPTS` |
| Permanent failure | `leads.n8n_delivery_status = 'failed'`; queryable via admin API |

Every delivery attempt is logged in `delivery_attempts`. Failed leads can be listed and replayed via the admin endpoints.

See `docs/n8n-workflow.md` for n8n node-by-node setup.

---

## Security

- **HMAC validation** — Every `POST /webhooks/meta/lead-ads` is verified against `X-Hub-Signature-256` using the Meta app secret. Invalid or missing signatures are rejected with `401` before any processing.
- **API key auth** — `POST /webhooks/v1/leads` requires `X-Api-Key` validated with constant-time comparison (`timingSafeEqual`).
- **Admin RBAC** — Admin endpoints require `Authorization: Bearer <ADMIN_API_KEY>`.
- **Schema validation** — All payloads validated with Zod before processing.
- **Secrets from env only** — No secrets in code or config files.
- **Structured logging** — JSON logs via pino.
- **Rate limiting** — Configurable via `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW`.
- **Security headers** — `@fastify/helmet` on all routes.

---

## Observability

| Signal | Endpoint / Detail |
|---|---|
| **Metrics** | `GET /metrics` — Prometheus text format. Includes `http_request_duration_seconds` histogram by method, route, and status. Query parameters stripped from route labels to prevent cardinality explosion. |
| **OpenAPI docs** | `GET /docs` — Swagger UI. `GET /docs/json` — raw spec. Available when `NODE_ENV !== 'production'`. |
| **Structured logs** | JSON via pino. Every request gets a `correlationId` (from `X-Correlation-Id` header or generated). Passed through to all log entries and response bodies. |

---

## Testing

```bash
npm test                  # unit tests (60 tests, ~3s)
INTEGRATION=true npx vitest run --no-file-parallelism tests/integration/
                          # integration tests — requires PostgreSQL on localhost:5432
```

### Unit tests

All unit tests mock the database and external services. No running infrastructure required.

### Integration tests

Integration tests exercise the full HTTP → business logic → real PostgreSQL path with a queue-based fake n8n HTTP server. They are skipped unless `INTEGRATION=true` is set.

**Prerequisites:**

```bash
# PostgreSQL must be running with a 'leads' database
createdb leads
npm run db:migrate
```

**Files:**

| File | Coverage |
|---|---|
| `tests/integration/meta-webhook.integration.test.ts` | `POST /webhooks/meta/lead-ads` — valid HMAC persist+deliver, duplicate, invalid HMAC |
| `tests/integration/unified-webhook.integration.test.ts` | `POST /webhooks/v1/leads` — instagram persist, duplicate, missing key, bad contract |

Integration tests run sequentially (`--no-file-parallelism`) to avoid concurrent DB writes between test files. CI provisions a `postgres:16` service container automatically.

---

## Roadmap

| Status | Item |
|---|---|
| ✅ Done | Facebook Lead Ads webhook ingestion + PostgreSQL persistence |
| ✅ Done | n8n async delivery with retries and full audit log |
| ✅ Done | HMAC signature validation |
| ✅ Done | OpenAPI docs + Prometheus metrics |
| ✅ Done | Dead-letter replay API with RBAC |
| ✅ Done | Multi-tenant routing — per-form/page URL cascade + field mapping |
| ✅ Done | Instagram SDR integration — unified webhook endpoint + contract v1.0 |
| ✅ Done | Integration test stack — real DB + fake n8n, 7 integration tests, CI Postgres service |
| ✅ Done | n8n-mcp integration guide + reusable Claude Code skill for automated workflow generation |
| ✅ Done | Auth system + setup wizard — JWT cookie, register/login/logout, 2-step LLM+Meta config wizard |
| ✅ Done | LLM provider abstraction — Anthropic, OpenAI, Gemini, OpenRouter with registry pattern |
| ✅ Done | Engineering cleanup — file structure reorganization, typed errors, TTL cache, explicit DI |

See `docs/ai-agent-roadmap.md` for the full delivery log and backlog.
