# Instagram SDR Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar suporte a leads do Instagram como segunda fonte no backend, via endpoint `POST /webhooks/v1/leads`, mantendo deduplicação, persistência e entrega ao n8n.

**Architecture:** O instagram-sdr envia um payload versionado via `POST /webhooks/v1/leads` autenticado com `X-Api-Key`. O backend valida, persiste o raw event em `webhook_events`, normaliza via mapper (registry por `source:version`), deduplica por `lead_hash = external:@handle`, persiste em `leads` com `source_id`, e enfileira para n8n. Padrões existentes (TDD, `app.inject()`, repositório, correlationId) são mantidos integralmente.

**Tech Stack:** Fastify v4, TypeScript ESM, Zod v3, pg (raw SQL), Vitest, pino, `node:crypto`

**Spec:** `docs/superpowers/specs/2026-03-22-instagram-sdr-integration-design.md`

**Decisão de dedup:** O `handle` do Instagram é mapeado para `externalLeadId`, fazendo `buildLeadHash` produzir `external:@handle` — identificador único por usuário, sem precisar incluir phone. Simplifica sem perda de corretude.

---

## File Map

### Novos arquivos (testn8nmetaapi)

| Arquivo | Responsabilidade |
|---|---|
| `src/integrations/instagram/schema.ts` | Zod schema do payload v1 — valida estrutura do contrato |
| `src/integrations/instagram/mappers/v1.ts` | Converte payload instagram → `NormalizedLead` + encapsula validação |
| `src/repositories/leadSourcesRepository.ts` | Acesso à tabela `lead_sources` |
| `src/controllers/unifiedWebhookController.ts` | Orquestra: auth → persist raw → map → dedupe → persist lead → n8n |
| `src/routes/webhooks/unified.ts` | Registra `POST /webhooks/v1/leads` |
| `db/migrations/004_add_lead_sources.sql` | Cria tabela `lead_sources` com seeds |
| `db/migrations/005_add_source_fields_to_leads.sql` | Adiciona colunas instagram + backfill facebook |
| `tests/integrations/instagram/schema.test.ts` | Testes do schema Zod |
| `tests/integrations/instagram/mappers/v1.test.ts` | Testes unitários do mapper |
| `tests/routes/webhooks/unified.test.ts` | Testes HTTP do endpoint unificado |

### Arquivos existentes modificados (testn8nmetaapi)

| Arquivo | O que muda |
|---|---|
| `src/types/domain.ts:41` | `source: 'facebook_lead_ads'` → `'facebook_lead_ads' \| 'instagram'` |
| `src/config/env.ts` | Adicionar `BACKEND_API_KEY` com default de test |
| `src/repositories/leadRepository.ts` | Adicionar parâmetro opcional `sourceId` em `create()` |
| `src/app/createApp.ts` | Registrar `registerUnifiedWebhookRoutes` |

### Novo arquivo (instagram-sdr)

| Arquivo | Responsabilidade |
|---|---|
| `prompt-tester/src/webhook/leadSender.ts` | Envia lead qualificado para o backend via POST |

---

## Task 1: Ampliar `NormalizedLead.source` em `domain.ts`

**Files:**
- Modify: `src/types/domain.ts:41`
- Modify: `tests/hash-dedupe.test.ts`

- [ ] **Step 1: Adicionar teste de tipo em `hash-dedupe.test.ts`**

Adicionar ao final do arquivo `tests/hash-dedupe.test.ts`:

```typescript
it('builds hash for instagram lead using handle as external id', () => {
  const hash = buildLeadHash({ externalLeadId: '@joao_silva', source: 'instagram' });
  expect(hash).toBe('external:@joao_silva');
});
```

- [ ] **Step 2: Confirmar erro de tipo antes de implementar**

```bash
npx tsc --noEmit
```

Esperado: erro de tipo — `'instagram'` não é atribuível a `'facebook_lead_ads'`

