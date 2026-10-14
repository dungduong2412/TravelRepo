const path = require('path');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config({
  path: path.resolve(__dirname, '../../.env'),
});

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in root .env');
}

const targetHost = new URL(supabaseUrl).hostname;
const localTarget = ['127.0.0.1', 'localhost', '::1'].includes(targetHost);
if (!localTarget && process.env.VNO_ALLOW_REMOTE_TEST_SEED !== 'I_UNDERSTAND_THIS_MUTATES_UAT_TEST_USERS') {
  throw new Error('Remote test-user seeding is blocked without the explicit UAT mutation acknowledgement');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const TEST_PASSWORD = process.env.VNO_TEST_PASSWORD;
if (!TEST_PASSWORD || TEST_PASSWORD.length < 12) {
  throw new Error('VNO_TEST_PASSWORD must be supplied and contain at least 12 characters');
}

const ADMIN = {
  email: 'admin.test@vno.local',
  fullName: 'VNO Test Admin',
};

const MERCHANT = {
  email: 'merchant.test@vno.local',
  merchantCode: 'MCH-TEST-001',
  merchantName: 'VNO Test Merchant',
  ownerName: 'VNO Test Merchant Owner',
  phone: '0900000001',
};

async function findAuthUserByEmail(email) {
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Failed to list auth users: ${error.message}`);
    }

    const users = data?.users || [];
    const found = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) {
      return found;
    }

    if (users.length < perPage) {
      return null;
    }

    page += 1;
  }
}

async function ensureAuthUser(email) {
  const existing = await findAuthUserByEmail(email);

  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: TEST_PASSWORD,
      email_confirm: true,
    });

    if (error || !data.user) {
      throw new Error(`Failed to update auth user ${email}: ${error?.message || 'Unknown error'}`);
    }

    return { action: 'updated', user: data.user };
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(`Failed to create auth user ${email}: ${error?.message || 'Unknown error'}`);
  }

  return { action: 'created', user: data.user };
}

async function ensureAdminProfile(adminUserId) {
  const payload = {
    user_id: adminUserId,
    email: ADMIN.email,
    role: 'admin',
    full_name: ADMIN.fullName,
    user_profiles_status: 'active',
    login_count: 0,
    merchant_id: null,
    collaborator_id: null,
  };

  const { data: existing, error: existingError } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('email', ADMIN.email)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to check admin profile: ${existingError.message}`);
  }

  if (existing) {
    const { data, error } = await supabase
      .from('user_profiles')
      .update(payload)
      .eq('id', existing.id)
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to update admin profile: ${error?.message || 'Unknown error'}`);
    }

    return;
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .insert(payload)
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create admin profile: ${error?.message || 'Unknown error'}`);
  }
}

async function ensureMerchantRow(ownerPasswordHash) {
  const now = new Date().toISOString();

  const { data: byCode, error: byCodeError } = await supabase
    .from('merchant_details')
    .select('merchant_system_id, merchant_registered_date')
    .eq('merchant_code', MERCHANT.merchantCode)
    .limit(1)
    .maybeSingle();

  if (byCodeError) {
    throw new Error(`Failed to query merchant by code: ${byCodeError.message}`);
  }

  const { data: byEmail, error: byEmailError } = await supabase
    .from('merchant_details')
    .select('merchant_system_id, merchant_registered_date')
    .eq('owner_email', MERCHANT.email)
    .order('merchant_registered_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byEmailError) {
    throw new Error(`Failed to query merchant by owner_email: ${byEmailError.message}`);
  }

  const target = byCode || byEmail;

  const merchantPayload = {
    merchant_code: MERCHANT.merchantCode,
    merchant_name: MERCHANT.merchantName,
    owner_name: MERCHANT.ownerName,
    owner_phone: MERCHANT.phone,
    owner_email: MERCHANT.email,
    owner_password: ownerPasswordHash,
    merchant_email: MERCHANT.email,
    merchant_phone: MERCHANT.phone,
    merchant_contact_phone: MERCHANT.phone,
    merchant_verified: true,
    merchants_status: 'active',
    merchant_verified_date: now,
    merchant_last_update: now,
  };

  if (target) {
    const { data, error } = await supabase
      .from('merchant_details')
      .update({
        ...merchantPayload,
        merchant_registered_date: target.merchant_registered_date || now,
      })
      .eq('merchant_system_id', target.merchant_system_id)
      .select('merchant_system_id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to update merchant row: ${error?.message || 'Unknown error'}`);
    }

    return { action: 'updated', merchantSystemId: data.merchant_system_id };
  }

  const { data, error } = await supabase
    .from('merchant_details')
    .insert({
      ...merchantPayload,
      merchant_registered_date: now,
    })
    .select('merchant_system_id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create merchant row: ${error?.message || 'Unknown error'}`);
  }

  return { action: 'created', merchantSystemId: data.merchant_system_id };
}

