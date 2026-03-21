# OpenAPI Docs + Prometheus Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /docs` (Swagger UI, non-production only) and `GET /metrics` (Prometheus scrape, all environments) to the Fastify v4 lead ingestion service.

**Architecture:** Install four Fastify ecosystem plugins; wire `ZodTypeProvider` on the root Fastify instance so Zod schemas drive both TypeScript types and OpenAPI generation; conditionally register docs plugins based on an `enableDocs` flag passed to `createApp`; register `fastify-metrics` unconditionally with route exclusions and query-param stripping to prevent label cardinality explosion.

**Tech Stack:** Fastify v4, TypeScript, Zod v3, `@fastify/swagger` ^8, `@fastify/swagger-ui` ^5, `fastify-type-provider-zod` ^2, `fastify-metrics` ^11, vitest

---

## File Map

| File | What changes |
|---|---|
| `package.json` | Add 4 runtime dependencies |
| `src/app/createApp.ts` | Accept `{ enableDocs }` param; chain `withTypeProvider`; conditional swagger registration; metrics registration |
| `src/routes/health.ts` | Add Zod response schemas to `/health` and `/ready` |
| `src/routes/meta.ts` | Add Zod querystring + response schemas (no body schema on POST — preserves raw-body) |
| `src/server.ts` | Pass `enableDocs: env.NODE_ENV !== 'production'` to `createApp` |
| `tests/observability.test.ts` | New test file: 5 tests covering docs UI, spec JSON, metrics, and production gate |

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the four new packages**

```bash
npm install @fastify/swagger@^8 @fastify/swagger-ui@^5 fastify-type-provider-zod@^2 fastify-metrics@^11
```

Expected: packages appear in `package.json` under `dependencies`, `node_modules` updated.

- [ ] **Step 2: Verify installed versions are compatible**

```bash
node -e "
  import('@fastify/swagger').then(m => console.log('@fastify/swagger', m.default?.name ?? 'ok'));
  import('fastify-type-provider-zod').then(m => console.log('type-provider-zod keys:', Object.keys(m)));
  import('fastify-metrics').then(m => console.log('fastify-metrics', typeof m.default));
"
```

Expected: no import errors. `type-provider-zod` should export `ZodTypeProvider` and `jsonSchemaTransform`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @fastify/swagger, swagger-ui, type-provider-zod, fastify-metrics"
```

---

## Task 2: Wire type provider and update createApp signature

**Files:**
- Modify: `src/app/createApp.ts`
- Modify: `src/server.ts`

This is the foundation. Everything else depends on it.

- [ ] **Step 1: Write the failing test for production gate**

Create `tests/observability.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app/createApp.js';

describe('observability endpoints', () => {
  it('GET /docs returns 404 when enableDocs is false', async () => {
    const app = createApp({ enableDocs: false });
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- --reporter=verbose tests/observability.test.ts
```

Expected: FAIL — `createApp` does not accept arguments yet.

- [ ] **Step 3: Update createApp to accept options and wire the type provider**

Replace `src/app/createApp.ts` with:

```typescript
import Fastify from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import fastifyRawBody from 'fastify-raw-body';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { registerMetaRoutes } from '../routes/meta.js';
import { registerHealthRoutes } from '../routes/health.js';

interface CreateAppOptions {
  enableDocs: boolean;
}

export const createApp = (options: CreateAppOptions = { enableDocs: false }) => {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();

  app.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    routes: ['/webhooks/meta/lead-ads'],
    encoding: 'utf8',
    runFirst: true
  });

  app.register(sensible);
  app.register(helmet);
  app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW
  });

  app.register(registerHealthRoutes);
  app.register(registerMetaRoutes);

  return app;
};
```

Note: Swagger and metrics registration come in later tasks. The type provider is wired here.

- [ ] **Step 4: Update server.ts to pass enableDocs**

```typescript
import { createApp } from './app/createApp.js';
import { env } from './config/env.js';
import { startRetryWorker } from './workers/retryWorker.js';

const app = createApp({ enableDocs: env.NODE_ENV !== 'production' });
startRetryWorker();

