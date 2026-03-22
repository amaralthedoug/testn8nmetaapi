# Design: Integração instagram-sdr → testn8nmetaapi

**Data:** 2026-03-22
**Status:** Draft
**Escopo:** Conectar o instagram-sdr como segunda fonte de leads ao backend centralizado

---

## Contexto

O projeto `instagram-sdr` qualifica leads via Instagram (ManyChat + Claude API) e atualmente armazena resultados em planilha. O `testn8nmetaapi` já é um backend production-grade para ingestão de leads do Facebook.

A integração transforma o instagram-sdr em um **produtor de leads** que alimenta o testn8nmetaapi como fonte secundária, centralizando ingestão, deduplicação, persistência e orquestração.

---

## Decisões Arquiteturais

- **Planilha existente**: fica como arquivo histórico. Novos leads vão exclusivamente para o PostgreSQL.
- **Autenticação**: API Key via header `X-Api-Key` com `crypto.timingSafeEqual()`. TLS obrigatório em produção.
- **Versionamento de contrato**: campo `contractVersion` no payload. Mapper é roteado por `(source, contractVersion)`.
- **Deduplicação**: unificada no campo existente `lead_hash`. Instagram usa `hash(handle + ":" + phone)`. Se `phone` ausente, usa `hash(handle)`. Sem campo `dedup_key` separado.
- **`correlationId`**: instagram-sdr gera um UUIDv4 e envia no header `X-Correlation-Id`. O backend segue o padrão existente: lê `X-Correlation-Id` ou gera um novo. O `correlationId` do body (`correlationId`) é ignorado.
- **`webhook_events`**: a regra "nunca rejeitar silenciosamente" se mantém — a nova rota sempre persiste o evento bruto em `webhook_events` antes de processar.
- **`webhook_failures`**: não será criada. Falhas de processamento seguem o padrão existente: `webhook_events.processing_status = 'failed'`, aproveitando o retry worker já existente.
- **Rate limit**: o endpoint `/webhooks/v1/leads` é tratado como caller interno confiável e recebe limite separado mais permissivo via configuração de `RATE_LIMIT_MAX`.

---

## Fluxo de Dados

```
Instagram (ManyChat)
    ↓ lead qualificado pelo prompt
instagram-sdr (qualificação + leadSender)
    ↓ POST /webhooks/v1/leads
      Headers: X-Api-Key, X-Correlation-Id (UUIDv4)
testn8nmetaapi
    ├─ Valida API Key (timing-safe)
    ├─ Extrai/gera correlationId do header X-Correlation-Id
    ├─ Persiste raw event em webhook_events (sempre)
    ├─ Valida contractVersion
    ├─ Roteia para mapper (source, contractVersion) → mapper
    ├─ Normaliza para schema unificado
    ├─ Calcula lead_hash = hash(handle + ":" + phone) ou hash(handle)
    ├─ Verifica duplicata — se existe: retorna 200 OK (idempotente)
    ├─ Persiste lead normalizado
    └─ Enfileira para n8n com correlationId
    ↓
n8n (orquestração: WhatsApp, CRM, etc)
```

---

## Contrato de Payload (v1)

```typescript
POST /webhooks/v1/leads
Headers:
  Content-Type: application/json
  X-Api-Key: <BACKEND_API_KEY>
  X-Correlation-Id: <UUIDv4 gerado pelo instagram-sdr>

Body:
{
  source: 'instagram',
  contractVersion: '1.0',

  raw: {
    handle: string,              // @handle do Instagram (obrigatório)
    instaId?: string,            // ID interno do ManyChat
    firstMessage: string,        // primeira mensagem do lead
    timestamp: string            // ISO8601 UTC (z.string().datetime())
  },

  qualified: {
    procedimento_interesse: string,
    janela_decisao: string,      // ex: "até 30 dias"
    regiao: string,
    contato_whatsapp?: string,   // pode estar ausente
    resumo: string
  },

  processedAt: string            // ISO8601 UTC
  // mapperVersion removido: detalhe interno do servidor, não pertence ao contrato
}
```

**Respostas:**
- `202 Accepted` — lead ingerido com sucesso
- `200 OK` — lead duplicado, ignorado (idempotente)
- `400 Bad Request` — payload inválido (Zod)
- `401 Unauthorized` — API Key ausente ou inválida
- `500 Internal Server Error` — falha inesperada (evento salvo em webhook_events como 'failed')

---

## Mudanças no testn8nmetaapi

### Novos arquivos

```
src/
  routes/webhooks/unified.ts                  # POST /webhooks/v1/leads
  controllers/unifiedWebhookController.ts
  integrations/instagram/
    schema.ts                                 # Zod schema contrato v1
    mappers/v1.ts                             # instagram payload → NormalizedLead
  repositories/leadSourcesRepository.ts
db/migrations/
  004_add_lead_sources.sql
  005_add_source_fields_to_leads.sql
```

### Mudanças em arquivos existentes

