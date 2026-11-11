-- READ-ONLY security check of the two Merchant-member functions added by 20261111000001_vno_merchant_member_atomic_create.sql.
-- Run it through `node check-function-privileges.mjs --members` (which also forces a read-only session). It changes nothing.
--
-- Output, one row per line:  ord | label | PASS or FAIL | detail      and a last line  SUMMARY | passed | failed
--
-- Expected end state for BOTH functions: exactly one overload, an explicit ACL, EXECUTE for service_role (and the owner) only — never PUBLIC, anon or
-- authenticated — SECURITY INVOKER with a pinned search_path. A NULL ACL would mean the PostgreSQL default, which grants EXECUTE to PUBLIC.
-- Run it BEFORE the migration and every row is a FAIL ("function not found"); that is the expected "not applied yet" state.
begin read only;

with
  t(fname, nargs) as (values ('create_merchant_member_application', 8), ('reconcile_merchant_member_audit', 3)),
  allfn as (
    select p.oid, p.proname from pg_proc p join t on t.fname = p.proname where p.pronamespace = 'public'::regnamespace
  ),
  f as (
    select p.oid, p.proname, p.proacl, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner
    from pg_proc p join t on t.fname = p.proname and t.nargs = p.pronargs
    where p.pronamespace = 'public'::regnamespace
  ),
  grants as (
    select f.proname, x.privilege_type,
           case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee_name
    from f, lateral aclexplode(f.proacl) x
  ),
  checks as (
    select 10 as ord, t.fname || ': exactly one overload, with the expected argument count' as label,
           ((select count(*) from allfn a where a.proname = t.fname) = 1 and (select count(*) from f where f.proname = t.fname) = 1) as pass,
           (select count(*) from allfn a where a.proname = t.fname)::text || ' overload(s) named ' || t.fname as detail
    from t
    union all
    select 20, t.fname || ': an explicit ACL exists (NULL would mean EXECUTE for PUBLIC)',
           coalesce((select f.proacl is not null from f where f.proname = t.fname), false),
           coalesce((select coalesce(f.proacl::text, 'NULL') from f where f.proname = t.fname), 'function not found')
    from t
    union all
    select 30, t.fname || ': PUBLIC cannot execute',
           coalesce((select not has_function_privilege('public', f.oid, 'execute') from f where f.proname = t.fname), false), 'has_function_privilege(public)'
    from t
    union all
    select 31, t.fname || ': anon cannot execute',
           coalesce((select not has_function_privilege('anon', f.oid, 'execute') from f where f.proname = t.fname), false), 'has_function_privilege(anon)'
    from t
    union all
    select 32, t.fname || ': authenticated cannot execute',
           coalesce((select not has_function_privilege('authenticated', f.oid, 'execute') from f where f.proname = t.fname), false), 'has_function_privilege(authenticated)'
    from t
    union all
    select 33, t.fname || ': service_role can execute',
           coalesce((select has_function_privilege('service_role', f.oid, 'execute') from f where f.proname = t.fname), false), 'has_function_privilege(service_role)'
    from t
    union all
    select 40, t.fname || ': no grantee other than the owner and service_role holds EXECUTE',
           exists (select 1 from f where f.proname = t.fname)
             and (select count(*) from grants g where g.proname = t.fname and g.privilege_type = 'EXECUTE'
                    and g.grantee_name not in (select owner from f where f.proname = t.fname) and g.grantee_name <> 'service_role') = 0,
           coalesce((select string_agg(distinct g.grantee_name, ', ' order by g.grantee_name) from grants g where g.proname = t.fname and g.privilege_type = 'EXECUTE'), 'no grantee listed')
    from t
    union all
    select 50, t.fname || ': SECURITY INVOKER (never DEFINER)',
           coalesce((select not f.prosecdef from f where f.proname = t.fname), false),
           coalesce((select case when f.prosecdef then 'SECURITY DEFINER' else 'security invoker' end from f where f.proname = t.fname), 'function not found')
    from t
    union all
    select 51, t.fname || ': search_path pinned to pg_catalog, public',
           coalesce((select coalesce(f.proconfig, '{}'::text[]) @> array['search_path=pg_catalog, public'] from f where f.proname = t.fname), false),
           coalesce((select coalesce(array_to_string(f.proconfig, ' '), 'none') from f where f.proname = t.fname), 'function not found')
    from t
    union all
    select 90, t.fname || ': owner (information)', true,
           coalesce((select 'owner=' || f.owner from f where f.proname = t.fname), 'function not found')
    from t
  )
select ord, label || '|' || case when pass then 'PASS' else 'FAIL' end || '|' || detail from checks
union all
select 999, 'SUMMARY|' || count(*) filter (where pass) || '|' || count(*) filter (where not pass) from checks
order by 1, 2;

rollback;