- [ ] **Step 3: Ampliar o tipo em `domain.ts`**

```typescript
// src/types/domain.ts linha 41 — antes:
source: 'facebook_lead_ads';

// depois:
source: 'facebook_lead_ads' | 'instagram';
```

- [ ] **Step 4: Rodar tests + typecheck**

```bash
npm test && npx tsc --noEmit
```

Esperado: todos os testes passam, sem erros de tipo

- [ ] **Step 5: Commit**

```bash
git add src/types/domain.ts tests/hash-dedupe.test.ts
git commit -m "feat: extend NormalizedLead.source to support instagram"
```

---

## Task 2: Adicionar `BACKEND_API_KEY` em `env.ts`

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Adicionar default de test no bloco `if (process.env.NODE_ENV === 'test')`**

```typescript
process.env.BACKEND_API_KEY ??= 'test-api-key';
```

- [ ] **Step 2: Adicionar ao schema Zod**

```typescript
BACKEND_API_KEY: z.string().min(1),
```

- [ ] **Step 3: Adicionar ao `.env.example`**

```bash
BACKEND_API_KEY=your-shared-secret-here
```

- [ ] **Step 4: Rodar tests + typecheck**

```bash
npm test && npx tsc --noEmit
```

Esperado: todos passam

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts .env.example
git commit -m "feat: add BACKEND_API_KEY to env config"
```

---

## Task 3: Migrations do banco de dados

**Files:**
- Create: `db/migrations/004_add_lead_sources.sql`
- Create: `db/migrations/005_add_source_fields_to_leads.sql`

> **Ordem obrigatória:** migration 004 antes de 005 — FK em `leads.source_id` depende de `lead_sources.id`.

- [ ] **Step 1: Criar migration 004**

```sql
-- db/migrations/004_add_lead_sources.sql

CREATE TABLE IF NOT EXISTS lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) UNIQUE NOT NULL,
  contract_version VARCHAR(10) NOT NULL,
  mapper_version VARCHAR(10) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO lead_sources (name, contract_version, mapper_version) VALUES
  ('facebook', '1.0', '1.0'),
  ('instagram', '1.0', '1.0')
ON CONFLICT (name) DO NOTHING;
```

- [ ] **Step 2: Criar migration 005**

```sql
-- db/migrations/005_add_source_fields_to_leads.sql

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES lead_sources(id),
  ADD COLUMN IF NOT EXISTS handle VARCHAR(255),
  ADD COLUMN IF NOT EXISTS source_raw_data JSONB,
  ADD COLUMN IF NOT EXISTS source_specific_fields JSONB,
  ADD COLUMN IF NOT EXISTS qualification_data JSONB,
  ADD COLUMN IF NOT EXISTS mapper_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS mapper_version VARCHAR(10),
  ADD COLUMN IF NOT EXISTS mapped_at TIMESTAMPTZ;

-- Backfill: leads Facebook existentes apontam para fonte 'facebook'
UPDATE leads
  SET source_id = (SELECT id FROM lead_sources WHERE name = 'facebook')
  WHERE source_id IS NULL;

-- source_id permanece nullable para compatibilidade com leads históricos sem source

CREATE INDEX IF NOT EXISTS leads_source_id_idx ON leads(source_id);
```

- [ ] **Step 3: Rodar as migrations**

```bash
npm run db:migrate
```

Esperado: aplicadas sem erro

- [ ] **Step 4: Commit**

```bash
git add db/migrations/004_add_lead_sources.sql db/migrations/005_add_source_fields_to_leads.sql
git commit -m "feat: add lead_sources table and instagram fields to leads"
```

---

## Task 4: `leadSourcesRepository`

**Files:**
- Create: `src/repositories/leadSourcesRepository.ts`

- [ ] **Step 1: Criar o repositório**

```typescript
// src/repositories/leadSourcesRepository.ts
import { pool } from '../db/client.js';

export type LeadSource = {
  id: string;
  name: string;
  contractVersion: string;
  mapperVersion: string;
};

