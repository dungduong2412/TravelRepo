const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// Load .env file manually
const envPath = path.join(__dirname, '../../.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

const supabase = createClient(envVars.SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

async function createAdmin() {
  const adminEmail = 'admin@travelrepo.com';
  const adminPassword = 'admin123'; // Change this after first login
  
  console.log('Creating admin user...\n');
  
  // Check if admin already exists
  const { data: existing } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', adminEmail)
    .eq('role', 'admin')
    .single();
  
  if (existing) {
    console.log('✓ Admin user already exists!');
    console.log('\nLogin credentials:');
    console.log(`Email: ${adminEmail}`);
    console.log(`Password: ${adminPassword}`);
    console.log('\nAdmin dashboard: http://localhost:3001/admin/dashboard');
    return;
  }
  
  // Hash password
  const hashedPassword = await bcrypt.hash(adminPassword, 10);
  
  // Create Supabase auth user first
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  });
  
  if (authError) {
    console.error('Error creating auth user:', authError);
    return;
  }
  
  console.log('✓ Auth user created');
  
  // Create admin user profile
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .insert({
      user_id: authUser.user.id,
      email: adminEmail,
      role: 'admin',
      full_name: 'System Administrator',
      login_count: 0,
      user_profiles_status: 'active',
      created_at: new Date().toISOString(),
    })
    .select()
    .single();
  
  if (profileError) {
    console.error('Error creating admin profile:', profileError);
    return;
  }
  
  console.log('✓ Admin user created successfully!\n');
  console.log('Login credentials:');
  console.log(`Email: ${adminEmail}`);
  console.log(`Password: ${adminPassword}`);
  console.log('\n⚠️  IMPORTANT: Change this password after first login!');
  console.log('\nLogin at: http://localhost:3001/login');
  console.log('Admin dashboard: http://localhost:3001/admin/dashboard');
}

createAdmin().catch(console.error);
