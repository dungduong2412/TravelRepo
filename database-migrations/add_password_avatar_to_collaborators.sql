-- Add password and avatar fields to collaborators table
-- Execute this in Supabase SQL Editor: https://supabase.com/dashboard/project/hsezyogfxgnkpweoqqny/sql

-- Add password field (hashed password, nullable for existing records)
ALTER TABLE collaborators 
ADD COLUMN collaborators_password VARCHAR(255);

-- Add avatar field (URL to uploaded image)
ALTER TABLE collaborators 
ADD COLUMN collaborators_avatar_url TEXT;

-- Add comment for documentation
COMMENT ON COLUMN collaborators.collaborators_password IS 'Bcrypt hashed password for collaborator login';
COMMENT ON COLUMN collaborators.collaborators_avatar_url IS 'URL to collaborator profile picture/avatar';