app.listen({ host: env.HOST, port: env.PORT }).catch((error) => {
  app.log.error(error, 'failed to start server');
  process.exit(1);
});
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test -- --reporter=verbose tests/observability.test.ts
```

Expected: PASS — `/docs` returns 404 because no swagger-ui is registered yet.

- [ ] **Step 6: Run all existing tests to confirm nothing broke**

```bash
npm test
```

Expected: all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/createApp.ts src/server.ts tests/observability.test.ts
git commit -m "feat: wire ZodTypeProvider and add enableDocs option to createApp"
```

---

## Task 3: Register @fastify/swagger and @fastify/swagger-ui

**Files:**
- Modify: `src/app/createApp.ts`

- [ ] **Step 1: Add tests for docs endpoints**

Append to the `describe` block in `tests/observability.test.ts`:

```typescript
  it('GET /docs returns 200 HTML when enableDocs is true', async () => {
    const app = createApp({ enableDocs: true });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('GET /docs/json returns OpenAPI 3.0 spec when enableDocs is true', async () => {
    const app = createApp({ enableDocs: true });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.openapi).toMatch(/^3\.0/);
  });

  it('GET /docs/json does not expose /metrics path', async () => {
    const app = createApp({ enableDocs: true });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    const body = JSON.parse(res.body);
    expect(body.paths).not.toHaveProperty('/metrics');
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
npm test -- --reporter=verbose tests/observability.test.ts
```

Expected: 3 new tests FAIL — `/docs` returns 404 (not registered yet).

- [ ] **Step 3: Register swagger plugins in createApp.ts**

Replace `src/app/createApp.ts` with the full file below. Key changes from Task 2:
- Function is now `async` to allow dynamic `await import()` for conditional swagger loading
- Swagger and swagger-ui registered inside `if (options.enableDocs)` block — `jsonSchemaTransform` imported lazily so `@fastify/swagger` is not required in production
- Helmet registered *after* swagger-ui so swagger-ui's CSP headers are not overridden; swagger-ui sets its own permissive CSP for `/docs` routes via the `initOAuth`/`cspNonce` mechanism built into v5
- Metrics registration placeholder added (filled in Task 4)

```typescript
import Fastify from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import fastifyRawBody from 'fastify-raw-body';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { registerMetaRoutes } from '../routes/meta.js';
import { registerHealthRoutes } from '../routes/health.js';

interface CreateAppOptions {
  enableDocs: boolean;
}

export const createApp = async (options: CreateAppOptions = { enableDocs: false }) => {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();

  app.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    routes: ['/webhooks/meta/lead-ads'],
    encoding: 'utf8',
    runFirst: true
  });

  app.register(sensible);
  app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW
  });

  if (options.enableDocs) {
    const { jsonSchemaTransform } = await import('fastify-type-provider-zod');
    const swagger = (await import('@fastify/swagger')).default;
    const swaggerUi = (await import('@fastify/swagger-ui')).default;

    await app.register(swagger, {
      openapi: {
        info: {
          title: 'Facebook Lead Ads Ingestion API',
          description: 'Hybrid ingestion service: Meta Webhook → PostgreSQL → n8n',
          version: '1.0.0'
        }
      },
      transform: jsonSchemaTransform
    });

    // swagger-ui registered before helmet so its CSP headers for /docs are not overridden
    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list' }
    });
  }

  // helmet registered after swagger-ui (strict CSP applies to all routes except /docs)
  app.register(helmet);

  // Task 4: metrics registration goes here

  app.register(registerHealthRoutes);
  app.register(registerMetaRoutes);

  return app;
};
```

Update `src/server.ts` to `await` the factory:
```typescript
const app = await createApp({ enableDocs: env.NODE_ENV !== 'production' });
```

Update all `createApp(...)` calls in `tests/observability.test.ts` to `await createApp(...)`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- --reporter=verbose tests/observability.test.ts
```

Expected: all 4 tests (including the production gate) PASS.

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/createApp.ts src/server.ts tests/observability.test.ts
git commit -m "feat: register @fastify/swagger and @fastify/swagger-ui behind enableDocs flag"
```

---

## Task 4: Register fastify-metrics

**Files:**
- Modify: `src/app/createApp.ts`

- [ ] **Step 1: Add the metrics test**

Append to the `describe` block in `tests/observability.test.ts`:

