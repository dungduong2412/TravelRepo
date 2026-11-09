-- throwaway rehearsal data (never applied anywhere else)
insert into auth.users (id, email, instance_id, aud, role) values
 ('00000000-0000-0000-0000-0000000000a1','mA@rehearsal.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b1','mB@rehearsal.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000c1','mC@rehearsal.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000d1','mD@rehearsal.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
-- A: full policy (5% / 10%); B: different policy (3% / 8%); C: commission only (no discount); D: nothing configured
insert into public.merchant_details (merchant_system_id, merchant_code, merchant_name, merchant_verified, merchants_status, merchant_discount_type, merchant_discount_value, merchant_commission_type, merchant_commission_value) values
 ('aaaaaaaa-0000-4000-8000-00000000000a','MA','Merchant A', true,'active','percentage',0.05,'percentage',0.10),
 ('bbbbbbbb-0000-4000-8000-00000000000b','MB','Merchant B', true,'active','percentage',0.03,'percentage',0.08),
 ('cccccccc-0000-4000-8000-00000000000c','MC','Merchant C', true,'active',null,null,'percentage',0.0),
 ('dddddddd-0000-4000-8000-00000000000d','MD','Merchant D', true,'active',null,null,null,null);
insert into public.user_profiles (user_id,email,role,merchant_id,user_profiles_status) values
 ('00000000-0000-0000-0000-0000000000a1','mA@rehearsal.invalid','merchant','aaaaaaaa-0000-4000-8000-00000000000a','active'),
 ('00000000-0000-0000-0000-0000000000b1','mB@rehearsal.invalid','merchant','bbbbbbbb-0000-4000-8000-00000000000b','active'),
 ('00000000-0000-0000-0000-0000000000c1','mC@rehearsal.invalid','merchant','cccccccc-0000-4000-8000-00000000000c','active'),
 ('00000000-0000-0000-0000-0000000000d1','mD@rehearsal.invalid','merchant','dddddddd-0000-4000-8000-00000000000d','active');
-- P1 assigned to A (history), P2 unassigned (Partner3-like), P3 pending
insert into public.collaborators (id, collaborators_code, collaborators_name, collaborators_verified, collaborators_status, merchant_system_id) values
 ('11111111-0000-4000-8000-000000000001','COL-P1','Partner 1 (assigned to A)', true,'active','aaaaaaaa-0000-4000-8000-00000000000a'),
 ('22222222-0000-4000-8000-000000000002','COL-P2','Partner 2 (unassigned)', true,'active',null),
 ('33333333-0000-4000-8000-000000000003','COL-P3','Partner 3 (pending)', false,'pending',null);
