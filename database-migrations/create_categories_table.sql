-- Create categories table for merchant categories
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_name VARCHAR(100) NOT NULL,
  category_name_vi VARCHAR(100) NOT NULL,
  category_description TEXT,
  category_icon VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique index on category name
CREATE UNIQUE INDEX idx_categories_name ON categories(category_name);

-- Insert default categories
INSERT INTO categories (category_name, category_name_vi, category_description, display_order) VALUES
  ('hotel', 'Khách Sạn', 'Dịch vụ lưu trú và khách sạn', 1),
  ('restaurant', 'Nhà Hàng', 'Dịch vụ ăn uống và nhà hàng', 2),
  ('tour', 'Tour Du Lịch', 'Các tour và dịch vụ du lịch', 3),
  ('transport', 'Vận Chuyển', 'Dịch vụ vận chuyển và di chuyển', 4),
  ('entertainment', 'Giải Trí', 'Dịch vụ giải trí và vui chơi', 5),
  ('spa', 'Spa & Massage', 'Dịch vụ spa, massage và chăm sóc sức khỏe', 6),
  ('other', 'Khác', 'Các dịch vụ khác', 7);

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_categories_updated_at
    BEFORE UPDATE ON categories
    FOR EACH ROW
    EXECUTE FUNCTION update_categories_updated_at();

-- Add comments
COMMENT ON TABLE categories IS 'Master data table for merchant categories';
COMMENT ON COLUMN categories.category_name IS 'English category name (unique identifier)';
COMMENT ON COLUMN categories.category_name_vi IS 'Vietnamese category name for display';
COMMENT ON COLUMN categories.is_active IS 'Whether category is active and available for selection';
COMMENT ON COLUMN categories.display_order IS 'Order for displaying categories in dropdown';
