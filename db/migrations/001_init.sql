CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_page_id TEXT,
  source_form_id TEXT,
  external_event_id TEXT,
  raw_payload JSONB NOT NULL,
  headers JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_status TEXT NOT NULL,
  processing_error TEXT,
  correlation_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_lead_id TEXT,
  full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  city TEXT,
  state TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  ad_id TEXT,
  ad_name TEXT,
  form_id TEXT,
  page_id TEXT,
  created_time_from_provider TIMESTAMPTZ,
  normalized_payload JSONB NOT NULL,
  lead_hash TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  forwarded_to_n8n_at TIMESTAMPTZ,
  n8n_delivery_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_leads_external_lead_id ON leads(external_lead_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_correlation_id ON webhook_events(correlation_id);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  target_system TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  request_payload JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  error_message TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  success BOOLEAN NOT NULL
);
