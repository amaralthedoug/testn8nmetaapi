ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES lead_sources(id);
UPDATE leads
SET source_id = (
  SELECT id FROM lead_sources WHERE name = leads.source
)
WHERE source_id IS NULL;
CREATE INDEX IF NOT EXISTS leads_source_id_idx ON leads(source_id);
