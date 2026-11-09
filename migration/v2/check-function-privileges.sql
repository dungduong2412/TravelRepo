-- READ-ONLY security check: who may execute the two transaction-creating functions, and who may touch the scan table.
-- Run it through migration/v2/check-function-privileges.mjs (which also forces a read-only session). It changes nothing.
--
-- Output, one row per line:  ord | label | PASS or FAIL | detail      and a last line  SUMMARY | passed | failed
--
-- Why this exists: the 20261109000001 postchecks assert the privileges of create_real_transaction, but not those of
-- create_uat_simulation_transaction (rewritten by `create or replace`, which keeps whatever ACL the function already had).
-- Expected end state for BOTH functions: EXECUTE for service_role (and the owner) only — never PUBLIC, anon or authenticated.
-- A NULL ACL would mean the PostgreSQL default, which grants EXECUTE to PUBLIC, so an explicit ACL is itself a check.
begin read only;

with
  t(fname, nargs) as (values ('create_uat_simulation_transaction', 4), ('create_real_transaction', 5)),
  allfn as (
    select p.oid, p.proname, p.pronargs
    from pg_proc p join t on t.fname = p.proname
    where p.pronamespace = 'public'::regnamespace
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
  tbl as (select c.oid, c.relrowsecurity, c.relforcerowsecurity from pg_class c where c.oid = to_regclass('public.partner_scan_events')),
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
           coalesce((select not has_function_privilege('public', f.oid, 'execute') from f where f.proname = t.fname), false),
           'has_function_privilege(public)'
    from t
    union all
    select 31, t.fname || ': anon cannot execute',
           coalesce((select not has_function_privilege('anon', f.oid, 'execute') from f where f.proname = t.fname), false),
           'has_function_privilege(anon)'
    from t
    union all
    select 32, t.fname || ': authenticated cannot execute',
           coalesce((select not has_function_privilege('authenticated', f.oid, 'execute') from f where f.proname = t.fname), false),
           'has_function_privilege(authenticated)'
    from t
    union all
    select 33, t.fname || ': service_role can execute',
           coalesce((select has_function_privilege('service_role', f.oid, 'execute') from f where f.proname = t.fname), false),
           'has_function_privilege(service_role)'
    from t
    union all
    select 40, t.fname || ': no grantee other than the owner and service_role holds EXECUTE',
           (select count(*) from grants g where g.proname = t.fname and g.privilege_type = 'EXECUTE'
              and g.grantee_name not in (select owner from f where f.proname = t.fname) and g.grantee_name <> 'service_role') = 0,
           coalesce((select string_agg(distinct g.grantee_name, ', ' order by g.grantee_name) from grants g where g.proname = t.fname and g.privilege_type = 'EXECUTE'), 'no grantee listed')
    from t
    union all
    -- information only (always PASS): the facts a reviewer wants next to the verdicts
    select 90, t.fname || ': owner / security / search_path (information)', true,
           coalesce((select 'owner=' || f.owner || ', ' || case when f.prosecdef then 'SECURITY DEFINER' else 'security invoker' end
                            || ', config=' || coalesce(array_to_string(f.proconfig, ' '), 'none') from f where f.proname = t.fname), 'function not found')
    from t
    union all
    select 100, 'partner_scan_events: table exists with row level security on',
           coalesce((select relrowsecurity from tbl), false),
           coalesce((select 'rls=' || relrowsecurity::text || ', forced=' || relforcerowsecurity::text from tbl), 'table not found')
    union all
    select 110 + g.n, 'partner_scan_events: ' || g.role_name || ' has no table privilege (select/insert/update/delete/truncate/references/trigger)',
           coalesce((select not (has_table_privilege(g.role_name, tbl.oid, 'select') or has_table_privilege(g.role_name, tbl.oid, 'insert')
                              or has_table_privilege(g.role_name, tbl.oid, 'update') or has_table_privilege(g.role_name, tbl.oid, 'delete')
                              or has_table_privilege(g.role_name, tbl.oid, 'truncate') or has_table_privilege(g.role_name, tbl.oid, 'references')
                              or has_table_privilege(g.role_name, tbl.oid, 'trigger')) from tbl), false),
           'has_table_privilege(' || g.role_name || ', ...)'
    from (values (1, 'public'), (2, 'anon'), (3, 'authenticated')) as g(n, role_name)
    union all
    select 120, 'partner_scan_events: service_role can select / insert / update / delete',
           coalesce((select has_table_privilege('service_role', tbl.oid, 'select') and has_table_privilege('service_role', tbl.oid, 'insert')
                         and has_table_privilege('service_role', tbl.oid, 'update') and has_table_privilege('service_role', tbl.oid, 'delete') from tbl), false),
           'has_table_privilege(service_role, ...)'
  )
select ord, label || '|' || case when pass then 'PASS' else 'FAIL' end || '|' || detail from checks
union all
select 999, 'SUMMARY|' || count(*) filter (where pass) || '|' || count(*) filter (where not pass) from checks
order by 1, 2;

rollback;
