const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const fs = require('fs');

// Load environment variables
const envContent = fs.readFileSync('../.env', 'utf8');
envContent.split('\n').forEach(line => {
  const [key, ...value] = line.split('=');
  if (key && value.length) {
    process.env[key.trim()] = value.join('=').trim();
  }
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function hashExistingPasswords() {
  console.log('=== Hashing Plain Text Passwords ===\n');
  
  // Get all collaborators
  const { data: collaborators, error } = await supabase
    .from('collaborators')
    .select('id, collaborators_email, collaborators_password, collaborators_name')
    .not('collaborators_password', 'is', null);
  
  if (error) {
    console.error('Error fetching collaborators:', error);
    return;
  }
  
  console.log(`Found ${collaborators.length} collaborators with passwords\n`);
  
  for (const collab of collaborators) {
    const password = collab.collaborators_password;
    
    // Check if already hashed (bcrypt hashes start with $2a$ or $2b$)
    if (password && password.startsWith('$2')) {
      console.log(`✓ ${collab.collaborators_email} - Already hashed`);
      continue;
    }
    
    // Hash the plain text password
    console.log(`Hashing password for ${collab.collaborators_email}...`);
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Update in database
    const { error: updateError } = await supabase
      .from('collaborators')
      .update({ collaborators_password: hashedPassword })
      .eq('id', collab.id);
    
    if (updateError) {
      console.error(`  ❌ Failed: ${updateError.message}`);
    } else {
      console.log(`  ✅ Updated (password was: "${password}")`);
    }
  }
  
  // Do the same for merchants
  console.log('\n--- Checking Merchants ---\n');
  
  const { data: merchants } = await supabase
    .from('merchant_details')
    .select('merchant_id, owner_email, owner_password, business_name')
    .not('owner_password', 'is', null);
  
  if (merchants) {
    console.log(`Found ${merchants.length} merchants with passwords\n`);
    
    for (const merchant of merchants) {
      const password = merchant.owner_password;
      
      if (password && password.startsWith('$2')) {
        console.log(`✓ ${merchant.owner_email} - Already hashed`);
        continue;
      }
      
      console.log(`Hashing password for ${merchant.owner_email}...`);
      const hashedPassword = await bcrypt.hash(password, 10);
      
      const { error: updateError } = await supabase
        .from('merchant_details')
        .update({ owner_password: hashedPassword })
        .eq('merchant_id', merchant.merchant_id);
      
      if (updateError) {
        console.error(`  ❌ Failed: ${updateError.message}`);
      } else {
        console.log(`  ✅ Updated (password was: "${password}")`);
      }
    }
  }
  
  console.log('\n=== Password Hashing Complete ===');
}

hashExistingPasswords();
