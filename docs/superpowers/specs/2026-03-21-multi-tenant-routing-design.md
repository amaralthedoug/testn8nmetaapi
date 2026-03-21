# Multi-Tenant Routing + Per-Form Field Mapping — Design Spec

**Date:** 2026-03-21
**Status:** Approved for implementation

---

## Goal

Route leads from different Facebook forms and pages to different n8n webhook URLs, and promote custom form fields (`rawCustomFields`) into typed `NormalizedLead` fields — all driven by a static JSON config file with zero-redeploy changes to the ingestion pipeline.

---

## Context

The current system delivers every lead to a single `N8N_WEBHOOK_URL`. In the Meta Lead Ads ecosystem, a company typically manages multiple Facebook pages and multiple forms per page, each representing a different product, campaign, or funnel stage. These should map to different n8n workflows.

Meta has two field types:
- **Standard fields** — fixed keys (`email`, `phone_number`, etc.) already handled by the normalizer.
- **Custom fields** — free-text labels set by the advertiser (`"mobile phone"`, `"product interest"`), landing in `rawCustomFields` as an opaque blob.

The feature closes both gaps: route by form/page identity, and promote custom fields to typed lead properties.

---

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Config storage | JSON file (`config/routing.json`) | Routing rules change rarely; redeploy is acceptable; git provides audit trail for free |
| Routing granularity | form_id → page_id → default → env fallback | Specificity cascade; form is most semantically meaningful; page fallback prevents silent drops on new forms |
| Field mapping scope | Custom fields only (`rawCustomFields`) | Standard fields are already normalized; value transformation is n8n's responsibility |
| Implementation style | Pure functions + Zod validation | Follows existing project patterns; pure functions are trivially testable without mocks |
| Target URL persistence | Store in `leads.n8n_target_url` | Retry worker must replay to the same URL used during first attempt — not the global default |
| Service wiring | `app.decorate('leadIngestionService', ...)` | Controller uses a module-level singleton — Fastify decoration is the idiomatic way to inject a configured instance without restructuring the controller |

---

## Config Schema (`config/routing.json`)

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
            "product interest": "productInterest",
            "budget range": "budgetRange",
            "purchase timeline": "purchaseTimeline"
          }
        }
      ]
    }
  ]
}
```

**Rules:**
- `default` is optional. If absent and no route matches, falls back to `N8N_WEBHOOK_URL` env var.
- `pages[].url` is the fallback URL for all unmapped forms on that page.
- `pages[].forms[].url` overrides the page URL for that specific form.
- `fieldMap` is optional at any level. A form entry without `fieldMap` only changes the delivery URL.
- `fieldMap` keys are the exact labels the advertiser wrote in the Meta form (case-sensitive).
- `fieldMap` values are restricted to the promotable subset of `NormalizedLead` (see below).

**Routing cascade:**
```
formId match               → use form URL + form fieldMap
pageId match (no form)     → use page URL (no fieldMap)
default configured         → use default URL (no fieldMap)
no match, no default       → use N8N_WEBHOOK_URL from env
```

---

## Promotable Fields

`fieldMap` target values are restricted to this set (excludes Meta envelope fields like `pageId`, `formId`, `externalLeadId` which come from the webhook itself, not from custom form answers):

```
phone | email | fullName | firstName | lastName
city  | state | productInterest | budgetRange | purchaseTimeline
campaignName | adsetName | adName
```

`campaignName`, `adsetName`, and `adName` are included because the normalizer does not currently populate them from the webhook envelope — they would only be available if set as custom questions.

---

## New Files

### `config/routing.example.json`

Committed reference template. `config/routing.json` is gitignored in local dev (contains real URLs).

### `src/config/routingConfig.ts`

Loads and validates `config/routing.json` at startup using Zod via `fs.promises.readFile` (async — does not block the event loop). Returns a validated `RoutingConfig` object or:
- `null` if the file does not exist (routing disabled — env fallback used, no startup error)
- throws if the file exists but fails Zod validation (startup failure — fail fast before accepting requests)

The thrown error must propagate through the `createApp` promise chain and must not be caught and swallowed.

### `src/routing/resolveRoute.ts`

```typescript
type PromotableField =
  | 'phone' | 'email' | 'fullName' | 'firstName' | 'lastName'
  | 'city' | 'state' | 'productInterest' | 'budgetRange' | 'purchaseTimeline'
  | 'campaignName' | 'adsetName' | 'adName';

