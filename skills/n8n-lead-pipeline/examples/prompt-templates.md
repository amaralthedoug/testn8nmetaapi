# n8n Lead Pipeline — Prompt Templates

Ready-to-use prompts for Claude Code (with n8n-mcp connected). Paste any prompt below to generate, validate, and deploy the corresponding n8n workflow.

Each prompt is self-contained: it includes the expected webhook payload so n8n-mcp can configure nodes correctly without additional context.

---

## Prompt 1 — Basic: Webhook to Google Sheets

```
Build an n8n workflow that receives webhook POST requests with lead data and appends each lead to a Google Sheets spreadsheet.

The webhook will receive POST requests at path "leads-sheets" with header authentication using header name "x-internal-auth-token".

The payload shape is:
{
  "correlationId": "uuid-string",
  "ingestedAt": "2026-03-22T10:00:00.000Z",
  "lead": {
    "externalLeadId": "string (optional)",
    "pageId": "string (optional)",
    "formId": "string (optional)",
    "campaignName": "string (optional)",
    "fullName": "string (optional)",
    "firstName": "string (optional)",
    "lastName": "string (optional)",
    "email": "string (optional)",
    "phone": "string (optional)",
    "city": "string (optional)",
    "state": "string (optional)",
    "purchaseTimeline": "string (optional)",
    "budgetRange": "string (optional)",
    "productInterest": "string (optional)",
    "createdTime": "ISO 8601 string (optional)",
    "source": "facebook_lead_ads | instagram"
  },
  "meta": {
    "isDuplicate": false,
    "rawEventStored": true,
    "version": "1.0.0"
  }
}

Steps:
1. Use search_nodes to find the Webhook trigger node and Google Sheets node
2. Use get_node to retrieve their configuration schemas
3. Build a workflow with:
   - Webhook node (POST, path="leads-sheets", authentication=headerAuth)
   - Google Sheets node (operation=append, map these columns: correlationId, ingestedAt, fullName, email, phone, city, productInterest, purchaseTimeline, source — use placeholder spreadsheet ID "YOUR_SPREADSHEET_ID" and sheet name "Leads")
   - Respond to Webhook node (returns {"status":"ok"} with HTTP 200)
4. Use validate_workflow to check the JSON
5. Use create_workflow to deploy it
6. Return the production webhook URL so I can add it to config/routing.json
```

---

## Prompt 2 — WhatsApp: Notify Business Owner on New Lead

```
Build an n8n workflow that receives qualified leads via webhook and sends a WhatsApp message to the business owner with lead details when a phone number is present.

The webhook will receive POST requests at path "leads-whatsapp" with header authentication using header name "x-internal-auth-token".

The payload shape is:
{
  "correlationId": "uuid-string",
  "ingestedAt": "2026-03-22T10:00:00.000Z",
  "lead": {
    "fullName": "string (optional)",
    "email": "string (optional)",
    "phone": "string (optional — E.164 format, e.g. +5511999999999)",
    "city": "string (optional)",
    "state": "string (optional)",
    "productInterest": "string (optional)",
    "purchaseTimeline": "string (optional)",
    "source": "facebook_lead_ads | instagram"
  },
  "meta": { "isDuplicate": false, "rawEventStored": true, "version": "1.0.0" }
}

Steps:
1. Use search_nodes to find Webhook, IF, HTTP Request, Google Sheets, and Respond to Webhook nodes
2. Use get_node for each to get their schemas
3. Build a workflow with:
   - Webhook node (POST, path="leads-whatsapp", authentication=headerAuth)
   - IF node: check if $json.lead.phone exists (string exists operator)
     - TRUE branch: HTTP Request node POST to "https://YOUR_WHATSAPP_API/send" with body:
       { "to": "{{ $json.lead.phone }}", "message": "New lead: {{ $json.lead.fullName }} is interested in {{ $json.lead.productInterest }}. Timeline: {{ $json.lead.purchaseTimeline }}. Email: {{ $json.lead.email }}" }
     - FALSE branch: continue without WhatsApp
   - Both branches merge into Google Sheets append node (spreadsheet ID "YOUR_SPREADSHEET_ID", sheet "Leads", columns: correlationId, fullName, email, phone, productInterest, purchaseTimeline, source, ingestedAt)
   - Respond to Webhook node ({"status":"ok"}, HTTP 200)
4. Validate with validate_workflow
5. Deploy with create_workflow
6. Return the production webhook URL
```

---

## Prompt 3 — Slack + CRM: Team Notification and Contact Creation