export const leadSourcesRepository = {
  async findByName(name: string): Promise<LeadSource | null> {
    const result = await pool.query<{
      id: string;
      name: string;
      contract_version: string;
      mapper_version: string;
    }>(
      'SELECT id, name, contract_version, mapper_version FROM lead_sources WHERE name = $1 AND active = TRUE LIMIT 1',
      [name]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      contractVersion: row.contract_version,
      mapperVersion: row.mapper_version
    };
  }
};
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: sem erros

- [ ] **Step 3: Commit**

```bash
git add src/repositories/leadSourcesRepository.ts
git commit -m "feat: add leadSourcesRepository"
```

---

## Task 5: Adicionar `sourceId` opcional em `leadRepository.create`

**Files:**
- Modify: `src/repositories/leadRepository.ts`

> O spec requer que todo lead novo tenha `source_id` preenchido. Precisa passar `sourceId` para o `create`.

- [ ] **Step 1: Modificar a assinatura de `create`**

Alterar a linha 10 de `src/repositories/leadRepository.ts`:

```typescript
// antes:
async create(lead: NormalizedLead, leadHash: string, n8nTargetUrl: string | null = null) {

// depois:
async create(lead: NormalizedLead, leadHash: string, n8nTargetUrl: string | null = null, sourceId: string | null = null) {
```

- [ ] **Step 2: Adicionar `source_id` na query SQL**

Na query INSERT de `leadRepository.create`, adicionar `source_id` à lista de colunas e `$22` na lista de valores. Também adicionar o valor no array:

```typescript
// Adicionar na query (após n8n_target_url):
// colunas: ...,source_id,...
// valores: ...,$22,...

// Adicionar no array values ao final:
sourceId
```

> **Atenção:** A query atual tem 21 parâmetros. Adicione `source_id` como `$22` na lista de colunas e no array `values`.

- [ ] **Step 3: Rodar tests + typecheck**

```bash
npm test && npx tsc --noEmit
```

Esperado: todos passam — `sourceId` é opcional com default `null`, sem quebrar Facebook

- [ ] **Step 4: Commit**

```bash
git add src/repositories/leadRepository.ts
git commit -m "feat: add optional sourceId to leadRepository.create"
```

---

## Task 6: Zod Schema do payload instagram

**Files:**
- Create: `src/integrations/instagram/schema.ts`
- Create: `tests/integrations/instagram/schema.test.ts`

- [ ] **Step 1: Escrever os testes primeiro**

```typescript
// tests/integrations/instagram/schema.test.ts
import { describe, expect, it } from 'vitest';
import { instagramWebhookSchema } from '../../../src/integrations/instagram/schema.js';

const validPayload = {
  source: 'instagram',
  contractVersion: '1.0',
  raw: {
    handle: '@joao_silva',
    firstMessage: 'Quero saber sobre limpeza de pele',
    timestamp: '2026-03-22T10:00:00.000Z'
  },
  qualified: {
    procedimento_interesse: 'Limpeza de pele',
    janela_decisao: 'até 30 dias',
    regiao: 'São Paulo',
    resumo: 'Lead qualificado com interesse em procedimento estético'
  },
  processedAt: '2026-03-22T10:01:00.000Z'
};

describe('instagramWebhookSchema', () => {
  it('accepts a valid payload', () => {
    expect(instagramWebhookSchema.safeParse(validPayload).success).toBe(true);
  });

  it('accepts payload without optional fields (instaId, contato_whatsapp)', () => {
    expect(instagramWebhookSchema.safeParse(validPayload).success).toBe(true);
  });

  it('rejects missing handle', () => {
    const payload = { ...validPayload, raw: { ...validPayload.raw, handle: undefined } };
    expect(instagramWebhookSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects invalid timestamp format', () => {
    const payload = { ...validPayload, raw: { ...validPayload.raw, timestamp: 'not-a-date' } };
    expect(instagramWebhookSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects unknown contractVersion', () => {
    expect(instagramWebhookSchema.safeParse({ ...validPayload, contractVersion: '9.9' }).success).toBe(false);
  });

  it('rejects source other than instagram', () => {
    expect(instagramWebhookSchema.safeParse({ ...validPayload, source: 'facebook' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar testes para confirmar falha**

```bash
npm test -- schema.test
```

Esperado: FAIL — módulo não existe

- [ ] **Step 3: Criar o schema**

```typescript
// src/integrations/instagram/schema.ts
import { z } from 'zod';

