-- Add status columns to collaborators, merchant_details, and user_profiles tables

-- Add collaborators_status to collaborators table
ALTER TABLE collaborators 
ADD COLUMN IF NOT EXISTS collaborators_status VARCHAR(50) DEFAULT 'pending';

-- Add merchants_status to merchant_details table
ALTER TABLE merchant_details 
ADD COLUMN IF NOT EXISTS merchants_status VARCHAR(50) DEFAULT 'pending';

-- Add user_profiles_status to user_profiles table
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS user_profiles_status VARCHAR(50) DEFAULT 'active';

-- Add comments for documentation
COMMENT ON COLUMN collaborators.collaborators_status IS 'Status of collaborator: pending, active, inactive, blocked';
COMMENT ON COLUMN merchant_details.merchants_status IS 'Status of merchant: pending, active, inactive, blocked';
COMMENT ON COLUMN user_profiles.user_profiles_status IS 'Status of user profile: active, inactive, suspended';