```
Build an n8n workflow that receives leads via webhook, posts a summary to Slack channel #leads, and creates a contact in a CRM via HTTP request, then returns a confirmation payload.

The webhook will receive POST requests at path "leads-crm" with header authentication using header name "x-internal-auth-token".

The payload shape is:
{
  "correlationId": "uuid-string",
  "ingestedAt": "2026-03-22T10:00:00.000Z",
  "lead": {
    "firstName": "string (optional)",
    "lastName": "string (optional)",
    "fullName": "string (optional)",
    "email": "string (optional)",
    "phone": "string (optional)",
    "city": "string (optional)",
    "state": "string (optional)",
    "productInterest": "string (optional)",
    "purchaseTimeline": "string (optional)",
    "budgetRange": "string (optional)",
    "campaignName": "string (optional)",
    "source": "facebook_lead_ads | instagram"
  },
  "meta": { "isDuplicate": false, "rawEventStored": true, "version": "1.0.0" }
}

Steps:
1. Use search_nodes to find Webhook, Slack, HTTP Request, Set, and Respond to Webhook nodes
2. Use get_node for each to get configuration schemas
3. Build a workflow with:
   - Webhook node (POST, path="leads-crm", authentication=headerAuth)
   - Parallel execution of:
     a. Slack node: post to channel "#leads" with message "*New Lead*\nName: {{ $json.lead.fullName }}\nEmail: {{ $json.lead.email }}\nPhone: {{ $json.lead.phone }}\nInterest: {{ $json.lead.productInterest }}\nTimeline: {{ $json.lead.purchaseTimeline }}\nSource: {{ $json.lead.source }}\nRef: {{ $json.correlationId }}"
     b. HTTP Request node: POST to "https://YOUR_CRM_API/contacts" with bearer auth, body: { "firstName": "{{ $json.lead.firstName }}", "lastName": "{{ $json.lead.lastName }}", "email": "{{ $json.lead.email }}", "phone": "{{ $json.lead.phone }}", "source": "{{ $json.lead.source }}", "customFields": { "productInterest": "{{ $json.lead.productInterest }}", "purchaseTimeline": "{{ $json.lead.purchaseTimeline }}", "correlationId": "{{ $json.correlationId }}" } }
   - Set node: output { status: "processed", correlationId: "={{ $('Webhook').item.json.correlationId }}", processedAt: "={{ $now.toISO() }}" }
   - Respond to Webhook node: return Set node output as JSON with HTTP 200
4. Validate with validate_workflow
5. Deploy with create_workflow
6. Return the production webhook URL
```

---

## Prompt 4 — Lead Scoring: Score, Route, and Take Action

```
Build an n8n workflow that receives leads via webhook, scores them based on decision timeline and product interest, and routes hot leads to WhatsApp notification, warm leads to email, and cold leads to a log spreadsheet only.

The webhook will receive POST requests at path "leads-scoring" with header authentication using header name "x-internal-auth-token".

The payload shape is:
{
  "correlationId": "uuid-string",
  "ingestedAt": "2026-03-22T10:00:00.000Z",
  "lead": {
    "fullName": "string (optional)",
    "email": "string (optional)",
    "phone": "string (optional)",
    "city": "string (optional)",
    "state": "string (optional)",
    "productInterest": "string (optional) — e.g. 'Rinoplastia', 'Implante', 'Personal Training'",
    "purchaseTimeline": "string (optional) — e.g. '1-3 meses', '6+ meses', 'Imediato'",
    "source": "facebook_lead_ads | instagram"
  },
  "meta": { "isDuplicate": false, "rawEventStored": true, "version": "1.0.0" }
}

Steps:
1. Use search_nodes to find: Webhook, Code (JavaScript), Switch, HTTP Request, Email Send, Google Sheets, Respond to Webhook
2. Use get_node for each
3. Build a workflow with these nodes in order:
   a. Webhook node (POST, path="leads-scoring", authentication=headerAuth)
   b. Code node (JavaScript) that adds "score" (0-100 integer) and "tier" ("hot"|"warm"|"cold") to the item:
      - +40 if purchaseTimeline contains "imediato" or "1" (urgent)
      - +25 if purchaseTimeline contains "3"
      - +10 if purchaseTimeline contains "6"
      - +30 if productInterest is a high-value procedure (rhinoplasty, liposuction, implant, facelift)
      - +15 if productInterest is any other non-empty value
      - +20 if city is São Paulo or Rio de Janeiro
      - +10 if state is SP, RJ, or MG
      - +10 if phone is present
      - tier = score >= 70 ? "hot" : score >= 40 ? "warm" : "cold"
      Output the full original $input.item.json merged with { score, tier }
   c. Switch node with rules:
      - Output 0 ("hot"): tier equals "hot"
      - Output 1 ("warm"): tier equals "warm"
      - Output 2 ("cold"): fallback
   d. Hot branch:
      - HTTP Request node: POST to "https://YOUR_WHATSAPP_API/send" with body { "to": "{{ $json.lead.phone }}", "message": "🔥 HOT lead (score={{ $json.score }}): {{ $json.lead.fullName }} wants {{ $json.lead.productInterest }}, timeline: {{ $json.lead.purchaseTimeline }}" }
      - Then merge into Google Sheets append
   e. Warm branch:
      - Email Send node: to "sales@yourdomain.com", subject "Warm Lead: {{ $json.lead.fullName }}", HTML body with all lead fields and score
      - Then merge into Google Sheets append
   f. Cold branch: goes directly to Google Sheets append
   g. Google Sheets node (append): spreadsheet ID "YOUR_SPREADSHEET_ID", sheet "All Leads", columns: correlationId, ingestedAt, tier, score, fullName, email, phone, productInterest, purchaseTimeline, city, source
   h. Respond to Webhook node: return { "status": "ok", "tier": "{{ $('Code').item.json.tier }}" } with HTTP 200
4. Validate with validate_workflow — fix any expression or connection errors
5. Deploy with create_workflow
6. Return the production webhook URL
```

