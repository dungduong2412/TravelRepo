/**
 * Cleanup Orphaned User Profiles
 * 
 * This script finds and removes user_profiles that reference non-existent
 * collaborators or merchants.
 * 
 * Usage:
 *   node scripts/cleanup-orphaned-profiles.js [--dry-run]
 * 
 * Options:
 *   --dry-run   Show what would be deleted without actually deleting
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const isDryRun = process.argv.includes('--dry-run');

async function cleanupOrphanedProfiles() {
  console.log('🔍 Starting cleanup of orphaned user_profiles...\n');
  
  if (isDryRun) {
    console.log('📋 DRY RUN MODE - No changes will be made\n');
  }

  let totalOrphaned = 0;
  let totalDeleted = 0;

  // Check collaborator orphans
  console.log('📊 Checking for orphaned collaborator profiles...');
  const { data: profiles, error: profilesError } = await supabase
    .from('user_profiles')
    .select('id, email, collaborator_id, merchant_id')
    .not('collaborator_id', 'is', null);

  if (profilesError) {
    console.error('❌ Error fetching user_profiles:', profilesError);
    process.exit(1);
  }

  for (const profile of profiles) {
    const { data: collaborator, error } = await supabase
      .from('collaborators')
      .select('id')
      .eq('id', profile.collaborator_id)
      .maybeSingle();

    if (error || !collaborator) {
      totalOrphaned++;
      console.log(`\n🔴 Orphaned profile found:`);
      console.log(`   Email: ${profile.email}`);
      console.log(`   Profile ID: ${profile.id}`);
      console.log(`   Missing Collaborator ID: ${profile.collaborator_id}`);

      if (!isDryRun) {
        const { error: deleteError } = await supabase
          .from('user_profiles')
          .delete()
          .eq('id', profile.id);

        if (deleteError) {
          console.log(`   ❌ Failed to delete: ${deleteError.message}`);
        } else {
          console.log(`   ✅ Deleted`);
          totalDeleted++;
        }
      } else {
        console.log(`   ⚠️  Would be deleted`);
      }
    }
  }

  // Check merchant orphans
  console.log('\n📊 Checking for orphaned merchant profiles...');
  const { data: merchantProfiles, error: merchantProfilesError } = await supabase
    .from('user_profiles')
    .select('id, email, collaborator_id, merchant_id')
    .not('merchant_id', 'is', null);

  if (merchantProfilesError) {
    console.error('❌ Error fetching merchant profiles:', merchantProfilesError);
    process.exit(1);
  }

  for (const profile of merchantProfiles) {
    const { data: merchant, error } = await supabase
      .from('merchant_details')
      .select('id')
      .eq('id', profile.merchant_id)
      .maybeSingle();

    if (error || !merchant) {
      totalOrphaned++;
      console.log(`\n🔴 Orphaned profile found:`);
      console.log(`   Email: ${profile.email}`);
      console.log(`   Profile ID: ${profile.id}`);
      console.log(`   Missing Merchant ID: ${profile.merchant_id}`);

      if (!isDryRun) {
        const { error: deleteError } = await supabase
          .from('user_profiles')
          .delete()
          .eq('id', profile.id);

        if (deleteError) {
          console.log(`   ❌ Failed to delete: ${deleteError.message}`);
        } else {
          console.log(`   ✅ Deleted`);
          totalDeleted++;
        }
      } else {
        console.log(`   ⚠️  Would be deleted`);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📈 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total orphaned profiles found: ${totalOrphaned}`);
  
  if (isDryRun) {
    console.log(`Profiles that would be deleted: ${totalOrphaned}`);
    console.log('\n💡 Run without --dry-run to actually delete these profiles');
  } else {
    console.log(`Profiles successfully deleted: ${totalDeleted}`);
    if (totalDeleted < totalOrphaned) {
      console.log(`Failed to delete: ${totalOrphaned - totalDeleted}`);
    }
  }
  
  console.log('='.repeat(60));
}

cleanupOrphanedProfiles()
  .then(() => {
    console.log('\n✅ Cleanup completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Cleanup failed:', error);
    process.exit(1);
  });