async function ensureMerchantProfile(merchantUserId, merchantSystemId) {
  const payload = {
    user_id: merchantUserId,
    email: MERCHANT.email,
    role: 'merchant',
    merchant_id: merchantSystemId,
    collaborator_id: null,
    user_profiles_status: 'active',
    login_count: 0,
  };

  const { data: existing, error: existingError } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('email', MERCHANT.email)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to check merchant profile: ${existingError.message}`);
  }

  if (existing) {
    const { data, error } = await supabase
      .from('user_profiles')
      .update(payload)
      .eq('id', existing.id)
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to update merchant profile: ${error?.message || 'Unknown error'}`);
    }

    return;
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .insert(payload)
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create merchant profile: ${error?.message || 'Unknown error'}`);
  }
}

async function verifyRelationships() {
  const { data: adminProfile, error: adminProfileError } = await supabase
    .from('user_profiles')
    .select('email, role, user_id, merchant_id')
    .eq('email', ADMIN.email)
    .eq('role', 'admin')
    .single();

  if (adminProfileError || !adminProfile) {
    throw new Error(`Admin profile verification failed: ${adminProfileError?.message || 'Not found'}`);
  }

  const { data: merchantProfile, error: merchantProfileError } = await supabase
    .from('user_profiles')
    .select('email, role, user_id, merchant_id')
    .eq('email', MERCHANT.email)
    .eq('role', 'merchant')
    .single();

  if (merchantProfileError || !merchantProfile) {
    throw new Error(`Merchant profile verification failed: ${merchantProfileError?.message || 'Not found'}`);
  }

  if (!merchantProfile.merchant_id) {
    throw new Error('Merchant profile verification failed: merchant_id is empty');
  }

  const { data: merchantRow, error: merchantRowError } = await supabase
    .from('merchant_details')
    .select('merchant_system_id, merchant_code')
    .eq('merchant_system_id', merchantProfile.merchant_id)
    .single();

  if (merchantRowError || !merchantRow) {
    throw new Error(`Merchant row verification failed: ${merchantRowError?.message || 'Not found'}`);
  }

  if (merchantRow.merchant_code !== MERCHANT.merchantCode) {
    throw new Error('Merchant row verification failed: merchant code mismatch');
  }
}

async function main() {
  const summary = {
    admin: { created: 0, updated: 0 },
    merchant: { created: 0, updated: 0 },
    merchantCode: MERCHANT.merchantCode,
  };

  const adminAuth = await ensureAuthUser(ADMIN.email);
  summary.admin[adminAuth.action] += 1;
  await ensureAdminProfile(adminAuth.user.id);

  const merchantAuth = await ensureAuthUser(MERCHANT.email);
  summary.merchant[merchantAuth.action] += 1;

  // Supabase Auth is the only password store. Domain password columns stay null.
  const merchantRow = await ensureMerchantRow(null);
  summary.merchant[merchantRow.action] += 1;
  await ensureMerchantProfile(merchantAuth.user.id, merchantRow.merchantSystemId);

  await verifyRelationships();

  console.log('Admin test account ready');
  console.log('Merchant test account ready');
  console.log(
    JSON.stringify(
      {
        admin: summary.admin,
        merchant: summary.merchant,
        merchantCode: summary.merchantCode,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('Seed failed:', error.message || error);
  process.exit(1);
});
