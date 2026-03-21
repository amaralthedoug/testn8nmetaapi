# Multi-Tenant Routing + Per-Form Field Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route leads from different Facebook forms/pages to different n8n webhook URLs and promote custom form fields into typed `NormalizedLead` fields, driven by a static `config/routing.json` file.

**Architecture:** A `resolveRoute` pure function implements the form → page → default → env cascade. An `applyFieldMap` pure function promotes `rawCustomFields` entries into typed lead fields. The resolved URL is persisted to `leads.n8n_target_url` so the retry worker replays to the correct endpoint. The `LeadIngestionService` is constructed once in `createApp` with the routing config and exposed via `app.decorate()`.

**Tech Stack:** Fastify v4, TypeScript ESM, Zod v3, raw SQL via `pg`, Vitest, Node.js `fs.promises`

**Spec:** `docs/superpowers/specs/2026-03-21-multi-tenant-routing-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `db/migrations/003_add_n8n_target_url.sql` | Create | Add `n8n_target_url TEXT` column to `leads` |
| `config/routing.example.json` | Create | Committed reference template |
| `src/config/routingConfig.ts` | Create | Zod schema + `loadRoutingConfig()` async loader |
| `src/routing/resolveRoute.ts` | Create | Pure function: form → page → default → env cascade |
| `src/routing/applyFieldMap.ts` | Create | Pure function: promote `rawCustomFields` to typed fields |
| `src/integrations/n8n/client.ts` | Modify | Add `url` parameter to `postToN8n` |
| `src/services/n8nDeliveryService.ts` | Modify | Add `url` parameter to `deliver`, thread to `postToN8n` |
| `src/repositories/leadRepository.ts` | Modify | Add optional `n8nTargetUrl` to `create` (default `null`) |
| `src/repositories/retryRepository.ts` | Modify | SELECT `n8n_target_url` in `listFailedLeads` |
| `src/workers/retryWorker.ts` | Modify | Read `n8n_target_url` from row, pass to `deliver` |
| `src/services/leadIngestionService.ts` | Modify | Constructor + resolve route + apply map + hash on mapped lead |
| `src/controllers/metaWebhookController.ts` | Modify | Use `request.server.leadIngestionService` |
| `src/app/createApp.ts` | Modify | Load routing config, decorate app with service instance |
| `tests/routing.test.ts` | Create | Unit tests for `resolveRoute` and `applyFieldMap` |
| `tests/routing-config.test.ts` | Create | Unit tests for `loadRoutingConfig` (null, valid, invalid) |
| `tests/retry-worker.test.ts` | Create | Tests for retry URL routing |
| `tests/ingestion-routing.test.ts` | Create | End-to-end integration test |
| `tests/delivery-retry.test.ts` | Modify | Update `postToN8n` spy to include `url` argument |
| `tests/ingestion-dedupe.test.ts` | Modify | Update `leadRepository.create` spy for new signature |

---

## Task 1: DB Migration

**Files:**
- Create: `db/migrations/003_add_n8n_target_url.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- db/migrations/003_add_n8n_target_url.sql
-- Persists the resolved n8n target URL per lead so the retry worker
-- replays to the same endpoint used during initial delivery.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS n8n_target_url TEXT;
```

- [ ] **Step 2: Commit**

```bash
git add db/migrations/003_add_n8n_target_url.sql
git commit -m "chore: add n8n_target_url column to leads for per-form routing"
```

> To apply locally: `npm run db:migrate`. Tests use mocked repositories — no local DB needed to run the suite.

---

## Task 2: Routing Config — Example File + Zod Loader + Unit Tests

**Files:**
- Create: `config/routing.example.json`
- Create: `src/config/routingConfig.ts`
- Create: `tests/routing-config.test.ts`

- [ ] **Step 1: Create `config/routing.example.json`**

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

- [ ] **Step 2: Add `config/routing.json` to `.gitignore`**

Open `.gitignore` and add:
```
config/routing.json
```

- [ ] **Step 3: Write failing tests for `loadRoutingConfig`**

Create `tests/routing-config.test.ts`:

```typescript
import { describe, expect, it, vi, afterEach } from 'vitest';
import * as fs from 'fs/promises';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadRoutingConfig', () => {
  it('returns null when routing.json does not exist', async () => {
    vi.spyOn(fs, 'readFile').mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );

    const { loadRoutingConfig } = await import('../src/config/routingConfig.js');
    const result = await loadRoutingConfig();
    expect(result).toBeNull();
  });

  it('returns validated config when routing.json is valid', async () => {
    const valid = JSON.stringify({
      default: { url: 'https://example.com/webhook' },
      pages: []
    });
    vi.spyOn(fs, 'readFile').mockResolvedValue(valid as never);

    const { loadRoutingConfig } = await import('../src/config/routingConfig.js');
    const result = await loadRoutingConfig();
    expect(result).toMatchObject({ default: { url: 'https://example.com/webhook' }, pages: [] });
  });

  it('throws when routing.json exists but fails Zod validation', async () => {
    const invalid = JSON.stringify({ pages: [{ pageId: 123 }] }); // pageId must be string
    vi.spyOn(fs, 'readFile').mockResolvedValue(invalid as never);

    const { loadRoutingConfig } = await import('../src/config/routingConfig.js');
    await expect(loadRoutingConfig()).rejects.toThrow();
  });

  it('throws when routing.json exists but contains invalid JSON', async () => {
    vi.spyOn(fs, 'readFile').mockResolvedValue('not valid json' as never);

    const { loadRoutingConfig } = await import('../src/config/routingConfig.js');
    await expect(loadRoutingConfig()).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run tests — verify they FAIL**

```bash
npx vitest run tests/routing-config.test.ts 2>&1 | tail -10
```

Expected: FAIL — `routingConfig.js` does not exist.

- [ ] **Step 5: Create `src/config/routingConfig.ts`**

> Note: path is resolved relative to the module file using `import.meta.url` to be deterministic regardless of `process.cwd()`.

```typescript
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { z } from 'zod';

const promotableFieldSchema = z.enum([
  'phone', 'email', 'fullName', 'firstName', 'lastName',
  'city', 'state', 'productInterest', 'budgetRange', 'purchaseTimeline',
  'campaignName', 'adsetName', 'adName'
]);

const fieldMapSchema = z.record(z.string(), promotableFieldSchema);

const formEntrySchema = z.object({
  formId: z.string().min(1),
  url: z.string().url(),
  fieldMap: fieldMapSchema.optional().default({})
});

const pageEntrySchema = z.object({
  pageId: z.string().min(1),
  url: z.string().url(),
  forms: z.array(formEntrySchema).optional().default([])
});

const routingConfigSchema = z.object({
  default: z.object({ url: z.string().url() }).optional(),
  pages: z.array(pageEntrySchema).optional().default([])
});

export type RoutingConfig = z.infer<typeof routingConfigSchema>;
export type PromotableField = z.infer<typeof promotableFieldSchema>;

const configPath = join(dirname(fileURLToPath(import.meta.url)), '../../config/routing.json');

export const loadRoutingConfig = async (): Promise<RoutingConfig | null> => {
  try {
    const raw = await readFile(configPath, 'utf-8');
    return routingConfigSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
};
```

- [ ] **Step 6: Run tests — verify they PASS**

```bash
npx vitest run tests/routing-config.test.ts 2>&1 | tail -10
```

Expected: 4 tests passing.

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add config/routing.example.json .gitignore src/config/routingConfig.ts tests/routing-config.test.ts
git commit -m "feat: add routing config Zod schema and loader with unit tests"
```

---

## Task 3: `resolveRoute` Pure Function (TDD)

**Files:**
- Create: `tests/routing.test.ts`
- Create: `src/routing/resolveRoute.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/routing.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { resolveRoute } from '../src/routing/resolveRoute.js';
import type { RoutingConfig } from '../src/config/routingConfig.js';

const ENV_URL = 'https://env.example.com/webhook';

const config: RoutingConfig = {
  default: { url: 'https://default.example.com/webhook' },
  pages: [
    {
      pageId: 'page-1',
      url: 'https://page1.example.com/webhook',
      forms: [
        {
          formId: 'form-1',
          url: 'https://form1.example.com/webhook',
          fieldMap: { 'mobile phone': 'phone' }
        }
      ]
    }
  ]
};

describe('resolveRoute', () => {
  it('matches by formId and returns form URL and fieldMap', () => {
    const result = resolveRoute('form-1', 'page-1', config, ENV_URL);
    expect(result.url).toBe('https://form1.example.com/webhook');
    expect(result.fieldMap).toEqual({ 'mobile phone': 'phone' });
    expect(result.source).toBe('form');
  });

  it('falls back to page URL when formId has no config', () => {
    const result = resolveRoute('unknown-form', 'page-1', config, ENV_URL);
    expect(result.url).toBe('https://page1.example.com/webhook');
    expect(result.fieldMap).toEqual({});
    expect(result.source).toBe('page');
  });

  it('falls back to default URL when pageId has no config', () => {
    const result = resolveRoute('unknown-form', 'unknown-page', config, ENV_URL);
    expect(result.url).toBe('https://default.example.com/webhook');
    expect(result.fieldMap).toEqual({});
    expect(result.source).toBe('default');
  });

  it('falls back to env URL when no default is configured', () => {
    const noDefault: RoutingConfig = { pages: [] };
    const result = resolveRoute('unknown-form', 'unknown-page', noDefault, ENV_URL);
    expect(result.url).toBe(ENV_URL);
    expect(result.fieldMap).toEqual({});
    expect(result.source).toBe('env');
  });

  it('falls back to env URL when config is null', () => {
    const result = resolveRoute('form-1', 'page-1', null, ENV_URL);
    expect(result.url).toBe(ENV_URL);
    expect(result.source).toBe('env');
  });

  it('handles undefined formId and pageId gracefully', () => {
    const result = resolveRoute(undefined, undefined, config, ENV_URL);
    expect(result.url).toBe('https://default.example.com/webhook');
    expect(result.source).toBe('default');
  });
});
```

- [ ] **Step 2: Run tests — verify they FAIL**

```bash
npx vitest run tests/routing.test.ts 2>&1 | tail -10
```

Expected: FAIL — `resolveRoute` module not found.

- [ ] **Step 3: Create `src/routing/resolveRoute.ts`**

```typescript
import type { RoutingConfig, PromotableField } from '../config/routingConfig.js';

export type RouteMatch = {
  url: string;
  fieldMap: Record<string, PromotableField>;
  source: 'form' | 'page' | 'default' | 'env';
};

export const resolveRoute = (
  formId: string | undefined,
  pageId: string | undefined,
  config: RoutingConfig | null,
  envFallbackUrl: string
): RouteMatch => {
  if (config) {
    for (const page of config.pages ?? []) {
      for (const form of page.forms ?? []) {
        if (form.formId === formId) {
          return { url: form.url, fieldMap: form.fieldMap ?? {}, source: 'form' };
        }
      }
    }

    for (const page of config.pages ?? []) {
      if (page.pageId === pageId) {
        return { url: page.url, fieldMap: {}, source: 'page' };
      }
    }

    if (config.default) {
      return { url: config.default.url, fieldMap: {}, source: 'default' };
    }
  }

  return { url: envFallbackUrl, fieldMap: {}, source: 'env' };
};
```

- [ ] **Step 4: Run tests — verify they PASS**

```bash
npx vitest run tests/routing.test.ts 2>&1 | tail -10
```

Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/routing/resolveRoute.ts tests/routing.test.ts
git commit -m "feat: add resolveRoute pure function with form/page/default/env cascade"
```

---

## Task 4: `applyFieldMap` Pure Function (TDD)

**Files:**
- Modify: `tests/routing.test.ts` (append second describe block)
- Create: `src/routing/applyFieldMap.ts`

- [ ] **Step 1: Append failing tests to `tests/routing.test.ts`**

Add these imports at the top of `tests/routing.test.ts` (after existing imports):

```typescript
import { applyFieldMap } from '../src/routing/applyFieldMap.js';
import type { NormalizedLead } from '../src/types/domain.js';
```

Then append the following describe block at the bottom of the file:

```typescript
describe('applyFieldMap', () => {
  const baseLead: NormalizedLead = {
    source: 'facebook_lead_ads',
    rawCustomFields: {
      'mobile phone': '11999999999',
      'budget range': '50k-100k',
      'some other field': 'value'
    }
  };

  it('promotes rawCustomFields entries to typed lead fields', () => {
    const result = applyFieldMap(baseLead, {
      'mobile phone': 'phone',
      'budget range': 'budgetRange'
    });
    expect(result.phone).toBe('11999999999');
    expect(result.budgetRange).toBe('50k-100k');
  });

  it('removes promoted keys from rawCustomFields', () => {
    const result = applyFieldMap(baseLead, { 'mobile phone': 'phone' });
    expect(result.rawCustomFields).not.toHaveProperty('mobile phone');
    expect(result.rawCustomFields).toHaveProperty('some other field');
  });

  it('does not mutate the original lead', () => {
    applyFieldMap(baseLead, { 'mobile phone': 'phone' });
    expect(baseLead.phone).toBeUndefined();
    expect(baseLead.rawCustomFields).toHaveProperty('mobile phone');
  });

  it('does not overwrite a field already set by the Meta payload', () => {
    const leadWithPhone: NormalizedLead = { ...baseLead, phone: '+5511888888888' };
    const result = applyFieldMap(leadWithPhone, { 'mobile phone': 'phone' });
    expect(result.phone).toBe('+5511888888888');
  });

  it('skips rawCustomFields values that are not strings', () => {
    const leadWithNonString: NormalizedLead = {
      source: 'facebook_lead_ads',
      rawCustomFields: { score: 42, tags: ['a', 'b'] }
    };
    const result = applyFieldMap(leadWithNonString as never, {
      score: 'productInterest' as never,
      tags: 'budgetRange' as never
    });
    expect(result.productInterest).toBeUndefined();
    expect(result.budgetRange).toBeUndefined();
  });

  it('returns original lead unchanged when fieldMap is empty', () => {
    const result = applyFieldMap(baseLead, {});
    expect(result).toEqual(baseLead);
  });

  it('silently skips fieldMap keys absent from rawCustomFields', () => {
    const result = applyFieldMap(baseLead, { 'nonexistent key': 'phone' });
    expect(result.phone).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — verify new tests FAIL**

```bash
npx vitest run tests/routing.test.ts 2>&1 | tail -10
```

Expected: `resolveRoute` tests still pass; `applyFieldMap` tests fail (module not found).

- [ ] **Step 3: Create `src/routing/applyFieldMap.ts`**

```typescript
import type { NormalizedLead } from '../types/domain.js';
import type { PromotableField } from '../config/routingConfig.js';

export const applyFieldMap = (
  lead: NormalizedLead,
  fieldMap: Record<string, PromotableField>
): NormalizedLead => {
  if (Object.keys(fieldMap).length === 0) return lead;

  const customFields = { ...(lead.rawCustomFields ?? {}) };
  const overrides: Partial<NormalizedLead> = {};

  for (const [sourceKey, targetField] of Object.entries(fieldMap)) {
    const value = customFields[sourceKey];
    if (typeof value !== 'string') continue;
    if (lead[targetField] !== undefined) continue;

    overrides[targetField] = value as never;
    delete customFields[sourceKey];
  }

  return { ...lead, ...overrides, rawCustomFields: customFields };
};
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
npx vitest run tests/routing.test.ts 2>&1 | tail -10
```

Expected: 13 tests passing (6 resolveRoute + 7 applyFieldMap).

- [ ] **Step 5: Verify TypeScript + full suite**

```bash
npm test && npx tsc --noEmit
```

Expected: all tests pass, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/routing/applyFieldMap.ts tests/routing.test.ts
git commit -m "feat: add applyFieldMap pure function for rawCustomFields promotion"
```

---

## Task 5: Update `postToN8n` and `N8nDeliveryService` Signatures

**Files:**
- Modify: `tests/delivery-retry.test.ts`
- Modify: `src/integrations/n8n/client.ts`
- Modify: `src/services/n8nDeliveryService.ts`

Update the test spy first so the expected contract is clear before the implementation changes.

- [ ] **Step 1: Update `tests/delivery-retry.test.ts`**

Open `tests/delivery-retry.test.ts`. Find the two `service.deliver(...)` calls and add a third argument (any URL string):

```typescript
// Change:
await service.deliver('lead-id', { ... });
// To:
await service.deliver('lead-id', { ... }, 'https://n8n.example.com/webhook');
```

Also add an assertion that the URL is forwarded to `postToN8n`:

```typescript
expect(postSpy).toHaveBeenCalledTimes(2);
expect(postSpy).toHaveBeenCalledWith(expect.anything(), 'https://n8n.example.com/webhook');
```

- [ ] **Step 2: Run the test — verify it FAILS (wrong arg count)**

```bash
npx vitest run tests/delivery-retry.test.ts 2>&1 | tail -10
```

Expected: FAIL — `deliver` does not yet accept a third argument.

- [ ] **Step 3: Update `src/integrations/n8n/client.ts`**

```typescript
import { env } from '../../config/env.js';
import type { N8nLeadPayload } from '../../types/domain.js';

export type N8nResponse = {
  ok: boolean;
  status: number;
  body: string;
};

export const postToN8n = async (payload: N8nLeadPayload, url: string): Promise<N8nResponse> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-auth-token': env.N8N_INTERNAL_AUTH_TOKEN
    },
    body: JSON.stringify(payload)
  });

  const body = await response.text();
  return { ok: response.ok, status: response.status, body };
};
```

- [ ] **Step 4: Update `src/services/n8nDeliveryService.ts`**

```typescript
import { env } from '../config/env.js';
import { postToN8n } from '../integrations/n8n/client.js';
import { deliveryAttemptRepository } from '../repositories/deliveryAttemptRepository.js';
import { leadRepository } from '../repositories/leadRepository.js';
import { logger } from '../utils/logger.js';
import type { N8nLeadPayload } from '../types/domain.js';

const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class N8nDeliveryService {
  async deliver(leadId: string, payload: N8nLeadPayload, url: string): Promise<void> {
    for (let attempt = 1; attempt <= env.RETRY_MAX_ATTEMPTS; attempt += 1) {
      await leadRepository.incrementAttempts(leadId);

      try {
        const response = await postToN8n(payload, url);
        await deliveryAttemptRepository.create({
          leadId,
          targetSystem: 'n8n',
          attemptNumber: attempt,
          requestPayload: payload,
          responseStatus: response.status,
          responseBody: response.body,
          success: response.ok
        });

        if (response.ok) {
          await leadRepository.markForwardStatus(leadId, 'success');
          return;
        }

        throw new Error(`n8n returned ${response.status}`);
      } catch (error) {
        await deliveryAttemptRepository.create({
          leadId,
          targetSystem: 'n8n',
          attemptNumber: attempt,
          requestPayload: payload,
          errorMessage: error instanceof Error ? error.message : String(error),
          success: false
        });

        if (attempt >= env.RETRY_MAX_ATTEMPTS) {
          await leadRepository.markForwardStatus(leadId, 'failed');
          logger.error({ leadId, err: error }, 'delivery failed permanently');
          return;
        }

        const backoff = env.RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        logger.warn({ leadId, attempt, backoff }, 'delivery retry scheduled');
        await sleep(backoff);
      }
    }
  }
}
```

- [ ] **Step 5: Run updated test — verify it PASSES**

```bash
npx vitest run tests/delivery-retry.test.ts 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 6: Run full suite**

```bash
npm test 2>&1 | tail -8
```

Expected: all tests pass. (TypeScript errors in callers like `adminController.ts` and `retryWorker.ts` are expected at this point — fixed in Tasks 7 and 8.)

- [ ] **Step 7: Commit**

```bash
git add src/integrations/n8n/client.ts src/services/n8nDeliveryService.ts tests/delivery-retry.test.ts
git commit -m "feat: add url parameter to postToN8n and N8nDeliveryService.deliver"
```

---

## Task 6: Update `leadRepository.create`

**Files:**
- Modify: `src/repositories/leadRepository.ts`
- Modify: `tests/ingestion-dedupe.test.ts`

`n8nTargetUrl` is added as an **optional** parameter (default `null`) so that no existing callers break at the TypeScript level. Task 8 will update `leadIngestionService.ts` to pass the real URL.

- [ ] **Step 1: Update `src/repositories/leadRepository.ts`**

Change the `create` function signature and INSERT statement:

```typescript
async create(lead: NormalizedLead, leadHash: string, n8nTargetUrl: string | null = null) {
  const query = `
    INSERT INTO leads (
      external_lead_id,full_name,first_name,last_name,email,phone,city,state,campaign_id,campaign_name,
      adset_id,adset_name,ad_id,ad_name,form_id,page_id,created_time_from_provider,normalized_payload,
      lead_hash,source,n8n_delivery_status,n8n_target_url,created_at,updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18::jsonb,
      $19,$20,'pending',$21,now(),now()
    ) RETURNING id
  `;

  const values = [
    lead.externalLeadId ?? null,
    lead.fullName ?? null,
    lead.firstName ?? null,
    lead.lastName ?? null,
    lead.email ?? null,
    lead.phone ?? null,
    lead.city ?? null,
    lead.state ?? null,
    lead.campaignId ?? null,
    lead.campaignName ?? null,
    lead.adsetId ?? null,
    lead.adsetName ?? null,
    lead.adId ?? null,
    lead.adName ?? null,
    lead.formId ?? null,
    lead.pageId ?? null,
    lead.createdTime ?? null,
    JSON.stringify(lead),
    leadHash,
    lead.source,
    n8nTargetUrl
  ];

  const result = await pool.query<{ id: string }>(query, values);
  return result.rows[0].id;
},
```

- [ ] **Step 2: Update `tests/ingestion-dedupe.test.ts`**

The test spies on `leadRepository.create` to assert it was NOT called (duplicate path). The spy needs to return a value for the new signature. Update the spy setup inside `beforeEach` or the test body:

```typescript
// Ensure the spy is set up with a return value compatible with the new signature
const createSpy = vi.spyOn(leadRepository, 'create').mockResolvedValue('new-id');
```

If `create` is already spied without a mock return, add `.mockResolvedValue('new-id')`.

- [ ] **Step 3: Run full suite + TypeScript**

```bash
npm test && npx tsc --noEmit
```

Expected: all tests pass, no TypeScript errors. (The optional default means existing callers compile cleanly.)

- [ ] **Step 4: Commit**

```bash
git add src/repositories/leadRepository.ts tests/ingestion-dedupe.test.ts
git commit -m "feat: persist n8n_target_url in leadRepository.create (optional, defaults null)"
```

---

## Task 7: Update `retryRepository` and `retryWorker` (TDD)

**Files:**
- Create: `tests/retry-worker.test.ts`
- Modify: `src/repositories/retryRepository.ts`
- Modify: `src/workers/retryWorker.ts`

The retry worker tests live in their own file to avoid `vi.mock` hoisting conflicts with the pure unit tests in `tests/routing.test.ts`.

- [ ] **Step 1: Write failing tests**

Create `tests/retry-worker.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as retryRepo from '../src/repositories/retryRepository.js';
import * as n8nClient from '../src/integrations/n8n/client.js';
import { N8nDeliveryService } from '../src/services/n8nDeliveryService.js';
import { leadRepository } from '../src/repositories/leadRepository.js';
import { deliveryAttemptRepository } from '../src/repositories/deliveryAttemptRepository.js';

vi.mock('../src/config/env.js', () => ({
  env: {
    RETRY_MAX_ATTEMPTS: 1,
    RETRY_BASE_DELAY_MS: 1,
    RETRY_POLL_INTERVAL_MS: 999999,
    N8N_WEBHOOK_URL: 'https://env-fallback.example.com/webhook',
    N8N_INTERNAL_AUTH_TOKEN: 'test-token'
  }
}));

describe('retry worker URL routing', () => {
  beforeEach(() => {
    vi.spyOn(leadRepository, 'incrementAttempts').mockResolvedValue();
    vi.spyOn(leadRepository, 'markForwardStatus').mockResolvedValue();
    vi.spyOn(deliveryAttemptRepository, 'create').mockResolvedValue();
  });

  it('delivers to n8n_target_url from the leads row, not the env fallback', async () => {
    const perFormUrl = 'https://form-specific.example.com/webhook';

    vi.spyOn(retryRepo.retryRepository, 'listFailedLeads').mockResolvedValue([
      { id: 'lead-1', normalized_payload: { source: 'facebook_lead_ads' }, n8n_target_url: perFormUrl }
    ]);

    const postSpy = vi.spyOn(n8nClient, 'postToN8n').mockResolvedValue({
      ok: true, status: 200, body: 'ok'
    });

    const service = new N8nDeliveryService();
    const rows = await retryRepo.retryRepository.listFailedLeads();
    for (const row of rows) {
      const targetUrl = row.n8n_target_url ?? 'https://env-fallback.example.com/webhook';
      await service.deliver(row.id, {
        correlationId: `retry-${row.id}`,
        ingestedAt: new Date().toISOString(),
        lead: row.normalized_payload as never,
        meta: { isDuplicate: false, rawEventStored: true, version: '1.0.0' }
      }, targetUrl);
    }

    expect(postSpy).toHaveBeenCalledWith(expect.anything(), perFormUrl);
  });

  it('falls back to env URL when n8n_target_url is null (pre-migration lead)', async () => {
    vi.spyOn(retryRepo.retryRepository, 'listFailedLeads').mockResolvedValue([
      { id: 'lead-2', normalized_payload: { source: 'facebook_lead_ads' }, n8n_target_url: null }
    ]);

    const postSpy = vi.spyOn(n8nClient, 'postToN8n').mockResolvedValue({
      ok: true, status: 200, body: 'ok'
    });

    const service = new N8nDeliveryService();
    const rows = await retryRepo.retryRepository.listFailedLeads();
    for (const row of rows) {
      const targetUrl = row.n8n_target_url ?? 'https://env-fallback.example.com/webhook';
      await service.deliver(row.id, {
        correlationId: `retry-${row.id}`,
        ingestedAt: new Date().toISOString(),
        lead: row.normalized_payload as never,
        meta: { isDuplicate: false, rawEventStored: true, version: '1.0.0' }
      }, targetUrl);
    }

    expect(postSpy).toHaveBeenCalledWith(
      expect.anything(),
      'https://env-fallback.example.com/webhook'
    );
  });
});
```

- [ ] **Step 2: Run tests — verify they FAIL**

```bash
npx vitest run tests/retry-worker.test.ts 2>&1 | tail -10
```

Expected: FAIL — `listFailedLeads` mock type does not include `n8n_target_url` (TypeScript) or the spy shape mismatch causes a runtime error.

- [ ] **Step 3: Update `src/repositories/retryRepository.ts`**

```typescript
import { pool } from '../db/client.js';

export const retryRepository = {
  async listFailedLeads(limit = 20) {
    const result = await pool.query<{
      id: string;
      normalized_payload: unknown;
      n8n_target_url: string | null;
    }>(
      `SELECT id, normalized_payload, n8n_target_url
       FROM leads
       WHERE n8n_delivery_status = 'failed'
       ORDER BY updated_at ASC
       LIMIT $1`,
      [limit]
    );

    return result.rows;
  }
};
```

- [ ] **Step 4: Update `src/workers/retryWorker.ts`**

```typescript
import { env } from '../config/env.js';
import { retryRepository } from '../repositories/retryRepository.js';
import { N8nDeliveryService } from '../services/n8nDeliveryService.js';
import type { N8nLeadPayload, NormalizedLead } from '../types/domain.js';
import { logger } from '../utils/logger.js';

export const startRetryWorker = () => {
  const service = new N8nDeliveryService();

  setInterval(async () => {
    const failedLeads = await retryRepository.listFailedLeads();
    for (const row of failedLeads) {
      const lead = row.normalized_payload as NormalizedLead;
      const targetUrl = row.n8n_target_url ?? env.N8N_WEBHOOK_URL;
      const payload: N8nLeadPayload = {
        correlationId: `retry-${row.id}`,
        ingestedAt: new Date().toISOString(),
        lead,
        meta: { isDuplicate: false, rawEventStored: true, version: '1.0.0' }
      };
      await service.deliver(row.id, payload, targetUrl);
    }
  }, env.RETRY_POLL_INTERVAL_MS).unref();

  logger.info('retry worker started');
};
```

- [ ] **Step 5: Run tests — verify they PASS**

```bash
npx vitest run tests/retry-worker.test.ts 2>&1 | tail -10
```

Expected: 2 tests passing.

- [ ] **Step 6: Run full suite + TypeScript**

```bash
npm test && npx tsc --noEmit
```

Expected: all tests pass, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/repositories/retryRepository.ts src/workers/retryWorker.ts tests/retry-worker.test.ts
git commit -m "feat: retry worker reads n8n_target_url per lead for correct URL routing"
```

---

## Task 8: Wire `LeadIngestionService`, `createApp`, and Controller

**Files:**
- Modify: `src/services/leadIngestionService.ts`
- Modify: `src/app/createApp.ts`
- Modify: `src/controllers/metaWebhookController.ts`

This task connects all pieces. No new tests needed here — the integration test in Task 9 covers the end-to-end path.

- [ ] **Step 1: Update `src/services/leadIngestionService.ts`**

```typescript
import { metaWebhookSchema, type MetaWebhookPayload } from '../schemas/metaWebhook.js';
import { normalizeMetaPayload } from '../integrations/meta/normalizer.js';
import { webhookEventRepository } from '../repositories/webhookEventRepository.js';
import { leadRepository } from '../repositories/leadRepository.js';
import { buildLeadHash } from '../utils/hash.js';
import type { N8nLeadPayload } from '../types/domain.js';
import { N8nDeliveryService } from './n8nDeliveryService.js';
import { logger } from '../utils/logger.js';
import { resolveRoute } from '../routing/resolveRoute.js';
import { applyFieldMap } from '../routing/applyFieldMap.js';
import { env } from '../config/env.js';
import type { RoutingConfig } from '../config/routingConfig.js';

export type LeadIngestionResult =
  | { accepted: true }
  | { accepted: false; reason: 'validation_error' };

export class LeadIngestionService {
  constructor(
    private readonly deliveryService = new N8nDeliveryService(),
    private readonly routingConfig: RoutingConfig | null = null
  ) {}

  async ingest(input: {
    correlationId: string;
    payload: unknown;
    headers: Record<string, unknown>;
  }): Promise<LeadIngestionResult> {
    const parsed = metaWebhookSchema.safeParse(input.payload);
    if (!parsed.success) {
      await webhookEventRepository.create({
        provider: 'meta',
        eventType: 'leadgen',
        rawPayload: input.payload,
        headers: input.headers,
        processingStatus: 'failed',
        processingError: parsed.error.message,
        correlationId: input.correlationId
      });
      return { accepted: false, reason: 'validation_error' };
    }

    return this.processValidatedPayload(parsed.data, input);
  }

  private async processValidatedPayload(
    payload: MetaWebhookPayload,
    input: { correlationId: string; payload: unknown; headers: Record<string, unknown> }
  ): Promise<LeadIngestionResult> {
    const normalizedLeads = normalizeMetaPayload(payload);

    for (const lead of normalizedLeads) {
      // 1. Resolve route
      const route = resolveRoute(lead.formId, lead.pageId, this.routingConfig, env.N8N_WEBHOOK_URL);

      // 2. Apply field map BEFORE hash and persistence
      const mappedLead = applyFieldMap(lead, route.fieldMap);

      // 3. Hash computed on mapped lead (promotion may affect phone/email used for dedup)
      const leadHash = buildLeadHash(mappedLead);

      const eventId = await webhookEventRepository.create({
        provider: 'meta',
        eventType: 'leadgen',
        sourcePageId: mappedLead.pageId,
        sourceFormId: mappedLead.formId,
        externalEventId: mappedLead.externalLeadId,
        rawPayload: input.payload,
        headers: input.headers,
        processingStatus: 'persisted',
        correlationId: input.correlationId
      });

      const existing = await leadRepository.findByHash(leadHash);
      if (existing) {
        await webhookEventRepository.updateStatus(eventId, 'duplicate');
        logger.info({ correlationId: input.correlationId, leadHash }, 'duplicate lead ignored');
        continue;
      }

      // 4. Persist mapped lead with resolved URL
      const leadId = await leadRepository.create(mappedLead, leadHash, route.url);

      logger.info(
        { correlationId: input.correlationId, formId: lead.formId, routeSource: route.source },
        'lead routed'
      );

      // 5. Build n8n payload from mapped lead
      const n8nPayload: N8nLeadPayload = {
        correlationId: input.correlationId,
        ingestedAt: new Date().toISOString(),
        lead: mappedLead,
        meta: { isDuplicate: false, rawEventStored: true, version: '1.0.0' }
      };

      setImmediate(async () => {
        await this.deliveryService.deliver(leadId, n8nPayload, route.url);
        await webhookEventRepository.updateStatus(eventId, 'forwarded');
      });
    }

    return { accepted: true };
  }
}
```

- [ ] **Step 2: Update `src/app/createApp.ts`**

Add imports alongside the existing route imports:

```typescript
import { loadRoutingConfig } from '../config/routingConfig.js';
import { LeadIngestionService } from '../services/leadIngestionService.js';
import { N8nDeliveryService } from '../services/n8nDeliveryService.js';
```

Add TypeScript module augmentation at module level (before the `createApp` function):

```typescript
declare module 'fastify' {
  interface FastifyInstance {
    leadIngestionService: LeadIngestionService;
  }
}
```

Inside `createApp`, immediately after `app.setValidatorCompiler` / `app.setSerializerCompiler`:

```typescript
const routingConfig = await loadRoutingConfig();
app.decorate('leadIngestionService', new LeadIngestionService(new N8nDeliveryService(), routingConfig));
```

- [ ] **Step 3: Update `src/controllers/metaWebhookController.ts`**

Remove the module-level singleton and read from the Fastify instance:

```typescript
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { verifyMetaChallenge } from '../integrations/meta/verification.js';
import { correlationIdFromHeader } from '../utils/correlation.js';

export const verifyWebhookChallenge = async (request: FastifyRequest, reply: FastifyReply) => {
  const query = request.query as Record<string, string | undefined>;
  const challenge = verifyMetaChallenge(
    query['hub.mode'],
    query['hub.verify_token'],
    query['hub.challenge'],
    env.META_VERIFY_TOKEN
  );
  if (!challenge) return reply.status(403).send({ error: 'verification failed' });
  return reply.status(200).send(challenge);
};

export const receiveMetaWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
  const correlationId = correlationIdFromHeader(
    request.headers['x-correlation-id'] as string | undefined
  );

  const result = await request.server.leadIngestionService.ingest({
    correlationId,
    payload: request.body,
    headers: request.headers as Record<string, unknown>
  });

  if (!result.accepted) {
    return reply.status(400).send({ status: 'rejected', reason: result.reason, correlationId });
  }

  return reply.status(202).send({ status: 'accepted', correlationId });
};
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run full test suite**

```bash
npm test 2>&1 | tail -8
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/leadIngestionService.ts src/app/createApp.ts src/controllers/metaWebhookController.ts
git commit -m "feat: wire routing config into LeadIngestionService via app.decorate"
```

---

## Task 9: Integration Test — End-to-End Routing

**Files:**
- Create: `tests/ingestion-routing.test.ts`

The integration test lives in its own file to avoid import hoisting issues.

- [ ] **Step 1: Create `tests/ingestion-routing.test.ts`**

```typescript
import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app/createApp.js';
import * as n8nClient from '../src/integrations/n8n/client.js';
import { webhookEventRepository } from '../src/repositories/webhookEventRepository.js';
import { leadRepository } from '../src/repositories/leadRepository.js';
import { deliveryAttemptRepository } from '../src/repositories/deliveryAttemptRepository.js';
import { LeadIngestionService } from '../src/services/leadIngestionService.js';
import { N8nDeliveryService } from '../src/services/n8nDeliveryService.js';
import type { RoutingConfig } from '../src/config/routingConfig.js';

const APP_SECRET = 'test-app-secret';
const FORM_URL = 'https://form-specific.example.com/webhook';

function makeSignature(body: string) {
  return 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
}

const routingConfig: RoutingConfig = {
  pages: [{
    pageId: 'page-1',
    url: 'https://page.example.com/webhook',
    forms: [{ formId: 'form-1', url: FORM_URL, fieldMap: {} }]
  }]
};

describe('ingestion route with routing config', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    app = await createApp({ enableDocs: false });

    // Override the decorated service with one that has routing config
    (app as never as { leadIngestionService: LeadIngestionService }).leadIngestionService =
      new LeadIngestionService(new N8nDeliveryService(), routingConfig);

    await app.ready();

    vi.spyOn(webhookEventRepository, 'create').mockResolvedValue('event-id');
    vi.spyOn(webhookEventRepository, 'updateStatus').mockResolvedValue();
    vi.spyOn(leadRepository, 'findByHash').mockResolvedValue(null);
    vi.spyOn(leadRepository, 'create').mockResolvedValue('lead-id');
    vi.spyOn(leadRepository, 'incrementAttempts').mockResolvedValue();
    vi.spyOn(leadRepository, 'markForwardStatus').mockResolvedValue();
    vi.spyOn(deliveryAttemptRepository, 'create').mockResolvedValue();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('delivers to form-specific URL when formId matches routing config', async () => {
    const postSpy = vi.spyOn(n8nClient, 'postToN8n').mockResolvedValue({
      ok: true, status: 200, body: 'ok'
    });

    const body = JSON.stringify({
      object: 'page',
      entry: [{
        id: 'page-1',
        changes: [{ field: 'leadgen', value: { form_id: 'form-1', leadgen_id: 'ext-1' } }]
      }]
    });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meta/lead-ads',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': makeSignature(body)
      },
      body
    });

    expect(res.statusCode).toBe(202);

    // deliver() is fire-and-forget — wait one tick
    await new Promise((resolve) => setImmediate(resolve));
    expect(postSpy).toHaveBeenCalledWith(expect.anything(), FORM_URL);
  });

  it('persists the resolved URL to leadRepository.create', async () => {
    vi.spyOn(n8nClient, 'postToN8n').mockResolvedValue({ ok: true, status: 200, body: 'ok' });
    const createSpy = vi.spyOn(leadRepository, 'create').mockResolvedValue('lead-id');

    const body = JSON.stringify({
      object: 'page',
      entry: [{
        id: 'page-1',
        changes: [{ field: 'leadgen', value: { form_id: 'form-1', leadgen_id: 'ext-2' } }]
      }]
    });

    await app.inject({
      method: 'POST',
      url: '/webhooks/meta/lead-ads',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': makeSignature(body)
      },
      body
    });

    expect(createSpy).toHaveBeenCalledWith(expect.anything(), expect.any(String), FORM_URL);
  });
});
```

- [ ] **Step 2: Run the integration tests**

```bash
npx vitest run tests/ingestion-routing.test.ts 2>&1 | tail -15
```

Expected: 2 tests passing.

- [ ] **Step 3: Run full suite + TypeScript**

```bash
npm test && npx tsc --noEmit
```

Expected: all tests pass, no errors.

- [ ] **Step 4: Commit**

```bash
git add tests/ingestion-routing.test.ts
git commit -m "test: add end-to-end routing integration tests"
```

---

## Task 10: Update Delivery Log and README

**Files:**
- Modify: `docs/ai-agent-roadmap.md`
- Modify: `README.md`

- [ ] **Step 1: Add row at top of delivery table in `docs/ai-agent-roadmap.md`**

```markdown
| 2026-03-21 | Claude Code | Multi-tenant routing + per-form field mapping. `routing.json` with form→page→default→env cascade. `resolveRoute` and `applyFieldMap` pure functions. `leads.n8n_target_url` persisted for retry correctness. `app.decorate` wiring. All tests passing. | `docs/superpowers/specs/2026-03-21-multi-tenant-routing-design.md` | Integration test container stack |
```

- [ ] **Step 2: Update Backlog**

Remove the multi-tenant routing entry and update the top priority:

```markdown
| 🔴 High | Integration test container stack | Run `app + postgres + mocked n8n` in CI. Prevent mock/prod divergence. |
```

- [ ] **Step 3: Update README Roadmap table**

Change:
```markdown
| 🔜 Planned | Multi-tenant page/client routing + per-form field mapping |
```
To:
```markdown
| ✅ Done | Multi-tenant routing + per-form field mapping (`config/routing.json`, form→page→default cascade) |
```

- [ ] **Step 4: Commit**

```bash
git add docs/ai-agent-roadmap.md README.md
git commit -m "docs: update delivery log and README for multi-tenant routing"
```

---

## Final Verification

- [ ] `npm test && npx tsc --noEmit` — all tests pass, no TypeScript errors
- [ ] `git log --oneline -12` — confirm clean, atomic commit history
- [ ] `git push` — push branch and update PR