---

## Prompt 5 — Full Pipeline: Complete Lead Qualification Flow

```
Build a complete lead qualification pipeline in n8n with these stages: webhook trigger → lead scoring → conditional routing with 3 branches (hot/warm/cold) → WhatsApp for hot leads, email for warm leads, Google Sheets log for all leads. Also post every lead to a Slack #leads-all channel regardless of tier.

The webhook will receive POST requests at path "leads-pipeline" with header authentication using header name "x-internal-auth-token".

The full payload the webhook receives:
{
  "correlationId": "uuid-string",
  "ingestedAt": "ISO 8601 timestamp",
  "lead": {
    "externalLeadId": "string (optional)",
    "pageId": "string (optional)",
    "formId": "string (optional)",
    "campaignId": "string (optional)",
    "campaignName": "string (optional)",
    "adsetId": "string (optional)",
    "adsetName": "string (optional)",
    "adId": "string (optional)",
    "adName": "string (optional)",
    "fullName": "string (optional)",
    "firstName": "string (optional)",
    "lastName": "string (optional)",
    "email": "string (optional)",
    "phone": "string (optional — E.164 format)",
    "city": "string (optional)",
    "state": "string (optional — 2-letter code, e.g. SP)",
    "purchaseTimeline": "string (optional — e.g. '1-3 meses', 'Imediato', '6+ meses')",
    "budgetRange": "string (optional)",
    "productInterest": "string (optional)",
    "createdTime": "ISO 8601 string (optional)",
    "rawCustomFields": "object with any additional key-value pairs (optional)",
    "source": "facebook_lead_ads | instagram"
  },
  "meta": {
    "isDuplicate": false,
    "rawEventStored": true,
    "version": "1.0.0"
  }
}

Pipeline stages:

STAGE 1 — Receive
  Webhook node: POST, path="leads-pipeline", authentication=headerAuth (header "x-internal-auth-token")

STAGE 2 — Fan-out to Slack (all leads, fire-and-forget)
  Slack node parallel to scoring: post to #leads-all: "New lead [{{ $json.lead.source }}]: {{ $json.lead.fullName }} — {{ $json.lead.productInterest }} — {{ $json.correlationId }}"

STAGE 3 — Score
  Code node (JavaScript):
  - Score 0-100 based on: purchaseTimeline urgency (+40/+25/+10), productInterest value (+30/+15), city/state geography (+20/+10), phone present (+10)
  - Add score (integer) and tier ("hot"|"warm"|"cold") to item
  - hot >= 70, warm >= 40, cold < 40

STAGE 4 — Route
  Switch node: output 0=hot, 1=warm, 2=cold (fallback)

STAGE 5 — Hot branch actions
  - HTTP Request: POST WhatsApp notification to "https://YOUR_WHATSAPP_API/send" with lead name, product, phone, and score
  - Slack: post to #leads-hot channel with all lead details and score

STAGE 6 — Warm branch actions
  - Email Send: to "sales@yourdomain.com", formatted HTML email with all lead fields and score

STAGE 7 — All branches merge into Google Sheets
  Google Sheets append (spreadsheet ID "YOUR_SPREADSHEET_ID", sheet "All Leads"):
  columns: correlationId, ingestedAt, tier, score, fullName, email, phone, productInterest, purchaseTimeline, budgetRange, city, state, campaignName, source

STAGE 8 — Acknowledge
  Respond to Webhook node: return { "status": "ok", "tier": from Code node output } with HTTP 200

Instructions:
1. Use search_nodes + get_node for all node types before building
2. Build the complete workflow JSON with all nodes and connections
3. Use validate_workflow — iterate until no errors
4. Use create_workflow to deploy
5. Activate the workflow
6. Return the production webhook URL so I can add it to config/routing.json as the default URL
```
