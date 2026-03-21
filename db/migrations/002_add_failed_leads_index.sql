-- Partial index on failed leads only.
-- Stays small as leads succeed; covers the WHERE + ORDER BY in listFailed queries.
CREATE INDEX IF NOT EXISTS idx_leads_failed
  ON leads(updated_at)
  WHERE n8n_delivery_status = 'failed';