export const instagramWebhookSchema = z.object({
  source: z.literal('instagram'),
  contractVersion: z.literal('1.0'),
  raw: z.object({
    handle: z.string().min(1),
    instaId: z.string().optional(),
    firstMessage: z.string().min(1),
    timestamp: z.string().datetime()
  }),
  qualified: z.object({
    procedimento_interesse: z.string().min(1),
    janela_decisao: z.string().min(1),
    regiao: z.string().min(1),
    contato_whatsapp: z.string().optional(),
    resumo: z.string().min(1)
  }),
  processedAt: z.string().datetime()
});

export type InstagramWebhookPayload = z.infer<typeof instagramWebhookSchema>;
```

- [ ] **Step 4: Rodar tests + typecheck**

```bash
npm test && npx tsc --noEmit
```

Esperado: todos passam

- [ ] **Step 5: Commit**

```bash
git add src/integrations/instagram/schema.ts tests/integrations/instagram/schema.test.ts
git commit -m "feat: add instagram webhook Zod schema v1"
```

---

## Task 7: Mapper instagram → NormalizedLead

**Files:**
- Create: `src/integrations/instagram/mappers/v1.ts`
- Create: `tests/integrations/instagram/mappers/v1.test.ts`

> O mapper encapsula **validação + transformação**. Recebe `unknown`, valida com Zod internamente, lança erro se inválido. O controller usa `try/catch` — nunca chama Zod diretamente.

- [ ] **Step 1: Escrever os testes**

```typescript
// tests/integrations/instagram/mappers/v1.test.ts
import { describe, expect, it } from 'vitest';
import { mapInstagramPayloadV1 } from '../../../../src/integrations/instagram/mappers/v1.js';

const basePayload = {
  source: 'instagram',
  contractVersion: '1.0',
  raw: {
    handle: '@joao_silva',
    firstMessage: 'Quero limpeza de pele',
    timestamp: '2026-03-22T10:00:00.000Z'
  },
  qualified: {
    procedimento_interesse: 'Limpeza de pele',
    janela_decisao: 'até 30 dias',
    regiao: 'São Paulo',
    resumo: 'Lead qualificado'
  },
  processedAt: '2026-03-22T10:01:00.000Z'
};

describe('mapInstagramPayloadV1', () => {
  it('maps handle to externalLeadId', () => {
    expect(mapInstagramPayloadV1(basePayload).externalLeadId).toBe('@joao_silva');
  });

  it('maps procedimento_interesse to productInterest', () => {
    expect(mapInstagramPayloadV1(basePayload).productInterest).toBe('Limpeza de pele');
  });

  it('maps janela_decisao to purchaseTimeline', () => {
    expect(mapInstagramPayloadV1(basePayload).purchaseTimeline).toBe('até 30 dias');
  });

  it('maps regiao to city', () => {
    expect(mapInstagramPayloadV1(basePayload).city).toBe('São Paulo');
  });

  it('maps contato_whatsapp to phone when present', () => {
    const payload = { ...basePayload, qualified: { ...basePayload.qualified, contato_whatsapp: '+55119999' } };
    expect(mapInstagramPayloadV1(payload).phone).toBe('+55119999');
  });

  it('leaves phone undefined when contato_whatsapp is absent', () => {
    expect(mapInstagramPayloadV1(basePayload).phone).toBeUndefined();
  });

  it('sets source to instagram', () => {
    expect(mapInstagramPayloadV1(basePayload).source).toBe('instagram');
  });

  it('stores resumo in rawCustomFields', () => {
    expect(mapInstagramPayloadV1(basePayload).rawCustomFields?.resumo).toBe('Lead qualificado');
  });

  it('throws on invalid payload', () => {
    expect(() => mapInstagramPayloadV1({ source: 'instagram' })).toThrow();
  });
});
```

- [ ] **Step 2: Rodar testes para confirmar falha**

```bash
npm test -- mappers/v1
```

Esperado: FAIL — módulo não existe

- [ ] **Step 3: Criar o mapper**

```typescript
// src/integrations/instagram/mappers/v1.ts
import type { NormalizedLead } from '../../../types/domain.js';
import { instagramWebhookSchema } from '../schema.js';

