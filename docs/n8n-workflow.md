# n8n Workflow Setup (Production Webhook)

## Workflow topology
1. **Webhook (POST)** node receives normalized payload from backend (`/webhook/facebook-leads-ingested`).
2. **IF / Validation** node checks required internal fields (`lead.source`, `correlationId`).
3. **Google Sheets** node appends a row.
4. **CRM Placeholder** node (HTTP Request or native app node).
5. **Notion Placeholder** node.
6. **Slack/WhatsApp notification** node.
7. **Error branch** from each integration node posts into Slack incident channel + optional retry queue.
8. **Respond to Webhook** node returns `200` JSON (`{"status":"ok"}`).

## Test vs Production webhook
- **Test URL** is ephemeral and only valid while editor is waiting for test events.
- **Production URL** is stable and must be configured in `N8N_WEBHOOK_URL` for backend delivery.
- Ensure workflow is **Activated** before using production URL.

## Example payload consumed by n8n
```json
{
  "correlationId": "uuid",
  "ingestedAt": "2026-01-01T00:00:00.000Z",
  "lead": {
    "externalLeadId": "123",
    "email": "lead@example.com",
    "phone": "+15551234567",
    "formId": "abc",
    "pageId": "xyz",
    "source": "facebook_lead_ads"
  },
  "meta": {
    "isDuplicate": false,
    "rawEventStored": true,
    "version": "1.0.0"
  }
}
```
