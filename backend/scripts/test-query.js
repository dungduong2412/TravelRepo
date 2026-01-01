const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const collaboratorId = '43d9d41f-0c33-45b2-bd4a-56d606b64dfa';
  
  console.log('Testing query for ID:', collaboratorId);
  
  const { data, error } = await supabase
    .from('collaborators')
    .select('*')
    .eq('id', collaboratorId)
    .maybeSingle();
  
  console.log('Found:', !!data);
  console.log('Error:', error);
  if (data) {
    console.log('Name:', data.collaborators_name);
    console.log('Email:', data.collaborators_email);
  }
}

test();
