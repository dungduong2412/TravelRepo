const { createClient } = require('@supabase/supabase-js');
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

async function checkSchema() {
  console.log('Checking user_profiles table structure...\n');
  
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .limit(1);
  
  if (error) {
    console.error('Error:', error);
  } else {
    if (data && data.length > 0) {
      console.log('Available columns:', Object.keys(data[0]));
    } else {
      console.log('Table is empty. Checking by inserting test data...');
    }
  }
}

checkSchema().catch(console.error);