```typescript
  it('GET /metrics returns Prometheus text with http_request_duration_seconds', async () => {
    const app = await createApp({ enableDocs: false });
    await app.ready();
    // Make a request so at least one metric is recorded
    await app.inject({ method: 'GET', url: '/health' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.body).toContain('http_request_duration_seconds');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- --reporter=verbose tests/observability.test.ts
```

Expected: FAIL — `/metrics` returns 404.

- [ ] **Step 3: Register fastify-metrics in createApp.ts**

Replace the `// Task 4: metrics registration goes here` comment in `src/app/createApp.ts` with:

```typescript
  // Metrics — always enabled
  const metricsPlugin = (await import('fastify-metrics')).default;
  await app.register(metricsPlugin, {
    defaultMetrics: { enabled: true },
    endpoint: '/metrics',
    routeMetrics: {
      enabled: true,
      // Verify the exact option name for your installed ^11.x version.
      // It may be `ignoredRoutes`, `routeBlacklist`, or `ignore`.
      // Check: node -e "import('fastify-metrics').then(m => console.log(Object.keys(m.default)))"
      ignoredRoutes: ['/metrics', '/docs', '/docs/json', '/docs/yaml', '/docs/static/*'],
      overrides: {
        histogram: {
          labelNames: ['method', 'route', 'status_code']
        }
      }
    },
    // Strip query parameters from route labels to prevent unbounded cardinality
    // e.g. /webhooks/meta/lead-ads?hub.verify_token=... → /webhooks/meta/lead-ads
    requestPathTransform: (req: { url: string }) => req.url.split('?')[0]
  });
```

