ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES lead_sources(id),
  ADD COLUMN IF NOT EXISTS handle VARCHAR(255),
  ADD COLUMN IF NOT EXISTS source_raw_data JSONB,
  ADD COLUMN IF NOT EXISTS source_specific_fields JSONB,
  ADD COLUMN IF NOT EXISTS qualification_data JSONB,
  ADD COLUMN IF NOT EXISTS mapper_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS mapper_version VARCHAR(10),
  ADD COLUMN IF NOT EXISTS mapped_at TIMESTAMPTZ;
UPDATE leads SET source_id = (SELECT id FROM lead_sources WHERE name = 'facebook') WHERE source_id IS NULL;
CREATE INDEX IF NOT EXISTS leads_source_id_idx ON leads(source_id);
