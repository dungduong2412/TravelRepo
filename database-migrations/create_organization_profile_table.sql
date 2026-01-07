-- Create organization_profile table for storing organization/company information
-- This is a single-row table (only one organization profile should exist)

CREATE TABLE IF NOT EXISTS organization_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id VARCHAR(50) UNIQUE NOT NULL DEFAULT 'ORG-' || substring(md5(random()::text) from 1 for 8),
  org_name VARCHAR(200) NOT NULL,
  org_address TEXT,
  org_phone VARCHAR(20),
  org_email VARCHAR(100),
  org_description TEXT,
  org_avatar_url TEXT, -- Stores base64 encoded image, supports up to 10MB images (~13MB base64)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on org_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_organization_profile_org_id ON organization_profile(org_id);

-- Add trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_organization_profile_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_organization_profile_updated_at
  BEFORE UPDATE ON organization_profile
  FOR EACH ROW
  EXECUTE FUNCTION update_organization_profile_updated_at();

-- Add comment
COMMENT ON TABLE organization_profile IS 'Stores organization/company profile information. Should contain only one record.';
