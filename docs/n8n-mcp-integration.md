# n8n-mcp Integration Guide

> **Attribution:** This guide uses [n8n-mcp](https://github.com/czlonkowski/n8n-mcp) (15.7k stars) by [@czlonkowski](https://github.com/czlonkowski) — an MCP server that lets AI agents build, validate, and deploy n8n workflows programmatically. The companion [n8n-skills](https://github.com/czlonkowski/n8n-skills) library provides Claude Code skills for expression syntax, node configuration, and workflow patterns.

---

## Overview

This guide explains how to use **n8n-mcp** to auto-generate n8n workflows that receive lead payloads from **testn8nmetaapi** — eliminating manual n8n configuration entirely.

### What this guide covers

- The exact payload contract testn8nmetaapi sends to n8n
- Three ready-to-import n8n workflow templates
- How to update `config/routing.json` to point at newly created webhook URLs
- How to test, verify, and troubleshoot the end-to-end integration

### The value proposition

| Approach | Time |
|---|---|
| Manual n8n config (nodes, connections, auth, testing) | 30–45 minutes |
| AI prompt with n8n-mcp connected | 3 minutes |

### Prerequisites

1. A running n8n instance (self-hosted or cloud)
2. **n8n-mcp** installed and connected to your AI agent — see [czlonkowski/n8n-mcp](https://github.com/czlonkowski/n8n-mcp) for setup
3. **n8n-skills** (optional but recommended) — see [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills)
4. testn8nmetaapi deployed with `DATABASE_URL`, `N8N_WEBHOOK_URL`, and `N8N_INTERNAL_AUTH_TOKEN` configured

---

## Payload Contract

When testn8nmetaapi successfully ingests and deduplicates a lead, it delivers a `POST` request to the resolved n8n webhook URL.

### HTTP request details

| Property | Value |
|---|---|
| Method | `POST` |
| Content-Type | `application/json` |
| Auth header | `x-internal-auth-token: <N8N_INTERNAL_AUTH_TOKEN>` |
| Timeout | 10 seconds |

> **Note:** The authentication header is `x-internal-auth-token`, not `Authorization: Bearer`. Configure your n8n Webhook node's **Header Auth** credential accordingly.

### Payload shape (`N8nLeadPayload`)

```typescript
type N8nLeadPayload = {
  correlationId: string;        // UUID tracing this lead end-to-end
  ingestedAt: string;           // ISO 8601 timestamp of ingestion
  lead: NormalizedLead;
  meta: {
    isDuplicate: boolean;       // always false (duplicates are never forwarded)
    rawEventStored: boolean;    // always true
    version: string;            // "1.0.0"
  };
};

type NormalizedLead = {
  // Meta / Facebook fields
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
  createdTime?: string;         // ISO 8601

  // Overflow — unmapped custom Meta fields land here
  rawCustomFields?: Record<string, unknown>;

  // Source identifier
  source: 'facebook_lead_ads' | 'instagram';
};
```

### Full example payload

```json
{
  "correlationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "ingestedAt": "2026-03-22T10:01:00.000Z",
  "lead": {
    "externalLeadId": "987654321",
    "pageId": "111111111",
    "formId": "222222222",
    "campaignId": "333333333",
    "campaignName": "Rhinoplasty Spring 2026",
    "fullName": "Maria Silva",
    "firstName": "Maria",
    "lastName": "Silva",
    "email": "maria@example.com",
    "phone": "+5511999999999",
    "city": "São Paulo",
    "state": "SP",
    "purchaseTimeline": "1-3 meses",
    "productInterest": "Rinoplastia",
    "createdTime": "2026-03-22T10:00:00.000Z",
    "source": "facebook_lead_ads"
  },
  "meta": {
    "isDuplicate": false,
    "rawEventStored": true,
    "version": "1.0.0"
  }
}
```

For Instagram SDR leads (`source: "instagram"`), the `lead` object will additionally contain fields promoted from `qualified.*` (e.g. `productInterest` from `procedimento_interesse`, `purchaseTimeline` from `janela_decisao`).

### Routing resolution cascade

testn8nmetaapi resolves the target URL for each lead in this order:

```
lead.formId matches routing.json entry  →  form-level URL
lead.pageId matches routing.json entry  →  page-level URL
routing.json "default" key present      →  config default URL
fallback                                →  N8N_WEBHOOK_URL env var
```

The resolved URL is stored on the `leads` row, so the retry worker always replays to the same endpoint.

---

## Workflow Templates

### Template 1 — Lead to WhatsApp + Google Sheets (basic)

**What it does:** Receives a lead, appends a row to Google Sheets, and — if a phone number is present — sends a WhatsApp notification via HTTP API.

**n8n-mcp prompt to generate this from scratch:**

> See `skills/n8n-lead-pipeline/examples/prompt-templates.md` → Prompt 2.

**Workflow JSON:**

```json
{
  "name": "Lead to WhatsApp + Google Sheets",
  "nodes": [
    {
      "id": "1",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [240, 300],
      "parameters": {
        "httpMethod": "POST",
        "path": "leads-basic",
        "authentication": "headerAuth",
        "responseMode": "responseNode",
        "options": {}
      }
    },
    {
      "id": "2",
      "name": "Has Phone?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [460, 300],
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "strict" },
          "conditions": [
            {
              "id": "cond1",
              "leftValue": "={{ $json.lead.phone }}",
              "rightValue": "",
              "operator": { "type": "string", "operation": "exists" }
            }
          ],
          "combinator": "and"
        }
      }
    },
    {
      "id": "3",
      "name": "Append to Google Sheets",
      "type": "n8n-nodes-base.googleSheets",
      "typeVersion": 4,
      "position": [680, 200],
      "parameters": {
        "operation": "append",
        "documentId": { "__rl": true, "value": "YOUR_SPREADSHEET_ID", "mode": "id" },
        "sheetName": { "__rl": true, "value": "Leads", "mode": "name" },
        "columns": {
          "mappingMode": "defineBelow",
          "value": {
            "correlationId": "={{ $json.correlationId }}",
            "ingestedAt": "={{ $json.ingestedAt }}",
            "fullName": "={{ $json.lead.fullName }}",
            "email": "={{ $json.lead.email }}",
            "phone": "={{ $json.lead.phone }}",
            "city": "={{ $json.lead.city }}",
            "productInterest": "={{ $json.lead.productInterest }}",
            "purchaseTimeline": "={{ $json.lead.purchaseTimeline }}",
            "source": "={{ $json.lead.source }}"
          }
        },
        "options": {}
      }
    },
    {
      "id": "4",
      "name": "Send WhatsApp",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [680, 400],
      "parameters": {
        "method": "POST",
        "url": "https://YOUR_WHATSAPP_API/send",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [{ "name": "Content-Type", "value": "application/json" }]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"to\": \"{{ $json.lead.phone }}\",\n  \"message\": \"New lead: {{ $json.lead.fullName }} — {{ $json.lead.productInterest }}. Timeline: {{ $json.lead.purchaseTimeline }}.\"\n}"
      }
    },
    {
      "id": "5",
      "name": "Respond to Webhook",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [900, 300],
      "parameters": {
        "respondWith": "json",
        "responseBody": "={ \"status\": \"ok\" }",
        "options": { "responseCode": 200 }
      }
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Has Phone?", "type": "main", "index": 0 }]] },
    "Has Phone?": {
      "main": [
        [{ "node": "Send WhatsApp", "type": "main", "index": 0 }],
        [{ "node": "Append to Google Sheets", "type": "main", "index": 0 }]
      ]
    },
    "Send WhatsApp": { "main": [[{ "node": "Append to Google Sheets", "type": "main", "index": 0 }]] },
    "Append to Google Sheets": { "main": [[{ "node": "Respond to Webhook", "type": "main", "index": 0 }]] }
  },
  "pinData": {},
  "settings": { "executionOrder": "v1" },
  "staticData": null,
  "tags": [],
  "triggerCount": 0,
  "updatedAt": "2026-03-22T00:00:00.000Z",
  "versionId": "1"
}
```

---

### Template 2 — Lead to Slack + CRM (business)

**What it does:** Receives a lead, posts a formatted summary to a Slack channel, creates a contact in a CRM via HTTP API, and acknowledges the webhook.

**n8n-mcp prompt to generate this from scratch:**

> See `skills/n8n-lead-pipeline/examples/prompt-templates.md` → Prompt 3.

**Workflow JSON:**

```json
{
  "name": "Lead to Slack + CRM",
  "nodes": [
    {
      "id": "1",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [240, 300],
      "parameters": {
        "httpMethod": "POST",
        "path": "leads-crm",
        "authentication": "headerAuth",
        "responseMode": "responseNode",
        "options": {}
      }
    },
    {
      "id": "2",
      "name": "Post to Slack",
      "type": "n8n-nodes-base.slack",
      "typeVersion": 2.2,
      "position": [460, 200],
      "parameters": {
        "operation": "post",
        "channel": "#leads",
        "text": "=*New Lead*\nName: {{ $json.lead.fullName }}\nEmail: {{ $json.lead.email }}\nPhone: {{ $json.lead.phone }}\nInterest: {{ $json.lead.productInterest }}\nTimeline: {{ $json.lead.purchaseTimeline }}\nSource: {{ $json.lead.source }}\nID: {{ $json.correlationId }}"
      }
    },
    {
      "id": "3",
      "name": "Create CRM Contact",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [460, 400],
      "parameters": {
        "method": "POST",
        "url": "https://YOUR_CRM_API/contacts",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpBearerAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"firstName\": \"{{ $json.lead.firstName }}\",\n  \"lastName\": \"{{ $json.lead.lastName }}\",\n  \"email\": \"{{ $json.lead.email }}\",\n  \"phone\": \"{{ $json.lead.phone }}\",\n  \"source\": \"{{ $json.lead.source }}\",\n  \"customFields\": {\n    \"productInterest\": \"{{ $json.lead.productInterest }}\",\n    \"purchaseTimeline\": \"{{ $json.lead.purchaseTimeline }}\",\n    \"correlationId\": \"{{ $json.correlationId }}\"\n  }\n}"
      }
    },
    {
      "id": "4",
      "name": "Format Confirmation",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [680, 300],
      "parameters": {
        "mode": "manual",
        "duplicateItem": false,
        "assignments": {
          "assignments": [
            { "id": "a1", "name": "status", "value": "processed", "type": "string" },
            { "id": "a2", "name": "correlationId", "value": "={{ $('Webhook').item.json.correlationId }}", "type": "string" },
            { "id": "a3", "name": "processedAt", "value": "={{ $now.toISO() }}", "type": "string" }
          ]
        }
      }
    },
    {
      "id": "5",
      "name": "Respond to Webhook",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [900, 300],
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify($json) }}",
        "options": { "responseCode": 200 }
      }
    }
  ],
  "connections": {
    "Webhook": {
      "main": [
        [
          { "node": "Post to Slack", "type": "main", "index": 0 },
          { "node": "Create CRM Contact", "type": "main", "index": 0 }
        ]
      ]
    },
    "Post to Slack": { "main": [[{ "node": "Format Confirmation", "type": "main", "index": 0 }]] },
    "Create CRM Contact": { "main": [[{ "node": "Format Confirmation", "type": "main", "index": 0 }]] },
    "Format Confirmation": { "main": [[{ "node": "Respond to Webhook", "type": "main", "index": 0 }]] }
  },
  "pinData": {},
  "settings": { "executionOrder": "v1" },
  "staticData": null,
  "tags": [],
  "triggerCount": 0,
  "updatedAt": "2026-03-22T00:00:00.000Z",
  "versionId": "1"
}
```

---

### Template 3 — Lead Scoring + Conditional Routing (advanced)

**What it does:** Receives a lead, runs a JavaScript scoring function based on `purchaseTimeline`, `productInterest`, and geographic fields, then routes hot leads to WhatsApp + priority Slack, warm leads to email, and cold leads to a log spreadsheet only.

**n8n-mcp prompt to generate this from scratch:**

> See `skills/n8n-lead-pipeline/examples/prompt-templates.md` → Prompt 4.

**Workflow JSON:**

```json
{
  "name": "Lead Scoring + Conditional Routing",
  "nodes": [
    {
      "id": "1",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [240, 400],
      "parameters": {
        "httpMethod": "POST",
        "path": "leads-scoring",
        "authentication": "headerAuth",
        "responseMode": "responseNode",
        "options": {}
      }
    },
    {
      "id": "2",
      "name": "Score Lead",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [460, 400],
      "parameters": {
        "jsCode": "const lead = $input.item.json.lead;\nconst correlationId = $input.item.json.correlationId;\n\nlet score = 0;\n\n// Decision timeline scoring\nconst timeline = (lead.purchaseTimeline || '').toLowerCase();\nif (timeline.includes('imediato') || timeline.includes('1') || timeline.includes('immediate')) score += 40;\nelse if (timeline.includes('3') || timeline.includes('trimestre')) score += 25;\nelse if (timeline.includes('6') || timeline.includes('semestre')) score += 10;\n\n// Product interest (higher value procedures = higher score)\nconst interest = (lead.productInterest || '').toLowerCase();\nif (['rhinoplasty','rinoplastia','liposuction','lipoaspiração','facelift'].some(p => interest.includes(p))) score += 30;\nelse if (interest.length > 0) score += 15;\n\n// Geographic scoring (metro areas)\nconst city = (lead.city || '').toLowerCase();\nconst state = (lead.state || '').toLowerCase();\nif (['são paulo','rio de janeiro','belo horizonte','brasília'].some(c => city.includes(c))) score += 20;\nelse if (['sp','rj','mg','df'].includes(state)) score += 10;\n\n// Contact completeness\nif (lead.phone) score += 10;\n\nconst tier = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold';\n\nreturn [{ json: { ...($input.item.json), score, tier } }];"
      }
    },
    {
      "id": "3",
      "name": "Route by Score",
      "type": "n8n-nodes-base.switch",
      "typeVersion": 3,
      "position": [680, 400],
      "parameters": {
        "mode": "rules",
        "rules": {
          "values": [
            {
              "conditions": {
                "options": { "caseSensitive": false, "leftValue": "", "typeValidation": "loose" },
                "conditions": [{ "leftValue": "={{ $json.tier }}", "rightValue": "hot", "operator": { "type": "string", "operation": "equals" } }],
                "combinator": "and"
              },
              "renameOutput": true,
              "outputKey": "hot"
            },
            {
              "conditions": {
                "options": { "caseSensitive": false, "leftValue": "", "typeValidation": "loose" },
                "conditions": [{ "leftValue": "={{ $json.tier }}", "rightValue": "warm", "operator": { "type": "string", "operation": "equals" } }],
                "combinator": "and"
              },
              "renameOutput": true,
              "outputKey": "warm"
            }
          ]
        },
        "fallbackOutput": "extra"
      }
    },
    {
      "id": "4",
      "name": "Hot: WhatsApp",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [900, 200],
      "parameters": {
        "method": "POST",
        "url": "https://YOUR_WHATSAPP_API/send",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"to\": \"{{ $json.lead.phone }}\",\n  \"message\": \"🔥 HOT lead (score={{ $json.score }}): {{ $json.lead.fullName }} wants {{ $json.lead.productInterest }} — timeline: {{ $json.lead.purchaseTimeline }}\"\n}"
      }
    },
    {
      "id": "5",
      "name": "Hot: Priority Slack",
      "type": "n8n-nodes-base.slack",
      "typeVersion": 2.2,
      "position": [900, 340],
      "parameters": {
        "operation": "post",
        "channel": "#leads-hot",
        "text": "=🔥 *HOT Lead — Score {{ $json.score }}*\nName: {{ $json.lead.fullName }}\nPhone: {{ $json.lead.phone }}\nInterest: {{ $json.lead.productInterest }}\nTimeline: {{ $json.lead.purchaseTimeline }}"
      }
    },
    {
      "id": "6",
      "name": "Warm: Send Email",
      "type": "n8n-nodes-base.emailSend",
      "typeVersion": 2.1,
      "position": [900, 480],
      "parameters": {
        "fromEmail": "noreply@yourdomain.com",
        "toEmail": "sales@yourdomain.com",
        "subject": "=Warm Lead: {{ $json.lead.fullName }} — {{ $json.lead.productInterest }}",
        "emailType": "html",
        "message": "=<p>Lead score: {{ $json.score }}</p><p>Name: {{ $json.lead.fullName }}<br>Email: {{ $json.lead.email }}<br>Phone: {{ $json.lead.phone }}<br>Interest: {{ $json.lead.productInterest }}<br>Timeline: {{ $json.lead.purchaseTimeline }}</p>"
      }
    },
    {
      "id": "7",
      "name": "Log to Sheets",
      "type": "n8n-nodes-base.googleSheets",
      "typeVersion": 4,
      "position": [1120, 400],
      "parameters": {
        "operation": "append",
        "documentId": { "__rl": true, "value": "YOUR_SPREADSHEET_ID", "mode": "id" },
        "sheetName": { "__rl": true, "value": "All Leads", "mode": "name" },
        "columns": {
          "mappingMode": "defineBelow",
          "value": {
            "correlationId": "={{ $json.correlationId }}",
            "ingestedAt": "={{ $json.ingestedAt }}",
            "tier": "={{ $json.tier }}",
            "score": "={{ $json.score }}",
            "fullName": "={{ $json.lead.fullName }}",
            "email": "={{ $json.lead.email }}",
            "phone": "={{ $json.lead.phone }}",
            "productInterest": "={{ $json.lead.productInterest }}",
            "purchaseTimeline": "={{ $json.lead.purchaseTimeline }}",
            "city": "={{ $json.lead.city }}",
            "source": "={{ $json.lead.source }}"
          }
        },
        "options": {}
      }
    },
    {
      "id": "8",
      "name": "Respond to Webhook",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [1340, 400],
      "parameters": {
        "respondWith": "json",
        "responseBody": "={ \"status\": \"ok\", \"tier\": \"{{ $('Score Lead').item.json.tier }}\" }",
        "options": { "responseCode": 200 }
      }
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Score Lead", "type": "main", "index": 0 }]] },
    "Score Lead": { "main": [[{ "node": "Route by Score", "type": "main", "index": 0 }]] },
    "Route by Score": {
      "main": [
        [{ "node": "Hot: WhatsApp", "type": "main", "index": 0 }],
        [{ "node": "Warm: Send Email", "type": "main", "index": 0 }],
        [{ "node": "Log to Sheets", "type": "main", "index": 0 }]
      ]
    },
    "Hot: WhatsApp": { "main": [[{ "node": "Hot: Priority Slack", "type": "main", "index": 0 }]] },
    "Hot: Priority Slack": { "main": [[{ "node": "Log to Sheets", "type": "main", "index": 0 }]] },
    "Warm: Send Email": { "main": [[{ "node": "Log to Sheets", "type": "main", "index": 0 }]] },
    "Log to Sheets": { "main": [[{ "node": "Respond to Webhook", "type": "main", "index": 0 }]] }
  },
  "pinData": {},
  "settings": { "executionOrder": "v1" },
  "staticData": null,
  "tags": [],
  "triggerCount": 0,
  "updatedAt": "2026-03-22T00:00:00.000Z",
  "versionId": "1"
}
```

---

## Routing Configuration

After creating an n8n workflow with n8n-mcp, extract the production webhook URL from the created workflow and add it to `config/routing.json`.

### Before (routing.json with placeholder)

```json
{
  "default": {
    "url": "https://n8n.example.com/webhook/default"
  }
}
```

### After (pointing to the n8n-mcp-created workflow)

```json
{
  "default": {
    "url": "https://your-n8n.com/webhook/leads-basic"
  },
  "pages": [
    {
      "pageId": "111111111",
      "url": "https://your-n8n.com/webhook/leads-crm",
      "forms": [
        {
          "formId": "222222222",
          "url": "https://your-n8n.com/webhook/leads-scoring",
          "fieldMap": {
            "mobile phone": "phone",
            "product interest": "productInterest",
            "purchase timeline": "purchaseTimeline",
            "budget range": "budgetRange"
          }
        }
      ]
    }
  ]
}
```

**Important:** Always use the **production** webhook URL (not the test URL). The production URL is only valid when the workflow is **Activated** in n8n. The test URL is ephemeral and only available while the n8n editor is waiting for a test event.

---

## Testing the Integration

### 1. Send a test lead via the unified endpoint

```bash
curl -X POST http://localhost:3000/webhooks/v1/leads \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_BACKEND_API_KEY" \
  -d '{
    "source": "instagram",
    "contractVersion": "1.0",
    "raw": {
      "handle": "@testuser",
      "firstMessage": "Quero saber sobre rinoplastia",
      "timestamp": "2026-03-22T10:00:00.000Z"
    },
    "qualified": {
      "procedimento_interesse": "Rinoplastia",
      "janela_decisao": "1-3 meses",
      "regiao": "São Paulo",
      "contato_whatsapp": "+5511999999999",
      "resumo": "Interested in rhinoplasty."
    },
    "processedAt": "2026-03-22T10:01:00.000Z"
  }'
```

Expected response (`202`):

```json
{
  "status": "accepted",
  "correlationId": "uuid-here",
  "leadId": "uuid-here"
}
```

### 2. Verify delivery in the database

```bash
# Check delivery_attempts for the lead
psql $DATABASE_URL -c "
  SELECT l.id, l.n8n_delivery_status, l.n8n_target_url, da.success, da.response_status
  FROM leads l
  LEFT JOIN delivery_attempts da ON da.lead_id = l.id
  ORDER BY l.created_at DESC
  LIMIT 5;
"
```

### 3. Check n8n received the payload

In the n8n editor, open the workflow and click **Executions** to see recent runs. Each successful delivery appears as a completed execution with the full payload.

### 4. Replay a failed lead via admin API

```bash
# List failed leads
curl -H "Authorization: Bearer YOUR_ADMIN_API_KEY" \
  http://localhost:3000/admin/leads/failed

# Replay a specific lead
curl -X POST \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY" \
  http://localhost:3000/admin/leads/LEAD_ID/replay
```

---

## Troubleshooting

### n8n returns 404 — webhook not found

The workflow is not **Activated**. In the n8n editor, toggle the workflow to **Active** before using the production URL.

### n8n returns 401 — authentication failed

The `x-internal-auth-token` value in testn8nmetaapi's `N8N_INTERNAL_AUTH_TOKEN` env var does not match the Header Auth credential configured on the n8n Webhook node. Verify both values are identical.

### testn8nmetaapi delivers to the wrong URL

The routing cascade resolved to an unexpected URL. Check:
1. `config/routing.json` has the correct `formId` / `pageId` entries
2. The file is present (not just `routing.example.json`)
3. Restart the backend after editing `routing.json` — the file is loaded at startup

### Lead accepted but never arrives in n8n

The delivery is asynchronous. Check the `delivery_attempts` table for error messages. Common causes:
- n8n workflow is in **Test** mode (test URL was configured instead of production URL)
- Network connectivity between backend host and n8n host
- n8n instance is down; the retry worker will keep retrying up to `RETRY_MAX_ATTEMPTS`

### `rawCustomFields` contains the data instead of typed fields

The Meta form uses custom field labels that don't match the defaults. Add a `fieldMap` entry to `routing.json` that maps the raw label string to the `NormalizedLead` field name:

```json
"fieldMap": {
  "telefone celular": "phone",
  "interesse principal": "productInterest"
}
```

See `README.md` → Multi-Tenant Routing for the full `fieldMap` reference.
