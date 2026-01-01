-- Add QR code field to collaborators table
-- This QR code will be generated upon admin approval and contain: code, name, phone, email
-- Format: base64 encoded PNG image

ALTER TABLE collaborators
ADD COLUMN IF NOT EXISTS collaborators_qr_code TEXT;

-- Add comment for documentation
COMMENT ON COLUMN collaborators.collaborators_qr_code IS 'Base64 encoded QR code PNG image containing collaborator verification data (code, name, phone, email)';