// Aceita unknown — valida internamente com Zod e lança ZodError se inválido.
// O controller usa try/catch para capturar esse erro.
export const mapInstagramPayloadV1 = (raw: unknown): NormalizedLead => {
  const payload = instagramWebhookSchema.parse(raw);

  return {
    source: 'instagram',
    externalLeadId: payload.raw.handle,
    phone: payload.qualified.contato_whatsapp,
    city: payload.qualified.regiao,
    productInterest: payload.qualified.procedimento_interesse,
    purchaseTimeline: payload.qualified.janela_decisao,
    rawCustomFields: {
      resumo: payload.qualified.resumo,
      firstMessage: payload.raw.firstMessage,
      instaId: payload.raw.instaId
    }
  };
};
```

- [ ] **Step 4: Rodar tests + typecheck**

```bash
npm test && npx tsc --noEmit
```

Esperado: todos passam

- [ ] **Step 5: Commit**

```bash
git add src/integrations/instagram/mappers/v1.ts tests/integrations/instagram/mappers/v1.test.ts
git commit -m "feat: add instagram lead mapper v1 with internal Zod validation"
```

---

## Task 8: Controller unificado

**Files:**
- Create: `src/controllers/unifiedWebhookController.ts`

- [ ] **Step 1: Criar o controller**

```typescript
// src/controllers/unifiedWebhookController.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { correlationIdFromHeader } from '../utils/correlation.js';
import { buildLeadHash } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { webhookEventRepository } from '../repositories/webhookEventRepository.js';
import { leadRepository } from '../repositories/leadRepository.js';
import { leadSourcesRepository } from '../repositories/leadSourcesRepository.js';
import { mapInstagramPayloadV1 } from '../integrations/instagram/mappers/v1.js';
import type { NormalizedLead } from '../types/domain.js';

// Mapper registry — cada mapper recebe `unknown`, valida internamente com Zod, lança ZodError se inválido
type Mapper = (raw: unknown) => NormalizedLead;
const mappers: Record<string, Mapper> = {
  'instagram:1.0': mapInstagramPayloadV1
};