- **`src/types/domain.ts`**: ampliar `NormalizedLead.source` de `'facebook_lead_ads'` para `'facebook_lead_ads' | 'instagram'`
- **`src/config/env.ts`**: adicionar `BACKEND_API_KEY` com fallback `'test-api-key'` nos defaults de test
- **`src/app/createApp.ts`**: registrar nova rota unificada

### Mudanças no schema PostgreSQL

```sql
-- Migration 004: fontes de leads
CREATE TABLE lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) UNIQUE NOT NULL,        -- 'facebook', 'instagram'
  contract_version VARCHAR(10) NOT NULL,
  mapper_version VARCHAR(10) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO lead_sources (name, contract_version, mapper_version)
  VALUES ('facebook', '1.0', '1.0'),
         ('instagram', '1.0', '1.0');

-- Migration 005: novos campos em leads
ALTER TABLE leads
  ADD COLUMN source_id UUID REFERENCES lead_sources(id),
  ADD COLUMN handle VARCHAR(255),
  ADD COLUMN source_raw_data JSONB,
  ADD COLUMN source_specific_fields JSONB,
  ADD COLUMN qualification_data JSONB,
  ADD COLUMN mapper_id VARCHAR(100),
  ADD COLUMN mapper_version VARCHAR(10),
  ADD COLUMN mapped_at TIMESTAMPTZ;

-- Backfill: Facebook leads existentes apontam para fonte 'facebook'
UPDATE leads
  SET source_id = (SELECT id FROM lead_sources WHERE name = 'facebook')
  WHERE source_id IS NULL;

-- Nota: source_id permanece nullable para compatibilidade com leads históricos
-- sem source registrado. Novos leads sempre devem ter source_id preenchido.

-- Índice para retry worker (existente em webhook_events já cobre failures)
CREATE INDEX leads_source_id_idx ON leads(source_id);
```

### `webhook_events` para a nova fonte

Seguindo o padrão existente, o novo flow escreve em `webhook_events` com:
- `provider = 'instagram'`
- `event_type = 'lead_qualified'`
- `processing_status`: `'processed'` ou `'failed'`

---

## Mudanças no instagram-sdr

### Novo módulo: `leadSender`

```typescript
// instagram-sdr/src/webhook/leadSender.ts
import crypto from 'crypto';

async function sendQualifiedLead(lead: QualifiedLead): Promise<void> {
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
    processedAt: new Date().toISOString(),
    // mapperVersion omitido: o servidor decide internamente
  };

  const res = await fetch(`${process.env.BACKEND_URL}/webhooks/v1/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': process.env.BACKEND_API_KEY!,
      'X-Correlation-Id': correlationId
    },
    body: JSON.stringify(payload)
  });

  // 200 = duplicata (OK), 202 = aceito — ambos são sucesso
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`Backend rejeitou lead [${correlationId}]: ${res.status}`);
  }
}
```

**Retry**: instagram-sdr não implementa retry próprio. Falhas lançam exceção para o caller (ManyChat flow) tratar.

### Novas variáveis de ambiente

```
# instagram-sdr/.env
BACKEND_URL=https://your-backend.com   # HTTPS obrigatório em produção
BACKEND_API_KEY=<shared-secret>
```

---

## Autenticação e Segurança

- **Comparação da API Key**: usar `crypto.timingSafeEqual()` para evitar timing attacks
- **TLS**: HTTPS obrigatório em produção. `BACKEND_URL` deve usar `https://`
- **Rotação de chave**: atualizar `BACKEND_API_KEY` nos `.env` de ambos os serviços. Sem downtime se ambos forem atualizados em sequência rápida

---

## Versionamento e Evolução

O router despacha mappers por `(source, contractVersion)`:

```typescript
const mappers = {
  'instagram:1.0': instagramMapperV1,
  'instagram:2.0': instagramMapperV2,  // futuro
  'facebook:1.0':  facebookMapperV1,
};
```

Quando o contrato mudar:
1. Criar `src/integrations/instagram/mappers/v2.ts`
2. Atualizar `lead_sources.mapper_version` para `2.0`
3. Manter mapper v1 até o instagram-sdr migrar

---

## Estratégia de Migração de Dados

Planilha existente fica como arquivo histórico. Novos leads vão exclusivamente para PostgreSQL a partir da integração. Migração retroativa é opcional e pode ser feita via script one-shot em fase posterior.

---

## Testes

Arquivos de teste obrigatórios:

| Arquivo | O que cobre |
|---|---|
| `tests/routes/webhooks/unified.test.ts` | POST /webhooks/v1/leads — payload válido, duplicata (200), API Key inválida (401), contractVersion desconhecida (400), campos ausentes (400) |
| `tests/integrations/instagram/mappers/v1.test.ts` | Mapper: com phone, sem phone (dedup fallback), campos opcionais ausentes |
| `tests/integrations/instagram/schema.test.ts` | Zod schema: timestamp ISO8601 strict, handle obrigatório |

**Padrão**: TDD com `app.inject()` e `vi.spyOn()` para repositories. `await app.ready()` antes de injetar.

**Env defaults**: adicionar `process.env.BACKEND_API_KEY ??= 'test-api-key'` em `src/config/env.ts`.
