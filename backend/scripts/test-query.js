const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  console.log('Checking merchant data...\n');
  
  const { data, error } = await supabase
    .from('merchant_details')
    .select('id, merchant_name, owner_email, owner_password, merchant_verified, merchants_status')
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Recent merchants:');
    data.forEach((m, i) => {
      console.log(`\n${i + 1}. ${m.merchant_name || 'Unnamed'}`);
      console.log(`   ID: ${m.id}`);
      console.log(`   Email: ${m.owner_email || 'NULL'}`);
      console.log(`   Password: ${m.owner_password ? 'SET' : 'NULL'}`);
      console.log(`   Verified: ${m.merchant_verified}`);
      console.log(`   Status: ${m.merchants_status}`);
    });
  }
}

test();