const verifyApiKey = (provided: string | undefined): boolean => {
  if (!provided) return false;
  try {
    const expected = Buffer.from(env.BACKEND_API_KEY);
    const actual = Buffer.from(provided);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
};

export const receiveUnifiedWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
  const correlationId = correlationIdFromHeader(request.headers['x-correlation-id'] as string | undefined);
  const log = logger.child({ correlationId });

  // Auth
  if (!verifyApiKey(request.headers['x-api-key'] as string | undefined)) {
    return reply.status(401).send({ status: 'rejected', reason: 'invalid_api_key', correlationId });
  }

  const body = request.body as Record<string, unknown>;
  const source = body?.source as string | undefined;
  const contractVersion = body?.contractVersion as string | undefined;

  // Persist raw event always — "never reject a webhook silently"
  let eventId: string;
  try {
    eventId = await webhookEventRepository.create({
      provider: source ?? 'unknown',
      eventType: 'lead_qualified',
      rawPayload: body,
      headers: request.headers,
      processingStatus: 'received',
      correlationId
    });
  } catch (err) {
    log.error({ err }, 'Failed to persist raw event');
    return reply.status(500).send({ status: 'rejected', reason: 'internal_error', correlationId });
  }

  // Validate contract
  const mapperKey = `${source}:${contractVersion}`;
  const mapper = mappers[mapperKey];
  if (!mapper) {
    await webhookEventRepository.updateStatus(eventId, 'failed', `Unknown contract: ${mapperKey}`);
    log.warn({ mapperKey }, 'Unknown source or contractVersion');
    return reply.status(400).send({ status: 'rejected', reason: `unsupported_contract:${mapperKey}`, correlationId });
  }

  // Normalize (mapper validates with Zod internally)
  let lead: NormalizedLead;
  try {
    lead = mapper(body);
  } catch (err) {
    const reason = err instanceof ZodError ? err.message : 'mapping_failed';
    await webhookEventRepository.updateStatus(eventId, 'failed', reason);
    log.warn({ err }, 'Payload mapping failed');
    return reply.status(400).send({ status: 'rejected', reason: 'invalid_payload', correlationId });
  }

  try {
    // Deduplication
    const leadHash = buildLeadHash(lead);
    const existing = await leadRepository.findByHash(leadHash);
    if (existing) {
      await webhookEventRepository.updateStatus(eventId, 'duplicate');
      log.info({ leadHash }, 'Duplicate lead — ignored');
      return reply.status(200).send({ status: 'duplicate', correlationId });
    }

    // Resolve source_id
    const leadSource = await leadSourcesRepository.findByName(source!);

    // Persist lead
    const leadId = await leadRepository.create(lead, leadHash, null, leadSource?.id ?? null);
    await webhookEventRepository.updateStatus(eventId, 'persisted');
    log.info({ leadId, leadHash }, 'Lead persisted from instagram');

    // TODO: Enfileirar para n8n — mesmo padrão do LeadIngestionService

    return reply.status(202).send({ status: 'accepted', correlationId, leadId });
  } catch (err) {
    await webhookEventRepository.updateStatus(eventId, 'failed', String(err));
    log.error({ err }, 'Unexpected error processing lead');
    return reply.status(500).send({ status: 'rejected', reason: 'internal_error', correlationId });
  }
};
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: sem erros

- [ ] **Step 3: Commit**

```bash
git add src/controllers/unifiedWebhookController.ts
git commit -m "feat: add unifiedWebhookController with auth, mapping, dedup and error handling"
```

---

## Task 9: Route e registro em `createApp`

**Files:**
- Create: `src/routes/webhooks/unified.ts`
- Modify: `src/app/createApp.ts`

- [ ] **Step 1: Criar a route**

```typescript
// src/routes/webhooks/unified.ts
import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { receiveUnifiedWebhook } from '../../controllers/unifiedWebhookController.js';

export const registerUnifiedWebhookRoutes = async (app: FastifyInstance) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post('/webhooks/v1/leads', {
    schema: {
      description: 'Unified lead ingestion. Accepts qualified leads from registered sources (instagram, etc). Auth: X-Api-Key header.',
      response: {
        202: z.object({ status: z.literal('accepted'), correlationId: z.string(), leadId: z.string() }),
        200: z.object({ status: z.literal('duplicate'), correlationId: z.string() }),
        400: z.object({ status: z.literal('rejected'), reason: z.string(), correlationId: z.string() }),
        401: z.object({ status: z.literal('rejected'), reason: z.string(), correlationId: z.string() }),
        500: z.object({ status: z.literal('rejected'), reason: z.string(), correlationId: z.string() })
      }
    }
  }, receiveUnifiedWebhook);
};
```

- [ ] **Step 2: Registrar em `createApp.ts`**

Adicionar import após os imports existentes de rotas:

```typescript
import { registerUnifiedWebhookRoutes } from '../routes/webhooks/unified.js';
```

