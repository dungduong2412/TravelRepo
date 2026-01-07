const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

async function testCollaboratorLogin() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  const testEmail = 'testctv03@gmail.com';
  const testPassword = 'password123'; // Common test password
  
  console.log('=== Testing Collaborator Login ===');
  console.log('Email:', testEmail);
  
  // Step 1: Get user profile
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', testEmail)
    .eq('role', 'collaborator')
    .single();
  
  if (profileError) {
    console.error('Profile error:', profileError);
    return;
  }
  
  console.log('\n1. User Profile Found:');
  console.log('  - User ID:', profile.user_id);
  console.log('  - Collaborator ID:', profile.collaborator_id);
  console.log('  - Role:', profile.role);
  
  // Step 2: Get collaborator
  const { data: collaborator, error: collabError } = await supabase
    .from('collaborators')
    .select('*')
    .eq('id', profile.collaborator_id)
    .single();
  
  if (collabError) {
    console.error('Collaborator error:', collabError);
    return;
  }
  
  console.log('\n2. Collaborator Found:');
  console.log('  - Name:', collaborator.collaborators_name);
  console.log('  - Email:', collaborator.collaborators_email);
  console.log('  - Verified:', collaborator.collaborators_verified);
  console.log('  - Status:', collaborator.collaborators_status);
  console.log('  - Has Password:', !!collaborator.collaborators_password);
  
  if (!collaborator.collaborators_password) {
    console.log('\n❌ ERROR: No password set for this collaborator');
    return;
  }
  
  // Step 3: Test password
  console.log('\n3. Testing Password...');
  const isValid = await bcrypt.compare(testPassword, collaborator.collaborators_password);
  console.log('  - Password "password123":', isValid ? '✅ VALID' : '❌ INVALID');
  
  // Try alternate passwords
  const alternatePasswords = ['test123', '123456', 'testctv03'];
  for (const pwd of alternatePasswords) {
    const valid = await bcrypt.compare(pwd, collaborator.collaborators_password);
    if (valid) {
      console.log(`  - Password "${pwd}": ✅ VALID`);
    }
  }
  
  console.log('\n=== Login Test Complete ===');
}

// Load environment variables manually
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value.length) {
      process.env[key.trim()] = value.join('=').trim();
    }
  });
}

testCollaboratorLogin();
