# Design: OpenAPI Docs + Prometheus Metrics

**Date:** 2026-03-21
**Status:** Approved

## Goal

Add two observability/discoverability endpoints to the Facebook Lead Ads ingestion service:

- `GET /docs` — Swagger UI backed by an auto-generated OpenAPI 3.0 spec
- `GET /metrics` — Prometheus scrape endpoint with HTTP instrumentation

## New Dependencies

| Package | Purpose |
|---|---|
| `@fastify/swagger` | Generates OpenAPI 3.0 spec from route schemas |
| `@fastify/swagger-ui` | Serves Swagger UI at `/docs` |
| `fastify-type-provider-zod` | Bridges Zod schemas → Fastify type system → OpenAPI |
| `fastify-metrics` | Auto-instruments HTTP routes and exposes `/metrics` via `prom-client` |

`prom-client` is a transitive dependency of `fastify-metrics`; no direct install needed.

## Architecture

### Plugin registration (`src/app/createApp.ts`)

Registration order:

1. `.withTypeProvider<ZodTypeProvider>()` on the Fastify instance — before any routes
2. `@fastify/swagger` with OpenAPI 3.0 metadata (title, version, description) — before routes
3. `@fastify/swagger-ui` at `/docs` — after swagger
4. `fastify-metrics` with `defaultMetrics: true` — auto-registers `/metrics`

No existing plugin registrations (helmet, rate-limit, sensible, raw-body) change.

### Route schema additions

Each existing route gets a `schema` object so OpenAPI collects it. The existing `metaWebhookSchema` (Zod) is reused directly for the POST body.

| Route | Schema additions |
|---|---|
| `GET /health` | response 200: `{ status: 'ok' }` |
| `GET /ready` | response 200: `{ status: 'ready' }`, 503: `{ status: 'not_ready' }` |
| `GET /webhooks/meta/lead-ads` | querystring: `hub.mode`, `hub.verify_token`, `hub.challenge`; response: string |
| `POST /webhooks/meta/lead-ads` | body: existing `metaWebhookSchema`; response 200: `{ received: true }`, 401: rejection shape |

`/metrics` is self-registered by `fastify-metrics` — no manual schema needed.

### Security

`/metrics` is public (unauthenticated). This is standard for Prometheus in internal/containerized environments where network-level isolation is the control. No changes to the existing HMAC signature validation on the webhook route.

## Resulting Endpoints

| Path | Purpose |
|---|---|
| `GET /health` | Liveness (unchanged) |
| `GET /ready` | Readiness (unchanged) |
| `GET /docs` | Swagger UI |
| `GET /docs/json` | OpenAPI 3.0 JSON spec |
| `GET /metrics` | Prometheus scrape |
| `GET /webhooks/meta/lead-ads` | Meta verification challenge (unchanged) |
| `POST /webhooks/meta/lead-ads` | Lead ingestion (unchanged) |

## Files Changed

| File | Change |
|---|---|
| `package.json` | Add 4 new dependencies |
| `src/app/createApp.ts` | Add type provider + 3 plugin registrations |
| `src/routes/health.ts` | Add Zod response schemas |
| `src/routes/meta.ts` | Add Zod query/body/response schemas |

No new files required.

## Testing

Two new tests (in-process Fastify instance, same pattern as existing tests):

1. `GET /docs/json` → 200, body contains `openapi: '3.0.x'`
2. `GET /metrics` → 200, `Content-Type: text/plain`, body contains `http_request_duration_seconds`

Existing tests require no changes.