Adicionar junto aos registros de rotas existentes (após `app.register(registerMetaRoutes)`):

```typescript
app.register(registerUnifiedWebhookRoutes);
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: sem erros

- [ ] **Step 4: Commit**

```bash
git add src/routes/webhooks/unified.ts src/app/createApp.ts
git commit -m "feat: register POST /webhooks/v1/leads route"
```

---

## Task 10: Testes HTTP do endpoint

**Files:**
- Create: `tests/routes/webhooks/unified.test.ts`

- [ ] **Step 1: Escrever os testes**

```typescript
// tests/routes/webhooks/unified.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createApp } from '../../../src/app/createApp.js';
import { webhookEventRepository } from '../../../src/repositories/webhookEventRepository.js';
import { leadRepository } from '../../../src/repositories/leadRepository.js';
import { leadSourcesRepository } from '../../../src/repositories/leadSourcesRepository.js';

const validPayload = {
  source: 'instagram',
  contractVersion: '1.0',
  raw: {
    handle: '@maria_test',
    firstMessage: 'Quero saber sobre botox',
    timestamp: '2026-03-22T10:00:00.000Z'
  },
  qualified: {
    procedimento_interesse: 'Botox',
    janela_decisao: 'até 15 dias',
    regiao: 'Rio de Janeiro',
    resumo: 'Lead muito qualificado'
  },
  processedAt: '2026-03-22T10:01:00.000Z'
};

describe('POST /webhooks/v1/leads', () => {
  beforeEach(() => {
    vi.spyOn(webhookEventRepository, 'create').mockResolvedValue('event-id-1');
    vi.spyOn(webhookEventRepository, 'updateStatus').mockResolvedValue();
    vi.spyOn(leadRepository, 'findByHash').mockResolvedValue(null);
    vi.spyOn(leadRepository, 'create').mockResolvedValue('lead-id-1');
    vi.spyOn(leadSourcesRepository, 'findByName').mockResolvedValue({
      id: 'source-id-1',
      name: 'instagram',
      contractVersion: '1.0',
      mapperVersion: '1.0'
    });
  });

  it('returns 401 when X-Api-Key is missing', async () => {
    const app = await createApp();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      payload: validPayload
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().reason).toBe('invalid_api_key');
  });

  it('returns 401 when X-Api-Key is wrong', async () => {
    const app = await createApp();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      headers: { 'x-api-key': 'wrong-key' },
      payload: validPayload
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 202 for a valid new lead', async () => {
    const app = await createApp();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      headers: { 'x-api-key': 'test-api-key' },
      payload: validPayload
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('accepted');
    expect(res.json().leadId).toBe('lead-id-1');
  });

  it('returns 200 for a duplicate lead (idempotent)', async () => {
    vi.spyOn(leadRepository, 'findByHash').mockResolvedValue({ id: 'existing-lead-id' });

    const app = await createApp();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      headers: { 'x-api-key': 'test-api-key' },
      payload: validPayload
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('duplicate');
  });

  it('returns 400 for unknown contractVersion', async () => {
    const app = await createApp();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { ...validPayload, contractVersion: '9.9' }
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().reason).toContain('unsupported_contract');
  });

  it('returns 400 for payload missing required fields', async () => {
    const app = await createApp();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      headers: { 'x-api-key': 'test-api-key' },
      payload: { source: 'instagram', contractVersion: '1.0' }
    });

    expect(res.statusCode).toBe(400);
  });

  it('persists raw event even when lead is duplicate', async () => {
    vi.spyOn(leadRepository, 'findByHash').mockResolvedValue({ id: 'existing-lead-id' });
    const createEventSpy = vi.spyOn(webhookEventRepository, 'create').mockResolvedValue('event-id-dup');

    const app = await createApp();
    await app.ready();

    await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      headers: { 'x-api-key': 'test-api-key' },
      payload: validPayload
    });

    expect(createEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'instagram', eventType: 'lead_qualified' })
    );
  });

  it('returns 500 when raw event persistence fails', async () => {
    vi.spyOn(webhookEventRepository, 'create').mockRejectedValue(new Error('DB down'));

    const app = await createApp();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/v1/leads',
      headers: { 'x-api-key': 'test-api-key' },
      payload: validPayload
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().reason).toBe('internal_error');
  });
});
```

- [ ] **Step 2: Rodar todos os testes**

```bash
npm test && npx tsc --noEmit
```

Esperado: todos passam

- [ ] **Step 3: Commit**

```bash
git add tests/routes/webhooks/unified.test.ts
git commit -m "test: add HTTP tests for POST /webhooks/v1/leads"
```

---

## Task 11: `leadSender` no instagram-sdr

**Files:**
- Create: `prompt-tester/src/webhook/leadSender.ts` (no repositório instagram-sdr)

> Trabalhar no diretório `/tmp/instagram-sdr` para este task.

- [ ] **Step 1: Criar o módulo**

```typescript
// instagram-sdr/prompt-tester/src/webhook/leadSender.ts
import crypto from 'crypto';

