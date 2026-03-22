---
name: n8n-lead-pipeline
description: Use when the user wants to build n8n workflow for leads, connect n8n to lead backend, create lead pipeline, set up n8n webhook for instagram leads, automate lead delivery to n8n, configure n8n to receive leads from testn8nmetaapi, or wire up any downstream destination (WhatsApp, Slack, CRM, Google Sheets) for a lead qualification flow.
---

# n8n Lead Pipeline Skill

Use this skill to build, deploy, and configure n8n workflows that receive leads from the **testn8nmetaapi** backend. All steps use n8n-mcp tools — no manual n8n UI work required.

---

## Architecture

```
Sources
  │
  ├── Meta Platform ──────── POST /webhooks/meta/lead-ads  (HMAC-verified)
  │                                       │
  └── Instagram SDR ─────── POST /webhooks/v1/leads  (API-key auth)
              │
              ▼
      testn8nmetaapi (Node.js / Fastify)
        │
        ├── Persist raw event  →  webhook_events table
        ├── Validate & normalize payload
        ├── Deduplicate  (externalLeadId or SHA-256 hash)
        ├── Resolve n8n target URL  (routing.json cascade)
        ├── Persist lead  →  leads table
        │
        └── Async delivery ──► n8n Webhook (POST + x-internal-auth-token)
                │
                └── Retry worker (exponential backoff, delivery_attempts table)
                        │
                        ▼
              n8n Workflow
                │
                ├── Score / filter
                ├── Route conditionally
                └── WhatsApp | Slack | CRM | Google Sheets | Email | ...
```

**testn8nmetaapi** owns ingestion, deduplication, persistence, and retries. n8n only receives a trusted, normalized payload — never raw webhook data. If n8n is unavailable, the backend queues the delivery and retries with exponential backoff.

---

## Prerequisites

