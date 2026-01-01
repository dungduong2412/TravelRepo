-- Add login tracking fields to user_profiles table
-- Execute this in Supabase SQL Editor: https://supabase.com/dashboard/project/hsezyogfxgnkpweoqqny/sql

-- Add login tracking columns
ALTER TABLE user_profiles 
ADD COLUMN last_login_at TIMESTAMPTZ,
ADD COLUMN login_count INTEGER DEFAULT 0,
ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add reference columns for merchant/collaborator
ALTER TABLE user_profiles
ADD COLUMN merchant_id UUID,
ADD COLUMN collaborator_id UUID;

-- Add comments for documentation
COMMENT ON COLUMN user_profiles.last_login_at IS 'Timestamp of last successful login';
COMMENT ON COLUMN user_profiles.login_count IS 'Total number of successful logins';
COMMENT ON COLUMN user_profiles.created_at IS 'Account creation timestamp';
COMMENT ON COLUMN user_profiles.updated_at IS 'Last profile update timestamp';
COMMENT ON COLUMN user_profiles.merchant_id IS 'Foreign key to merchant_details.merchant_system_id (if role=merchant)';
COMMENT ON COLUMN user_profiles.collaborator_id IS 'Foreign key to collaborators.id (if role=collaborator)';

-- Create function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