export type QualifiedLead = {
  handle: string;
  instaId?: string;
  firstMessage: string;
  procedimento: string;
  janela: string;
  regiao: string;
  whatsapp?: string;
  resumo: string;
};

export async function sendQualifiedLead(lead: QualifiedLead): Promise<void> {
  const backendUrl = process.env.BACKEND_URL;
  const apiKey = process.env.BACKEND_API_KEY;

  if (!backendUrl || !apiKey) {
    throw new Error('BACKEND_URL and BACKEND_API_KEY must be set');
  }

  const correlationId = crypto.randomUUID();

  const payload = {
    source: 'instagram',
    contractVersion: '1.0',
    raw: {
      handle: lead.handle,
      instaId: lead.instaId,
      firstMessage: lead.firstMessage,
      timestamp: new Date().toISOString()
    },
    qualified: {
      procedimento_interesse: lead.procedimento,
      janela_decisao: lead.janela,
      regiao: lead.regiao,
      contato_whatsapp: lead.whatsapp,
      resumo: lead.resumo
    },
    processedAt: new Date().toISOString()
  };

  const res = await fetch(`${backendUrl}/webhooks/v1/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      'X-Correlation-Id': correlationId
    },
    body: JSON.stringify(payload)
  });

  // 200 = duplicata (OK), 202 = aceito — ambos são sucesso
  if (res.status !== 200 && res.status !== 202) {
    const body = await res.text();
    throw new Error(`Backend rejeitou lead [${correlationId}]: ${res.status} ${body}`);
  }
}
```

- [ ] **Step 2: Adicionar variáveis ao `.env.example` do instagram-sdr**

```bash
# .env.example
BACKEND_URL=https://your-backend.com
BACKEND_API_KEY=your-shared-secret
```

- [ ] **Step 3: Typecheck**

```bash
cd /tmp/instagram-sdr/prompt-tester && npx tsc --noEmit
```

Esperado: sem erros

- [ ] **Step 4: Commit no instagram-sdr**

```bash
cd /tmp/instagram-sdr
git add prompt-tester/src/webhook/leadSender.ts
git commit -m "feat: add leadSender to push qualified leads to backend"
```

---

## Checklist Final

- [ ] `npm test && npx tsc --noEmit` passa completamente no testn8nmetaapi
- [ ] Migrations rodam sem erro (`npm run db:migrate`)
- [ ] `POST /webhooks/v1/leads` com `X-Api-Key` correta retorna 202
- [ ] `POST /webhooks/v1/leads` sem chave retorna 401
- [ ] Lead duplicado retorna 200 sem criar novo registro
- [ ] `webhook_events` sempre é criado, inclusive em caso de erro
- [ ] 500 retornado quando persistência falha
- [ ] `source_id` preenchido em novos leads instagram
- [ ] leadSender no instagram-sdr compila sem erros