**Note on `ignoredRoutes` option name:** Different patch versions of `fastify-metrics ^11.x` use different names. If the plugin throws on startup, check the installed version's README:
```bash
cat node_modules/fastify-metrics/README.md | grep -A5 "ignored\|blacklist\|exclude"
```
And adjust the option name accordingly.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- --reporter=verbose tests/observability.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/createApp.ts tests/observability.test.ts
git commit -m "feat: add Prometheus metrics via fastify-metrics at GET /metrics"
```

---

## Task 5: Add Zod schemas to health routes

**Files:**
- Modify: `src/routes/health.ts`

This makes `/health` and `/ready` appear correctly in the generated OpenAPI spec.

- [ ] **Step 1: Add a spec-coverage test**

Append to `tests/observability.test.ts`:

```typescript
  it('GET /docs/json includes /health and /ready routes', async () => {
    const app = await createApp({ enableDocs: true });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    const body = JSON.parse(res.body);
    expect(body.paths).toHaveProperty('/health');
    expect(body.paths).toHaveProperty('/ready');
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- --reporter=verbose tests/observability.test.ts
```

Expected: FAIL — paths exist but may lack schemas, or routes may not appear at all without schemas defined.

- [ ] **Step 3: Add schemas to health.ts**

Replace `src/routes/health.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pool } from '../db/client.js';

export const registerHealthRoutes = async (app: FastifyInstance) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/health', {
    schema: {
      response: {
        200: z.object({ status: z.literal('ok') })
      }
    }
  }, async () => ({ status: 'ok' as const }));

  typed.get('/ready', {
    schema: {
      response: {
        200: z.object({ status: z.literal('ready') }),
        503: z.object({ status: z.literal('not_ready') })
      }
    }
  }, async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ready' as const };
    } catch {
      return reply.status(503).send({ status: 'not_ready' as const });
    }
  });
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- --reporter=verbose tests/observability.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/health.ts tests/observability.test.ts
git commit -m "feat: add OpenAPI schemas to /health and /ready routes"
```

---

## Task 6: Add Zod schemas to meta routes

**Files:**
- Modify: `src/routes/meta.ts`

**Critical:** Do NOT add a body schema to the `POST /webhooks/meta/lead-ads` route. The `fastify-raw-body` plugin must capture raw bytes for HMAC signature validation — adding a Zod body schema would cause Fastify to consume the body stream first, breaking signature verification. Document the request body shape via `description` only.

- [ ] **Step 1: Add a spec-coverage test**

Append to `tests/observability.test.ts`:

```typescript
  it('GET /docs/json includes /webhooks/meta/lead-ads routes', async () => {
    const app = await createApp({ enableDocs: true });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    const body = JSON.parse(res.body);
    expect(body.paths).toHaveProperty('/webhooks/meta/lead-ads');
    const route = body.paths['/webhooks/meta/lead-ads'];
    expect(route).toHaveProperty('get');
    expect(route).toHaveProperty('post');
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- --reporter=verbose tests/observability.test.ts
```

Expected: FAIL — webhook routes may not appear in the spec without schemas.

- [ ] **Step 3: Add schemas to meta.ts**

Replace `src/routes/meta.ts`:

```typescript
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { receiveMetaWebhook, verifyWebhookChallenge } from '../controllers/metaWebhookController.js';
import { correlationIdFromHeader } from '../utils/correlation.js';
import { env } from '../config/env.js';
import { verifyMetaSignature } from '../integrations/meta/verification.js';

const ensureMetaSignature = (request: FastifyRequest, reply: FastifyReply) => {
  const signature = request.headers['x-hub-signature-256'] as string | undefined;
  const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;

  if (!rawBody || !verifyMetaSignature(rawBody, signature, env.META_APP_SECRET)) {
    const correlationId = correlationIdFromHeader(request.headers['x-correlation-id'] as string | undefined);
    void reply.status(401).send({ status: 'rejected', reason: 'invalid_signature', correlationId });
  }

  return;
};

// 400: generic rejection (validation failure from handler)
const rejection400Schema = z.object({
  status: z.literal('rejected'),
  reason: z.string(),
  correlationId: z.string()
});

// 401: signature-specific rejection (from ensureMetaSignature preValidation hook)
const rejection401Schema = z.object({
  status: z.literal('rejected'),
  reason: z.literal('invalid_signature'),
  correlationId: z.string()
});

export const registerMetaRoutes = async (app: FastifyInstance) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/webhooks/meta/lead-ads', {
    schema: {
      querystring: z.object({
        'hub.mode': z.string(),
        'hub.verify_token': z.string(),
        'hub.challenge': z.string()
      }),
      response: {
        200: z.string(),
        403: z.object({ error: z.string() })
      }
    }
  }, verifyWebhookChallenge);

  typed.post('/webhooks/meta/lead-ads', {
    preValidation: [ensureMetaSignature],
    bodyLimit: 1048576,
    schema: {
      // No body schema — preserves fastify-raw-body raw byte capture for HMAC validation
      description: 'Receives Meta leadgen webhook. Body is a MetaWebhookPayload (see metaWebhookSchema).',
      response: {
        202: z.object({ status: z.literal('accepted'), correlationId: z.string() }),
        400: rejection400Schema,
        401: rejection401Schema
      }
    }
  }, receiveMetaWebhook);
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- --reporter=verbose tests/observability.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all pass. If any existing meta-related tests break due to the querystring schema now enforcing types, check whether the test payloads include the required `hub.*` query params for the GET route.

- [ ] **Step 6: Commit**

```bash
git add src/routes/meta.ts tests/observability.test.ts
git commit -m "feat: add OpenAPI schemas to webhook routes"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass, including the 7 new observability tests.

- [ ] **Step 2: Start the dev server and manually verify**

```bash
npm run dev
```

Then visit:
- `http://localhost:3000/docs` — Swagger UI should render with all routes listed
- `http://localhost:3000/docs/json` — JSON spec; verify `/metrics` is absent from `paths`
- `http://localhost:3000/metrics` — Plain text Prometheus output; verify `http_request_duration_seconds` is present

- [ ] **Step 3: Update the AI agent delivery log**

Append a row to `docs/ai-agent-roadmap.md`:

```markdown
| 2026-03-21 | Claude Code | Added GET /docs (Swagger UI) and GET /metrics (Prometheus). Installed @fastify/swagger, @fastify/swagger-ui, fastify-type-provider-zod, fastify-metrics. | docs/superpowers/specs/2026-03-21-openapi-prometheus-design.md | Next: dead-letter replay API with RBAC | Manual |
```

- [ ] **Step 4: Final commit**

```bash
git add docs/ai-agent-roadmap.md
git commit -m "docs: update delivery log for OpenAPI + Prometheus feature"
```
