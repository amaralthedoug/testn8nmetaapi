# Design: OpenAPI Docs + Prometheus Metrics

**Date:** 2026-03-21
**Status:** Approved

## Goal

Add two observability/discoverability endpoints to the Facebook Lead Ads ingestion service:

- `GET /docs` — Swagger UI backed by an auto-generated OpenAPI 3.0 spec (non-production only)
- `GET /metrics` — Prometheus scrape endpoint with HTTP instrumentation (all environments)

## New Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@fastify/swagger` | `^8.x` | OpenAPI 3.0 spec generation from route schemas |
| `@fastify/swagger-ui` | `^5.x` | Swagger UI at `/docs` |
| `fastify-type-provider-zod` | `^2.x` | Zod v3 → Fastify v4 type system → OpenAPI via `jsonSchemaTransform` |
| `fastify-metrics` | `^11.x` | HTTP instrumentation + `/metrics` via `prom-client` |

**Compatibility:** `fastify-type-provider-zod` v2.x required for Fastify v4 + Zod v3.

## Architecture

### Type provider

```ts
const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
```

Method call on the instance (not a plugin), so ordering relative to `app.register()` is not a concern. Route handler functions must be typed to accept the narrowed `FastifyInstance<..., ZodTypeProvider>` or cast via `as FastifyInstance`.

### Docs/metrics enablement

`createApp` accepts `{ enableDocs: boolean }`. `server.ts` passes `env.NODE_ENV !== 'production'`. Tests pass it explicitly — avoiding the module-load-time `env` parse issue.

`jsonSchemaTransform` is imported inside the `if (enableDocs)` block (lazy/conditional) so `@fastify/swagger` is not required at runtime in production builds.

### Plugin registration order

1. **(if `enableDocs`)** `@fastify/swagger` with `transform: jsonSchemaTransform` and OpenAPI 3.0 metadata — before routes
2. **(if `enableDocs`)** `@fastify/swagger-ui` at prefix `/docs`, registered inside a scoped Fastify plugin so a permissive CSP (`script-src 'unsafe-inline'`, `style-src 'unsafe-inline'`) can be applied to `/docs/*` without affecting other routes. The outer `@fastify/helmet` registration retains strict defaults for all other routes.
3. `fastify-metrics` with:
   - `defaultMetrics: { enabled: true }`
   - `ignoredRoutes: ['/metrics', '/docs', '/docs/json', '/docs/yaml']` to exclude internal endpoints from histograms entirely (verify exact option name in installed `^11.x`)
   - `requestPathTransform: (url) => url.split('?')[0]` to strip query parameters from route labels and prevent unbounded label cardinality
4. All existing plugins (raw-body, sensible, helmet, rate-limit) unchanged

### Route schemas

All schemas use Zod types; `jsonSchemaTransform` converts them to JSON Schema in the OpenAPI output.

**`GET /health`**
- Response 200: `z.object({ status: z.literal('ok') })`

**`GET /ready`**
- Response 200: `z.object({ status: z.literal('ready') })`
- Response 503: `z.object({ status: z.literal('not_ready') })`

**`GET /webhooks/meta/lead-ads`** (Meta challenge)
- Querystring: `z.object({ 'hub.mode': z.string(), 'hub.verify_token': z.string(), 'hub.challenge': z.string() })`
- Response 200: `z.string()`
- Response 403: `z.object({ error: z.string() })`

**`POST /webhooks/meta/lead-ads`** (lead ingestion)
- **No body schema attached** — preserving `fastify-raw-body` raw byte capture for HMAC signature validation. The request body contract is documented via OpenAPI `description` only.
- Response 202: `z.object({ status: z.literal('accepted'), correlationId: z.string() })`
- Response 400: `z.object({ status: z.literal('rejected'), reason: z.string(), correlationId: z.string() })`
- Response 401: `z.object({ status: z.literal('rejected'), reason: z.literal('invalid_signature'), correlationId: z.string() })`

`/metrics` and `/docs` are not application routes and do not appear in the generated spec.

### Security

**`/metrics`:** Public, no application-level auth. Network-level access control (container networking / ingress) is the enforcement mechanism. Bearer token auth deferred to a future iteration.

**`/docs`:** Disabled in production by not registering the plugins when `enableDocs` is false.

**Helmet CSP:** Scoped permissive CSP applied only inside the `/docs` prefix plugin. All other routes keep strict Helmet defaults.

## Files Changed

| File | Change |
|---|---|
| `package.json` | Add 4 new dependencies |
| `src/app/createApp.ts` | Chain `withTypeProvider`; accept `{ enableDocs }`; conditional swagger; metrics plugin |
| `src/routes/health.ts` | Add Zod response schemas |
| `src/routes/meta.ts` | Add Zod querystring/response schemas (no body schema on POST) |
| `src/server.ts` | Pass `enableDocs: env.NODE_ENV !== 'production'` to `createApp` |

## Testing

All tests use the in-process Fastify instance with `enableDocs` passed explicitly.

| # | Test | `enableDocs` |
|---|---|---|
| 1 | `GET /docs` → 200 `text/html` | `true` |
| 2 | `GET /docs/json` → 200, `openapi` starts with `3.0`, webhook routes in `paths` | `true` |
| 3 | `GET /docs/json` → `/metrics` not in `paths` | `true` |
| 4 | `GET /metrics` → 200 `text/plain`, body contains `http_request_duration_seconds` | `false` |
| 5 | `GET /docs` → 404 | `false` |

Existing tests require no changes.