type RouteMatch = {
  url: string;
  fieldMap: Record<string, PromotableField>;
  source: 'form' | 'page' | 'default' | 'env';  // for structured logging only — not in payload
};

resolveRoute(
  formId: string | undefined,
  pageId: string | undefined,
  config: RoutingConfig | null,
  envFallbackUrl: string
): RouteMatch
```

Pure function. No I/O, no side effects.

### `src/routing/applyFieldMap.ts`

```typescript
applyFieldMap(
  lead: NormalizedLead,
  fieldMap: Record<string, PromotableField>
): NormalizedLead
```

Pure function. Returns a **new** `NormalizedLead` object (does not mutate the input). For each `fieldMap` entry:
1. If `lead.rawCustomFields[sourceKey]` exists **and is a string**, promote its value to `lead[targetField]`.
2. Remove the promoted key from `rawCustomFields` in the returned object (prevents duplication in stored `normalized_payload`).
3. If the value is not a string (number, array, object), skip silently — no error, no promotion.
4. Do **not** overwrite a field already set by the Meta standard payload. "Already set" means `lead[targetField] !== undefined`. If Meta sent a value that normalizes to `undefined` (e.g. empty phone), the custom field promotion will fill it in — this is correct behavior.

> **Note on file location:** `src/routing/` is a deliberate choice over `src/utils/`. These functions are domain-specific to the routing feature and will grow alongside it. A dedicated directory keeps them cohesive.

---

## Modified Files

### `db/migrations/003_add_n8n_target_url.sql`

```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS n8n_target_url TEXT;
```

Required so the retry worker can replay to the correct per-form URL, not the global `N8N_WEBHOOK_URL`.

### `src/integrations/n8n/client.ts`

```typescript
// Before
postToN8n(payload: N8nLeadPayload): Promise<N8nResponse>

// After
postToN8n(payload: N8nLeadPayload, url: string): Promise<N8nResponse>
```

`N8N_INTERNAL_AUTH_TOKEN` header is always sent regardless of which URL is targeted.

### `src/services/n8nDeliveryService.ts`

```typescript
// Before
deliver(leadId: string, payload: N8nLeadPayload): Promise<void>

// After
deliver(leadId: string, payload: N8nLeadPayload, url: string): Promise<void>
```

`url` is threaded through to `postToN8n(payload, url)`.

### `src/services/leadIngestionService.ts`

New constructor signature (default parameters keep existing tests working):

```typescript
constructor(
  private readonly deliveryService = new N8nDeliveryService(),
  private readonly routingConfig: RoutingConfig | null = null
) {}
```

Processing order in the lead loop (order is critical):

```typescript
// 1. Resolve route
const route = resolveRoute(lead.formId, lead.pageId, this.routingConfig, env.N8N_WEBHOOK_URL);

// 2. Apply field map — BEFORE hash and persistence
const mappedLead = applyFieldMap(lead, route.fieldMap);

// 3. Compute hash on mapped lead (promotion may affect phone/email used for dedup)
const leadHash = buildLeadHash(mappedLead);

// 4. Persist mapped lead + target URL
const leadId = await leadRepository.create(mappedLead, leadHash, route.url);

// 5. Build n8n payload using mapped lead
const n8nPayload: N8nLeadPayload = {
  correlationId,
  ingestedAt: new Date().toISOString(),
  lead: mappedLead,   // ← mapped lead, not original
  meta: { isDuplicate: false, rawEventStored: true, version: '1.0.0' }
};

// 6. Log routing source
logger.info({ correlationId, formId: lead.formId, routeSource: route.source }, 'lead routed');

// 7. Deliver to resolved URL
setImmediate(async () => {
  await this.deliveryService.deliver(leadId, n8nPayload, route.url);
});
```

### `src/repositories/leadRepository.ts`

`create()` receives `n8nTargetUrl: string` as an additional parameter and persists it to `leads.n8n_target_url`.

### `src/repositories/retryRepository.ts`

`listFailedLeads()` must include `n8n_target_url` in the SELECT:

```sql
SELECT id, normalized_payload, n8n_target_url
FROM leads
WHERE n8n_delivery_status = 'failed'
ORDER BY updated_at ASC
LIMIT $1
```

### `src/workers/retryWorker.ts`

Reads `n8n_target_url` from the leads row. Falls back to `env.N8N_WEBHOOK_URL` if null (leads created before this migration):

```typescript
const targetUrl = row.n8n_target_url ?? env.N8N_WEBHOOK_URL;
await service.deliver(row.id, payload, targetUrl);
```

### `src/app/createApp.ts`

Loads routing config once (async) and decorates the app with a configured `LeadIngestionService` instance. The controller reads `request.server.leadIngestionService` instead of its module-level singleton:

```typescript
const routingConfig = await loadRoutingConfig();
const leadIngestionService = new LeadIngestionService(new N8nDeliveryService(), routingConfig);
app.decorate('leadIngestionService', leadIngestionService);
```

TypeScript declaration for the decorator must be added to keep type safety:

```typescript
declare module 'fastify' {
  interface FastifyInstance {
    leadIngestionService: LeadIngestionService;
  }
}
```

### `src/controllers/metaWebhookController.ts`

Replace module-level singleton with the decorated instance:

```typescript
// Before
const leadIngestionService = new LeadIngestionService();

