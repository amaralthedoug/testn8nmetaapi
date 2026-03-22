CREATE TABLE IF NOT EXISTS lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) UNIQUE NOT NULL,
  contract_version VARCHAR(10) NOT NULL,
  mapper_version VARCHAR(10) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO lead_sources (name, contract_version, mapper_version) VALUES
  ('facebook', '1.0', '1.0'),
  ('instagram', '1.0', '1.0')
ON CONFLICT (name) DO NOTHING;
