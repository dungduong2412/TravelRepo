-- Add comprehensive merchant onboarding fields
-- Execute this in Supabase SQL Editor: https://supabase.com/dashboard/project/hsezyogfxgnkpweoqqny/sql

-- Owner Information
ALTER TABLE merchant_details 
ADD COLUMN owner_name VARCHAR(255),
ADD COLUMN owner_phone VARCHAR(50),
ADD COLUMN owner_email VARCHAR(255),
ADD COLUMN owner_password VARCHAR(255);

-- Merchant Information and Services
ALTER TABLE merchant_details 
ADD COLUMN merchant_description TEXT,
ADD COLUMN merchant_category VARCHAR(100),
ADD COLUMN merchant_contact_phone VARCHAR(50);

-- Address Information - New Address
ALTER TABLE merchant_details 
ADD COLUMN new_address_city VARCHAR(100),
ADD COLUMN new_address_ward VARCHAR(100),
ADD COLUMN new_address_line TEXT;

-- Address Information - Old Address
ALTER TABLE merchant_details 
ADD COLUMN old_address_city VARCHAR(100),
ADD COLUMN old_address_ward VARCHAR(100),
ADD COLUMN old_address_line TEXT;

-- Pictures (storing as JSON array or comma-separated URLs)
ALTER TABLE merchant_details 
ADD COLUMN merchant_pictures TEXT[];

-- Offer Information (keep existing commission/discount fields, these map to:
-- merchant_commission_type/value = discount to collaborators
-- merchant_discount_type/value = discount to customers)

-- Add comments for documentation
COMMENT ON COLUMN merchant_details.owner_name IS 'Owner/contact person full name';
COMMENT ON COLUMN merchant_details.owner_phone IS 'Owner phone number';
COMMENT ON COLUMN merchant_details.owner_email IS 'Owner email address';
COMMENT ON COLUMN merchant_details.owner_password IS 'Bcrypt hashed password for merchant login';
COMMENT ON COLUMN merchant_details.merchant_description IS 'Rich text description of merchant services (up to 1000 words)';
COMMENT ON COLUMN merchant_details.merchant_category IS 'Business category from master data';
COMMENT ON COLUMN merchant_details.merchant_contact_phone IS 'Phone number for customer contact';
COMMENT ON COLUMN merchant_details.new_address_city IS 'New/current address city';
COMMENT ON COLUMN merchant_details.new_address_ward IS 'New/current address ward/district';
COMMENT ON COLUMN merchant_details.new_address_line IS 'New/current address street address';
COMMENT ON COLUMN merchant_details.old_address_city IS 'Previous address city (if applicable)';
COMMENT ON COLUMN merchant_details.old_address_ward IS 'Previous address ward/district (if applicable)';
COMMENT ON COLUMN merchant_details.old_address_line IS 'Previous address street address (if applicable)';
COMMENT ON COLUMN merchant_details.merchant_pictures IS 'Array of up to 5 image URLs for merchant photos';
