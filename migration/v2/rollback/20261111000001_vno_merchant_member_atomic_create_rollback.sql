-- Rollback for 20261111000001_vno_merchant_member_atomic_create.sql. NOT in supabase/migrations on purpose (it must never run automatically).
--
-- ORDER MATTERS: first re-stage the API to the previous release (a384f48), THEN run this script. The new API calls this function to CREATE; with it gone it
-- fails closed (POST /merchants/members answers 500 MEMBER_CREATE_FAILED) until it is rolled back. The previous API never calls it, so the reverse order is harmless.
--
-- What it does: drops the one function. It changes NO table and NO data. Rows created through the function are ordinary collaborators rows and ordinary
-- audit_events rows and stay exactly as they are (audit is append-only; nothing is deleted).
-- After it: delete from supabase_migrations.schema_migrations where version = '20261111000001';
begin;

drop function if exists public.create_merchant_member_application(uuid, uuid, text, text, text, text, text, text);

commit;

notify pgrst, 'reload schema';
