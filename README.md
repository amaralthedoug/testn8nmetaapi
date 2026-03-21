# Facebook Lead Ads Hybrid Ingestion Service

Production-oriented hybrid architecture: **Meta Webhook -> Backend Ingestion API -> PostgreSQL persistence -> n8n orchestrator**.

## Why hybrid
- Backend owns mission-critical ingestion and persistence.
- n8n receives trusted normalized payload only.
- Idempotency, retries, auditing, and observability stay under backend control.

## Architecture
1. Meta sends leadgen webhook.
2. `POST /webhooks/meta/lead-ads` validates + stores raw event in `webhook_events`.
3. Payload is normalized into internal lead schema.
4. Deduplication by provider lead id or deterministic hash.
5. Lead persisted in `leads`.
6. Async delivery adapter forwards to n8n with retries and logs every attempt in `delivery_attempts`.
7. Failed deliveries remain queryable and retry worker replays periodically.

## Project structure
```
src/
  app/
  config/
  routes/
  controllers/
  services/
  integrations/
    meta/
    n8n/
  db/
  repositories/
  workers/
  schemas/
  utils/
  types/
tests/
db/migrations/
docs/
```

## Environment variables
Copy `.env.example` to `.env` and update values.
- `DATABASE_URL`
- `META_VERIFY_TOKEN`
- `META_APP_SECRET`
- `N8N_WEBHOOK_URL`
- `N8N_INTERNAL_AUTH_TOKEN`
- retry and rate limit knobs

## Local development
```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

## Docker
```bash
docker compose up --build
```
Then run migration inside app container:
```bash
docker compose exec app npm run db:migrate
```

## Endpoints
- `GET /health`
- `GET /ready`
- `GET /webhooks/meta/lead-ads` (verification challenge)
- `POST /webhooks/meta/lead-ads` (lead ingestion)

## Idempotency strategy
- Primary key: `externalLeadId` when provided.
- Fallback key: SHA-256 hash of `phone|email|formId|createdTime`.
- Duplicate events update `webhook_events.processing_status=duplicate` and skip downstream dispatch.

## Failure handling
- Validation failures: event stored with `failed` + error.
- n8n delivery retries with exponential backoff (`RETRY_MAX_ATTEMPTS`, `RETRY_BASE_DELAY_MS`).
- Attempts are persisted in `delivery_attempts`.
- Permanent failures marked in `leads.n8n_delivery_status=failed` and picked up by retry worker.

## Security notes
- Meta challenge token verification included.
- `X-Hub-Signature-256` HMAC validation using the Meta app secret.
- Payload shape validated with Zod.
- Secrets from env only.
- Structured JSON logs via pino; secret redaction enabled.
- Rate limiting enabled.

## n8n setup
See `docs/n8n-workflow.md` for node-by-node workflow and production webhook guidance.

## Assumptions
- Meta app/page permissions are configured externally.
- n8n production webhook is active and reachable from backend.
- HTTPS termination handled by deployment ingress/proxy.

## Remaining TODOs / risks
- Add OpenAPI docs and Prometheus metrics endpoint.
- Add dead-letter replay API with RBAC.
- Add multi-tenant page/client routing and per-form field mapping.
- Add integration test container stack (app + postgres + mocked n8n).

## AI agent delivery log
- Registramos cada entrega de um agente de IA (Codex, Claude, GPT-5.x, etc.) em `docs/ai-agent-roadmap.md`. Abra o arquivo para ver qual foi o último item implementado e o que ficou pendente.