1. **n8n-mcp** MCP server connected to your AI agent
   - Repo: [github.com/czlonkowski/n8n-mcp](https://github.com/czlonkowski/n8n-mcp)
   - Install: follow the README — requires a running n8n instance and API key
2. **n8n-skills** (optional but recommended for expression syntax and validation)
   - Repo: [github.com/czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills)
3. **testn8nmetaapi** deployed with:
   - `DATABASE_URL` — PostgreSQL connection string
   - `N8N_WEBHOOK_URL` — fallback n8n webhook URL
   - `N8N_INTERNAL_AUTH_TOKEN` — shared secret sent in `x-internal-auth-token` header on every delivery
4. A running, accessible **n8n instance** (self-hosted or cloud)

---

## Payload Reference

### HTTP request from testn8nmetaapi to n8n

| Property | Value |
|---|---|
| Method | `POST` |
| Content-Type | `application/json` |
| Auth header | `x-internal-auth-token: <N8N_INTERNAL_AUTH_TOKEN>` |
| Timeout | 10 seconds |

> Configure the n8n Webhook node with **Header Auth** credential using header name `x-internal-auth-token`.

### `N8nLeadPayload` (full type)

```typescript
{
  correlationId: string;        // UUID — trace this lead end-to-end
  ingestedAt: string;           // ISO 8601
  lead: {
    // Meta / tracking
    externalLeadId?: string;
    pageId?: string;
    formId?: string;
    campaignId?: string;
    campaignName?: string;
    adsetId?: string;
    adsetName?: string;
    adId?: string;
    adName?: string;

    // Contact
    fullName?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    city?: string;
    state?: string;

    // Qualification
    purchaseTimeline?: string;
    budgetRange?: string;
    productInterest?: string;

    // Timing
    createdTime?: string;

    // Unmapped custom Meta fields
    rawCustomFields?: Record<string, unknown>;

    source: 'facebook_lead_ads' | 'instagram';
  };
  meta: {
    isDuplicate: boolean;       // always false (duplicates are never forwarded)
    rawEventStored: boolean;    // always true
    version: string;            // "1.0.0"
  };
}
```

### n8n expression reference

| Data | Expression |
|---|---|
| Full name | `{{ $json.lead.fullName }}` |
| Phone | `{{ $json.lead.phone }}` |
| Email | `{{ $json.lead.email }}` |
| Product interest | `{{ $json.lead.productInterest }}` |
| Decision timeline | `{{ $json.lead.purchaseTimeline }}` |
| City | `{{ $json.lead.city }}` |
| Source | `{{ $json.lead.source }}` |
| Correlation ID | `{{ $json.correlationId }}` |
| Ingested at | `{{ $json.ingestedAt }}` |

---

## Step-by-Step Workflow Creation

Follow these steps in order using n8n-mcp tools.

### Step 1 — Find the Webhook trigger node

```
search_nodes("webhook trigger")
```

Look for `n8n-nodes-base.webhook`. Note the node type string — you will use it in the workflow JSON.

### Step 2 — Get Webhook node configuration schema

```
get_node("n8n-nodes-base.webhook")
```

Review the `authentication` property options. For this backend, use `headerAuth` (Header Auth credential with header name `x-internal-auth-token`).

### Step 3 — Find destination nodes

Search for each destination node you need:

```
search_nodes("google sheets")
search_nodes("slack")
search_nodes("whatsapp")
search_nodes("http request")
search_nodes("send email")
search_nodes("code javascript")
search_nodes("switch")
search_nodes("if condition")
```

### Step 4 — Get destination node schemas

```
get_node("n8n-nodes-base.googleSheets")
get_node("n8n-nodes-base.slack")
get_node("n8n-nodes-base.httpRequest")
get_node("n8n-nodes-base.code")
get_node("n8n-nodes-base.switch")
```

### Step 5 — Compose the workflow JSON

Build the workflow JSON with:
- `nodes[]` — one entry per node with `id`, `name`, `type`, `typeVersion`, `position`, `parameters`
- `connections{}` — maps each node's outputs to the next node's inputs
- `settings: { "executionOrder": "v1" }`

Use the payload field expressions from the table above to configure node parameters.

Always include a **Respond to Webhook** node (`n8n-nodes-base.respondToWebhook`) at the end returning `{ "status": "ok" }` with HTTP 200. testn8nmetaapi marks delivery as successful only when n8n returns a 2xx response.

### Step 6 — Validate before deploying

```
validate_workflow(<workflow_json>)
```

Fix any reported errors before proceeding. Common issues:
- Missing `typeVersion` on nodes
- Invalid expression syntax (`={{ }}` not `{{ }}` in parameter values)
- `connections` referencing node names that don't match the `name` field

### Step 7 — Deploy to n8n

```
create_workflow(<workflow_json>)
```

The tool returns the created workflow object including its `id`.

### Step 8 — Extract the production webhook URL

```
get_workflow(<workflow_id>)
```

Find the Webhook node's production URL in the response. It follows the pattern:

```
https://YOUR_N8N_HOST/webhook/<path>
```

where `<path>` is the value you set in the Webhook node's `path` parameter.

### Step 9 — Activate the workflow

The production webhook URL only works when the workflow is **Active**. Activate it via n8n UI or:

```
update_workflow(<workflow_id>, { "active": true })
```

### Step 10 — Update routing.json

Add the production webhook URL to `config/routing.json`:

```json
{
  "default": {
    "url": "https://YOUR_N8N_HOST/webhook/<path>"
  }
}
```

Or provide the URL to the user to set as `N8N_WEBHOOK_URL` in their environment.

---

## Niche Templates

### Aesthetic Clinic / Plastic Surgery

**Expected fields from Instagram SDR:**
- `productInterest` ← `procedimento_interesse` (e.g. "Rinoplastia", "Lipoaspiração")
- `purchaseTimeline` ← `janela_decisao` (e.g. "1-3 meses", "6+ meses")
- `city` / `state` ← `regiao`
- `phone` ← `contato_whatsapp`

**Recommended pattern:** Lead Scoring + Conditional Routing (Template 3)

**Scoring logic:**

```javascript
let score = 0;

// High-value procedures
const highValue = ['rhinoplasty','rinoplastia','liposuction','lipoaspiração',
                   'facelift','bichectomia','abdominoplastia'];
if (highValue.some(p => (lead.productInterest || '').toLowerCase().includes(p))) score += 30;
else if (lead.productInterest) score += 15;

// Decision urgency
const timeline = (lead.purchaseTimeline || '').toLowerCase();
if (timeline.includes('imediato') || /\b1\b/.test(timeline)) score += 40;
else if (/3/.test(timeline)) score += 25;
else if (/6/.test(timeline)) score += 10;

// São Paulo / Rio de Janeiro premium markets
const city = (lead.city || '').toLowerCase();
if (city.includes('são paulo') || city.includes('rio de janeiro')) score += 20;
else if (['sp','rj','mg'].includes((lead.state || '').toLowerCase())) score += 10;

// Contact completeness
if (lead.phone) score += 10;

// Tiers: hot >= 70, warm >= 40, cold < 40
```

---

### Dental Clinic

**Expected fields:**
- `productInterest` ← procedure (e.g. "Implante", "Clareamento", "Ortodontia")
- `purchaseTimeline` ← urgency
- `budgetRange` ← budget indication

**Recommended pattern:** Lead to Slack + CRM (Template 2)

**Scoring adjustments:** Boost `score` +20 for implants or full-mouth rehabilitation (high ticket). Boost +15 for existing pain/urgency keywords in `rawCustomFields`.

---

### Real Estate

**Expected fields:**
- `productInterest` ← property type or neighborhood
- `purchaseTimeline` ← buying/renting timeline
- `budgetRange` ← price range
- `city` / `state` ← location preference

**Recommended pattern:** Lead Scoring + Conditional Routing

**Scoring adjustments:** Weight `budgetRange` heavily. Hot = short timeline + high budget + complete contact info.

---

### Gym / Personal Trainer

**Expected fields:**
- `productInterest` ← service type (e.g. "Personal Training", "Online Coaching")
- `purchaseTimeline` ← start date
- `city` ← for in-person filtering

**Recommended pattern:** Lead to WhatsApp + Google Sheets (Template 1)

Hot leads (wants to start immediately + in-person) → WhatsApp. All leads → Sheets log.

---

### Generic Service Business

Use Template 1 or 2. Map `productInterest` to the service name and `purchaseTimeline` to urgency. Adjust scoring thresholds as needed once real data arrives.

---

## Common Patterns

### Multi-destination (fan-out)

Connect the Webhook node to multiple nodes simultaneously by adding multiple entries under its `connections` key:

```json
"Webhook": {
  "main": [[
    { "node": "Post to Slack", "type": "main", "index": 0 },
    { "node": "Append to Google Sheets", "type": "main", "index": 0 },
    { "node": "Create CRM Contact", "type": "main", "index": 0 }
  ]]
}
```

All three nodes receive the same payload and execute in parallel.

### Conditional routing

Use a **Switch** node after scoring to branch based on `tier` or any `lead.*` field. Each output branch is a separate pipeline.

### Error handling

testn8nmetaapi handles retries automatically — if n8n returns a non-2xx response or times out, the backend will retry with exponential backoff up to `RETRY_MAX_ATTEMPTS` (default: 5). Failed leads appear in the dead-letter queue at `GET /admin/leads/failed` and can be replayed with `POST /admin/leads/:id/replay`.

Within n8n, add an **Error Trigger** workflow to catch node-level failures (e.g. Google Sheets API down) and alert via Slack.

---

## Anti-Patterns

**Never skip `validate_workflow` before `create_workflow`.**
Invalid workflow JSON can be created successfully via the API but fail silently at execution time.

**Never hardcode webhook URLs in testn8nmetaapi source code.**
Always use `config/routing.json` or the `N8N_WEBHOOK_URL` env var. This allows URL rotation without redeployment.

**Never use the Webhook node's test URL in production.**
The test URL (`/webhook-test/<path>`) is only active while the n8n editor is open and waiting. Use the production URL (`/webhook/<path>`) and ensure the workflow is **Activated**.

**Never configure the Webhook node without authentication.**
Always use Header Auth with `x-internal-auth-token`. The backend always sends this header — unauthenticated endpoints are a security risk.

**Never add a body schema to the `POST /webhooks/meta/lead-ads` route.**
(Backend constraint) — `fastify-raw-body` must capture raw bytes for HMAC validation. Any Zod body schema on that route breaks signature verification.

---

## Reference

- Full payload contract and importable workflow JSON: `docs/n8n-mcp-integration.md`
- n8n node-by-node setup guide: `docs/n8n-workflow.md`
- Multi-tenant routing config: `config/routing.example.json` and `README.md` → Multi-Tenant Routing
- Ready-to-use prompt templates: `skills/n8n-lead-pipeline/examples/prompt-templates.md`
