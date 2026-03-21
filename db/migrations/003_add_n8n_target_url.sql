-- db/migrations/003_add_n8n_target_url.sql
-- Persists the resolved n8n target URL per lead so the retry worker
-- replays to the same endpoint used during initial delivery.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS n8n_target_url TEXT;
