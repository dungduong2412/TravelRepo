const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testLogin(email, password) {
  console.log('\n🔍 Testing login for:', email);
  console.log('='.repeat(60));
  
  // STEP 1: Find user_profile
  console.log('\n1️⃣ Looking up user_profile...');
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', email)
    .eq('role', 'collaborator')
    .single();
  
  if (profileError || !profile) {
    console.log('❌ User profile not found');
    console.log('Error:', profileError);
    return;
  }
  console.log('✅ Found user_profile');
  console.log('   - user_id:', profile.user_id);
  console.log('   - collaborator_id:', profile.collaborator_id);
  
  // STEP 2: Check collaborator_id
  if (!profile.collaborator_id) {
    console.log('❌ No collaborator_id in profile');
    return;
  }
  
  // STEP 3: Get collaborator details
  console.log('\n2️⃣ Fetching collaborator details...');
  const { data: collaborator, error: collabError } = await supabase
    .from('collaborators')
    .select('*')
    .eq('id', profile.collaborator_id)
    .single();
  
  if (collabError || !collaborator) {
    console.log('❌ Collaborator not found');
    console.log('Error:', collabError);
    return;
  }
  console.log('✅ Found collaborator');
  console.log('   - name:', collaborator.collaborators_name);
  console.log('   - verified:', collaborator.collaborators_verified);
  
  // STEP 4: Check verified status
  if (!collaborator.collaborators_verified) {
    console.log('❌ Account not verified');
    return;
  }
  console.log('✅ Account is verified');
  
  // STEP 5: Check password exists
  console.log('\n3️⃣ Checking password...');
  if (!collaborator.collaborators_password) {
    console.log('❌ No password set');
    return;
  }
  console.log('✅ Password hash exists');
  console.log('   - hash:', collaborator.collaborators_password.substring(0, 20) + '...');
  
  // STEP 6: Compare password
  console.log('\n4️⃣ Comparing password...');
  const isValidPassword = await bcrypt.compare(password, collaborator.collaborators_password);
  if (!isValidPassword) {
    console.log('❌ Password does not match');
    return;
  }
  console.log('✅ Password matches!');
  
  // STEP 7: Try Supabase Auth login
  console.log('\n5️⃣ Attempting Supabase Auth sign in...');
  const { data: session, error: sessionError } = await supabase.auth.signInWithPassword({
    email: email,
    password: password,
  });
  
  if (sessionError) {
    console.log('❌ Supabase Auth failed:', sessionError.message);
    console.log('   This means the password in Supabase Auth is different from the database');
    return;
  }
  console.log('✅ Supabase Auth successful!');
  console.log('   - access_token:', session.session?.access_token ? 'present' : 'missing');
  
  console.log('\n' + '='.repeat(60));
  console.log('✅✅✅ LOGIN SHOULD WORK! ✅✅✅');
  console.log('='.repeat(60));
}

// Test with the account we created
testLogin('testdirect@test.com', 'password123')
  .catch(err => console.error('Fatal error:', err));
