-- D14 patch: extend payment_status check constraint to include 'void'.
--
-- The cancel_real_transaction and reverse_real_transaction RPCs set
-- payment_status = 'void' for cancelled/reversed real transactions.
-- The pre-existing referral_transactions_payment_status_ck constraint was
-- defined before D14 and only allows:
--   'unverified', 'unpaid', 'partially_paid', 'paid', 'disputed'
--
-- This patch adds 'void' to the allowed set. All existing data remains valid
-- because no row currently has payment_status = 'void' (the RPCs couldn't run
-- without this patch). The uat_simulation and v1_import rows all have
-- payment_status = 'unverified' and are unaffected.
--
-- UNDO: ALTER TABLE public.referral_transactions
--         DROP CONSTRAINT referral_transactions_payment_status_ck;
--       ALTER TABLE public.referral_transactions
--         ADD CONSTRAINT referral_transactions_payment_status_ck
--           CHECK (payment_status = ANY (ARRAY[
--             'unverified','unpaid','partially_paid','paid','disputed']));

begin;

alter table public.referral_transactions
  drop constraint referral_transactions_payment_status_ck;

alter table public.referral_transactions
  add constraint referral_transactions_payment_status_ck
    check (payment_status = any (array[
      'unverified'::text,
      'unpaid'::text,
      'partially_paid'::text,
      'paid'::text,
      'disputed'::text,
      'void'::text
    ]));

commit;
