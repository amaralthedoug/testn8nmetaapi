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
- `fieldMap` values are restricted to promotable fields of `NormalizedLead`: `phone`, `email`, `fullName`, `firstName`, `lastName`, `city`, `state`, `productInterest`, `budgetRange`, `purchaseTimeline`.

**Routing cascade:**
```
formId match               → use form URL + form fieldMap
pageId match (no form)     → use page URL (no fieldMap)
default configured         → use default URL (no fieldMap)
no match, no default       → use N8N_WEBHOOK_URL from env
```

---

## New Files

### `src/config/routingConfig.ts`

Loads and validates `config/routing.json` at startup using Zod. Returns a validated `RoutingConfig` object or throws with a descriptive error. If the file does not exist, returns `null` (routing disabled — env fallback used).

### `src/routing/resolveRoute.ts`

```typescript
type PromotableField =
  | 'phone' | 'email' | 'fullName' | 'firstName' | 'lastName'
  | 'city' | 'state' | 'productInterest' | 'budgetRange' | 'purchaseTimeline';

type RouteMatch = {
  url: string;
  fieldMap: Record<string, PromotableField>;
  source: 'form' | 'page' | 'default' | 'env-fallback';
};

resolveRoute(
  formId: string | undefined,
  pageId: string | undefined,
  config: RoutingConfig | null,
  envFallbackUrl: string
): RouteMatch
```

Pure function. No I/O, no side effects. `source` is used for structured logging only.

### `src/routing/applyFieldMap.ts`

```typescript
applyFieldMap(
  lead: NormalizedLead,
  fieldMap: Record<string, PromotableField>
): NormalizedLead
```

Pure function. Returns a new `NormalizedLead` object (immutable — does not mutate the input). For each `fieldMap` entry:
1. If `lead.rawCustomFields[sourceKey]` exists and is a string, promote to `lead[targetField]`.
2. Remove the promoted key from `rawCustomFields`.
3. Do **not** overwrite a field already set by the Meta standard payload — Meta data takes priority.

---

## Modified Files

### `src/integrations/n8n/client.ts`

```typescript
// Before
postToN8n(payload: N8nLeadPayload): Promise<N8nResponse>

// After
postToN8n(payload: N8nLeadPayload, url: string): Promise<N8nResponse>
```

### `src/services/n8nDeliveryService.ts`

```typescript
// Before
deliver(leadId: string, payload: N8nLeadPayload): Promise<void>

// After
deliver(leadId: string, payload: N8nLeadPayload, url: string): Promise<void>
```

### `src/services/leadIngestionService.ts`

`routingConfig` loaded once at startup and injected via constructor. In the lead processing loop, two steps are inserted between normalization and persistence:

```typescript
const route = resolveRoute(lead.formId, lead.pageId, routingConfig, env.N8N_WEBHOOK_URL);
const mappedLead = applyFieldMap(lead, route.fieldMap);
// mappedLead used from here on (persistence + delivery)
deliver(leadId, n8nPayload, route.url);
```

### `src/app/createApp.ts`

Loads routing config once and injects into `LeadIngestionService`.

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
          ├── resolveRoute(formId, pageId, config)  → { url, fieldMap, source }
          ├── applyFieldMap(lead, fieldMap)          → mappedLead
          ├── Deduplication (uses mappedLead)
          ├── leadRepository.create(mappedLead)
          └── N8nDeliveryService.deliver(id, payload, url)
```

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `routing.json` missing | Silent — routing disabled, env fallback used |
| `routing.json` invalid (Zod) | Startup failure with descriptive error — fail fast before accepting requests |
| `formId`/`pageId` not in config | Falls through cascade to default or env fallback — lead always delivered |
| `fieldMap` key not in `rawCustomFields` | Silently skipped — no error, no data loss |
| `fieldMap` target already set | Source value discarded — Meta standard field takes priority |

---

## Testing Strategy

| Scope | Approach |
|---|---|
| `resolveRoute` | Pure unit tests — form match, page fallback, default fallback, env fallback, missing ids |
| `applyFieldMap` | Pure unit tests — promotion, no-overwrite, missing key, rawCustomFields cleanup |
| `routingConfig` Zod validation | Unit tests — valid JSON passes, invalid JSON throws with message |
| `LeadIngestionService` | Spy on `deliver()` to assert correct URL and mapped lead fields |
| Ingestion route (`app.inject()`) | Integration test confirming end-to-end routing with mocked delivery |

---

## What Does Not Change

- HMAC signature validation
- Webhook schema validation
- Deduplication logic
- Retry worker
- Dead-letter replay API
- Admin routes
- All existing tests (API contract unchanged)

---

## File Map Summary

| File | Action |
|---|---|
| `config/routing.json` | Create (with example values) |
| `config/routing.example.json` | Create (committed reference, routing.json gitignored in local dev) |
| `src/config/routingConfig.ts` | Create |
| `src/routing/resolveRoute.ts` | Create |
| `src/routing/applyFieldMap.ts` | Create |
| `src/integrations/n8n/client.ts` | Modify — add `url` param |
| `src/services/n8nDeliveryService.ts` | Modify — add `url` param |
| `src/services/leadIngestionService.ts` | Modify — resolve route + apply field map |
| `src/app/createApp.ts` | Modify — load routing config, inject into service |
| `tests/routing.test.ts` | Create |