// After — read from Fastify instance (injected in createApp)
export const receiveMetaWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
  const result = await request.server.leadIngestionService.ingest({ ... });
  // rest unchanged
};
```

---

## Data Flow (updated)

```
POST /webhooks/meta/lead-ads
    │
    ├── HMAC validation
    ├── Zod schema validation
    ├── webhookEventRepository.create()
    │
    └── For each normalized lead:
          ├── resolveRoute(formId, pageId, config, envUrl)       → { url, fieldMap, source }
          ├── applyFieldMap(lead, fieldMap)                      → mappedLead
          ├── buildLeadHash(mappedLead)                          → hash (on mapped lead)
          ├── Deduplication check
          ├── leadRepository.create(mappedLead, hash, url)       → persists n8n_target_url
          ├── Build n8nPayload with lead: mappedLead
          └── N8nDeliveryService.deliver(id, payload, url)

Retry worker:
    ├── retryRepository.listFailedLeads() → includes n8n_target_url
    └── N8nDeliveryService.deliver(id, payload, row.n8n_target_url ?? env.N8N_WEBHOOK_URL)
```

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `routing.json` missing | Silent — routing disabled, env fallback used |
| `routing.json` invalid (Zod) | Startup failure with descriptive error — fail fast |
| `formId`/`pageId` not in config | Falls through cascade — lead always delivered |
| `fieldMap` key not in `rawCustomFields` | Silently skipped |
| `fieldMap` value is not a string | Silently skipped |
| `fieldMap` target already set (`!== undefined`) | Source value discarded — Meta data takes priority |

---

## Testing Strategy

| Scope | Approach |
|---|---|
| `resolveRoute` | Pure unit tests — form match, page fallback, default fallback, env fallback, missing ids |
| `applyFieldMap` | Pure unit tests — promotion, no-overwrite (`!== undefined`), non-string skip, rawCustomFields cleanup |
| `routingConfig` Zod | Unit tests — valid JSON passes, invalid schema throws, missing file returns null |
| `LeadIngestionService` | Spy on `deliver()` to assert correct URL; assert `leadRepository.create` called with mapped lead |
| Retry worker | Verify `deliver()` called with `n8n_target_url` from row, not global env URL |
| Ingestion route (`app.inject()`) | End-to-end test with mocked delivery confirming correct URL used |

---

## What Does Not Change

- HMAC signature validation
- Webhook schema validation (Zod)
- Dead-letter replay API
- Admin routes
- All existing tests (API contract unchanged)

---

## File Map Summary

| File | Action |
|---|---|
| `config/routing.example.json` | Create (committed reference) |
| `config/routing.json` | Create locally (gitignored in dev) |
| `db/migrations/003_add_n8n_target_url.sql` | Create |
| `src/config/routingConfig.ts` | Create |
| `src/routing/resolveRoute.ts` | Create |
| `src/routing/applyFieldMap.ts` | Create |
| `src/integrations/n8n/client.ts` | Modify — add `url` param |
| `src/services/n8nDeliveryService.ts` | Modify — add `url` param, thread to postToN8n |
| `src/services/leadIngestionService.ts` | Modify — constructor, resolve route, apply map, hash on mapped lead, n8nPayload with mappedLead |
| `src/repositories/leadRepository.ts` | Modify — persist n8n_target_url |
| `src/repositories/retryRepository.ts` | Modify — SELECT n8n_target_url |
| `src/workers/retryWorker.ts` | Modify — read n8n_target_url, pass to deliver |
| `src/controllers/metaWebhookController.ts` | Modify — use request.server.leadIngestionService |
| `src/app/createApp.ts` | Modify — load routing config, decorate app with service |
| `tests/routing.test.ts` | Create |
