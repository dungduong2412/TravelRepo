-- READ-ONLY catalog preflight for 20261111000001_vno_merchant_member_atomic_create.sql (create_merchant_member_application).
-- Run it through `node preflight-members-catalog.mjs` (which forces a read-only session and redacts credentials). It changes nothing: it runs inside
-- `begin read only … rollback` and reads pg_catalog / information_schema metadata plus a few AGGREGATES (counts and one digest per table). It prints NO row data,
-- no e-mail, no phone, no name and no bank detail.
--
-- Why it exists: the migration inserts into public.collaborators and public.audit_events from inside a database function. A rehearsal database cannot prove the
-- hosted table definitions, so these queries compare the HOSTED catalog with exactly what the function needs: columns and types, length limits, NOT NULL columns
-- without a default, CHECK constraints, unique indexes, triggers, RLS, privileges of service_role, existing functions (name clash, advisory-lock namespace),
-- event triggers and the migration history.
--
-- Output, one line per row:   ord | label | PASS, FAIL or INFO | detail     and a last line   9999 | SUMMARY | passed | failed | info
--   PASS / FAIL  = a gate. Every gate must be PASS before the migration is applied; a FAIL names what to review and nothing is changed automatically.
--   INFO         = inventory for the reviewer (columns, constraints, indexes, triggers, policies, functions, aggregates).
-- Sections: 1xxx target · 2xxx collaborators · 3xxx audit_events · 4xxx tables read by the function · 5xxx functions / lock namespace / event triggers ·
--           6xxx privileges and roles · 7xxx migration history · 8xxx data shape (aggregates only) · 9xxx digests (for a before / after comparison)
begin read only;

with
  -- ---- what the function writes / reads -------------------------------------------------------------------------------------------------------------
  -- (table, column, type family, minimum length when the column is a bounded varchar: the longest value the API can send)
  need(t, col, fam, minlen) as (values
    ('collaborators', 'merchant_system_id',           'uuid',        null::int),
    ('collaborators', 'collaborators_code',           'text',        10),
    ('collaborators', 'collaborators_name',           'text',        120),
    ('collaborators', 'collaborators_phone',          'text',        16),
    ('collaborators', 'collaborators_email',          'text',        254),
    ('collaborators', 'collaborators_bank_name',      'text',        100),
    ('collaborators', 'collaborators_bank_acc_number','text',        20),
    ('collaborators', 'collaborators_password',       'text',        null),
    ('collaborators', 'collaborators_registered_date','timestamptz', null),
    ('collaborators', 'collaborators_verified',       'boolean',     null),
    ('collaborators', 'collaborators_status',         'text',        null),
    ('collaborators', 'id',                           'uuid',        null),
    ('audit_events',  'actor_auth_user_id',           'uuid',        null),
    ('audit_events',  'actor_role',                   'text',        8),
    ('audit_events',  'action',                       'text',        38),
    ('audit_events',  'entity_type',                  'text',        12),
    ('audit_events',  'entity_id',                    'text',        36),
    ('audit_events',  'source',                       'text',        12),
    ('audit_events',  'details',                      'jsonb',       null),
    ('audit_events',  'id',                           'bigint',      null),     -- read by the API's replay verification (ordering + the event id in the log)
    ('audit_events',  'occurred_at',                  'timestamptz', null),     -- read by the replay verification (was the actor's profile already there?)
    ('user_profiles', 'user_id',                      'uuid',        null),
    ('user_profiles', 'role',                         'text',        null),
    ('user_profiles', 'merchant_id',                  'uuid',        null),
    ('user_profiles', 'user_profiles_status',         'text',        null),
    ('user_profiles', 'created_at',                   'timestamptz', null),     -- read by the replay verification (the creator's profile must pre-date the creation event)
    ('merchant_details', 'merchant_system_id',        'uuid',        null),
    ('merchant_details', 'merchants_status',          'text',        null),
    ('merchant_details', 'merchant_verified',         'boolean',     null)
  ),
  -- the columns the function lists in its INSERT statements (everything else must be nullable or have a default)
  written(t, col) as (values
    ('collaborators','merchant_system_id'), ('collaborators','collaborators_code'), ('collaborators','collaborators_name'), ('collaborators','collaborators_phone'),
    ('collaborators','collaborators_email'), ('collaborators','collaborators_bank_name'), ('collaborators','collaborators_bank_acc_number'),
    ('collaborators','collaborators_password'), ('collaborators','collaborators_registered_date'), ('collaborators','collaborators_verified'), ('collaborators','collaborators_status'),
    ('audit_events','actor_auth_user_id'), ('audit_events','actor_role'), ('audit_events','action'), ('audit_events','entity_type'), ('audit_events','entity_id'),
    ('audit_events','source'), ('audit_events','details')
  ),
  tabs as (
    select c.oid, c.relname as t, c.relrowsecurity, c.relforcerowsecurity, c.relkind
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('collaborators','audit_events','user_profiles','merchant_details') and c.relkind in ('r','p')
  ),
  cols as (
    select tb.t, tb.oid as reloid, a.attnum, a.attname as col, format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull, a.attidentity, a.attgenerated,
           pg_get_expr(d.adbin, d.adrelid) as dflt,
           case when a.atttypmod > 4 and format_type(a.atttypid, a.atttypmod) ~ '^(character varying|character)\(' then a.atttypmod - 4 end as maxlen,
           case when format_type(a.atttypid, a.atttypmod) = 'uuid' then 'uuid'
                when format_type(a.atttypid, a.atttypmod) = 'text' or format_type(a.atttypid, a.atttypmod) ~ '^(character varying|character)' then 'text'
                when format_type(a.atttypid, a.atttypmod) ~ '^timestamp with time zone' then 'timestamptz'
                else format_type(a.atttypid, a.atttypmod) end as fam
    from tabs tb join pg_attribute a on a.attrelid = tb.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  ),
  cons as (
    select tb.t, co.conname, co.contype, pg_get_constraintdef(co.oid) as def
    from tabs tb join pg_constraint co on co.conrelid = tb.oid
  ),
  idx as (
    select tb.t, ic.relname as idxname, pg_get_indexdef(i.indexrelid) as def, i.indisunique, i.indisvalid
    from tabs tb join pg_index i on i.indrelid = tb.oid join pg_class ic on ic.oid = i.indexrelid
  ),
  trg as (
    select tb.t, tg.tgname, tg.tgenabled, pg_get_triggerdef(tg.oid) as def,
           (tg.tgtype & 2) <> 0 as is_before, (tg.tgtype & 4) <> 0 as on_insert, (tg.tgtype & 64) <> 0 as is_instead
    from tabs tb join pg_trigger tg on tg.tgrelid = tb.oid where not tg.tgisinternal
  ),
  pol as (
    select tb.t, p.polname, p.polcmd, p.polpermissive, pg_get_expr(p.polqual, p.polrelid) as using_expr, pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
    from tabs tb join pg_policy p on p.polrelid = tb.oid
  ),
  fns as (
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.proowner, p.proacl, p.prosrc, p.proconfig, p.provolatile
    from pg_proc p where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  ),
  -- ---- migration history (only when the table exists and is readable by this session) --------------------------------------------------------------
  hist_ok as (
    select to_regclass('supabase_migrations.schema_migrations') is not null
           and has_schema_privilege(current_user, 'supabase_migrations', 'usage')
           and has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'select') as readable
  ),
  hist as (
    select h.readable,
      case when h.readable then (xpath('/row/n/text()', query_to_xml('select count(*) as n from supabase_migrations.schema_migrations', false, true, '')))[1]::text end as n_total,
      case when h.readable then (xpath('/row/n/text()', query_to_xml('select count(*) as n from supabase_migrations.schema_migrations where version = ''20261111000001''', false, true, '')))[1]::text end as n_this,
      case when h.readable then (xpath('/row/n/text()', query_to_xml('select count(*) as n from supabase_migrations.schema_migrations where version = ''20261109000001''', false, true, '')))[1]::text end as n_prereq,
      case when h.readable then (xpath('/row/n/text()', query_to_xml('select count(*) as n from supabase_migrations.schema_migrations where version > ''20261111000001''', false, true, '')))[1]::text end as n_later,
      case when h.readable then (xpath('/row/v/text()', query_to_xml('select coalesce(string_agg(version, '', '' order by version desc), ''none'') as v from (select version from supabase_migrations.schema_migrations order by version desc limit 8) t', false, true, '')))[1]::text end as last8
    from hist_ok h
  ),
  checks(ord, label, verdict, detail) as (
    -- ===================================================== 1xxx target ======================================================================================
    select 1000, 'server version', 'INFO', current_setting('server_version')
    union all select 1010, 'session user / current user / database', 'INFO', session_user || ' / ' || current_user || ' / ' || current_database()
    union all select 1020, 'GATE this session is read-only', case when current_setting('transaction_read_only') = 'on' then 'PASS' else 'FAIL' end, 'transaction_read_only=' || current_setting('transaction_read_only')
    union all select 1030, 'GATE hashtextextended(text,bigint) and pg_advisory_xact_lock(bigint) exist (the per-e-mail lock)',
           case when to_regprocedure('hashtextextended(text,bigint)') is not null and to_regprocedure('pg_advisory_xact_lock(bigint)') is not null then 'PASS' else 'FAIL' end, 'PostgreSQL ' || current_setting('server_version_num')
    -- ===================================================== 2xxx / 3xxx / 4xxx per table =====================================================================
    union all
    select 2000 + (case n.t when 'collaborators' then 0 when 'audit_events' then 1000 when 'user_profiles' then 2000 else 2100 end) + 1,
           'GATE ' || n.t || ': table exists as a plain table', case when exists (select 1 from tabs where tabs.t = n.t and tabs.relkind in ('r','p')) then 'PASS' else 'FAIL' end, n.t
    from (values ('collaborators'), ('audit_events'), ('user_profiles'), ('merchant_details')) n(t)
    union all
    select 2000 + (case nd.t when 'collaborators' then 0 when 'audit_events' then 1000 when 'user_profiles' then 2000 else 2100 end) + 10 + row_number() over (partition by nd.t order by nd.col),
           'GATE ' || nd.t || '.' || nd.col || ': exists with type family ' || nd.fam || coalesce(' and room for ' || nd.minlen || ' characters', ''),
           case when c.col is null then 'FAIL'
                when c.fam <> nd.fam then 'FAIL'
                when nd.minlen is not null and c.maxlen is not null and c.maxlen < nd.minlen then 'FAIL'
                else 'PASS' end,
           coalesce(c.typ || case when c.attnotnull then ' not null' else ' nullable' end || coalesce(' default ' || c.dflt, ''), 'COLUMN MISSING')
    from need nd left join cols c on c.t = nd.t and c.col = nd.col
    union all
    select 2000 + (case w.t when 'collaborators' then 0 else 1000 end) + 200,
           'GATE ' || w.t || ': every NOT NULL column without a default is written by the function',
           case when count(c.col) = 0 then 'PASS' else 'FAIL' end,
           coalesce(string_agg(c.col || ' ' || c.typ, ', ' order by c.col), 'none')
    from (values ('collaborators'), ('audit_events')) w(t)
    left join cols c on c.t = w.t and c.attnotnull and c.dflt is null and c.attidentity = '' and c.attgenerated = ''
         and not exists (select 1 from written wr where wr.t = c.t and wr.col = c.col)
    group by w.t
    union all
    select 2000 + (case c.t when 'collaborators' then 0 when 'audit_events' then 1000 when 'user_profiles' then 2000 else 2100 end) + 300 + c.attnum,
           'INFO column ' || c.t || '.' || c.col, 'INFO',
           c.typ || case when c.attnotnull then ' not null' else ' nullable' end || coalesce(' default ' || c.dflt, '') || case when c.attidentity <> '' then ' identity' else '' end || case when c.attgenerated <> '' then ' generated' else '' end
    from cols c
    union all
    select 2000 + (case c.t when 'collaborators' then 0 when 'audit_events' then 1000 when 'user_profiles' then 2000 else 2100 end) + 500 + row_number() over (partition by c.t order by c.conname),
           'INFO constraint ' || c.t || ' ' || c.conname || ' (' || c.contype::text || ')', 'INFO', c.def
    from cons c
    union all
    select 2000 + (case i.t when 'collaborators' then 0 when 'audit_events' then 1000 when 'user_profiles' then 2000 else 2100 end) + 600 + row_number() over (partition by i.t order by i.idxname),
           'INFO index ' || i.t || ' ' || i.idxname, 'INFO', i.def || case when i.indisvalid then '' else '  [INVALID]' end
    from idx i
    union all
    select 2000 + (case g.t when 'collaborators' then 0 when 'audit_events' then 1000 when 'user_profiles' then 2000 else 2100 end) + 700 + row_number() over (partition by g.t order by g.tgname),
           'INFO trigger ' || g.t || ' ' || g.tgname || ' (enabled=' || g.tgenabled::text || ')', 'INFO', g.def
    from trg g
    union all
    select 2000 + (case p.t when 'collaborators' then 0 when 'audit_events' then 1000 when 'user_profiles' then 2000 else 2100 end) + 800 + row_number() over (partition by p.t order by p.polname),
           'INFO policy ' || p.t || ' ' || p.polname || ' (cmd=' || p.polcmd::text || ', permissive=' || p.polpermissive || ')', 'INFO',
           'using ' || coalesce(p.using_expr, '-') || ' | with check ' || coalesce(p.check_expr, '-')
    from pol p
    union all
    select 2000 + (case tb.t when 'collaborators' then 0 when 'audit_events' then 1000 when 'user_profiles' then 2000 else 2100 end) + 900,
           'INFO row level security ' || tb.t, 'INFO', 'enabled=' || tb.relrowsecurity || ' forced=' || tb.relforcerowsecurity
    from tabs tb
    -- gates over constraints / indexes / triggers
    union all
    select 2950, 'GATE audit_events: no CHECK constraint mentions action / entity_type / actor_role / source (a new action value could be rejected; review any listed)',
           case when count(*) = 0 then 'PASS' else 'FAIL' end, coalesce(string_agg(c.conname || ': ' || c.def, ' ; '), 'none')
    from cons c where c.t = 'audit_events' and c.contype = 'c' and c.def ~* '(action|entity_type|actor_role|source)'
    union all
    select 2951, 'GATE collaborators: no UNIQUE index or constraint covers collaborators_email (documented: duplicate e-mails exist today; a unique index is a LATER release)',
           case when count(*) = 0 then 'PASS' else 'FAIL' end, coalesce(string_agg(x.name || ': ' || x.def, ' ; '), 'none')
    from (select i.idxname as name, i.def from idx i where i.t = 'collaborators' and i.indisunique and i.def ~* 'collaborators_email'
          union all select c.conname, c.def from cons c where c.t = 'collaborators' and c.contype = 'u' and c.def ~* 'collaborators_email') x
    union all
    select 2952, 'GATE collaborators and audit_events: no enabled BEFORE INSERT / INSTEAD OF trigger (it could rewrite or swallow the row; review any listed)',
           case when count(*) = 0 then 'PASS' else 'FAIL' end, coalesce(string_agg(g.t || '.' || g.tgname, ', ' order by g.t, g.tgname), 'none')
    from trg g where g.t in ('collaborators','audit_events') and g.on_insert and (g.is_before or g.is_instead) and g.tgenabled <> 'D'
    union all
    select 2953, 'INFO collaborators and audit_events: AFTER INSERT triggers (side effects of the new rows; review any listed)', 'INFO',
           coalesce((select string_agg(g.t || '.' || g.tgname, ', ' order by g.t, g.tgname) from trg g where g.t in ('collaborators','audit_events') and g.on_insert and not g.is_before and not g.is_instead and g.tgenabled <> 'D'), 'none')
    union all
    select 2954, 'INFO audit_events: existing rows already use the values the function writes (actor_role merchant / entity_type collaborator / source v2-admin-api)', 'INFO',
           'actor_role=merchant: ' || exists (select 1 from public.audit_events where actor_role = 'merchant') || ', entity_type=collaborator: ' || exists (select 1 from public.audit_events where entity_type = 'collaborator')
           || ', source=v2-admin-api: ' || exists (select 1 from public.audit_events where source = 'v2-admin-api')
    -- ===================================================== 5xxx functions ====================================================================================
    union all
    select 2955, 'INFO audit_events: an index whose leading columns are (entity_type, entity_id) exists (the access path of the API replay lookup)', 'INFO',
           coalesce((select string_agg(x.idxname, ', ' order by x.idxname) from idx x where x.t = 'audit_events' and x.def ~* '\(entity_type, entity_id'), 'NONE (the lookup still works, but by scanning)')
    union all
    select 5000, 'GATE create_merchant_member_application does not exist yet (any overload, schema public): the migration has not been applied',
           case when count(*) = 0 then 'PASS' else 'FAIL' end, coalesce(string_agg(f.proname || '(' || f.args || ')', ', '), 'none')
    from fns f where f.proname = 'create_merchant_member_application'
    union all
    select 5001, 'GATE no function named *merchant_member* exists in public (the reconciliation function from an earlier draft must not be present)',
           case when count(*) = 0 then 'PASS' else 'FAIL' end, coalesce(string_agg(f.proname || '(' || f.args || ')', ', '), 'none')
    from fns f where f.proname like '%merchant\_member%'
    union all
    select 5002, 'GATE the advisory-lock key prefix vno:merchant-member-email: is used by no existing function body', case when count(*) = 0 then 'PASS' else 'FAIL' end,
           coalesce(string_agg(f.proname, ', '), 'none')
    from fns f where f.prosrc like '%vno:merchant-member-email:%'
    union all
    select 5010, 'INFO number of functions in public (extension members excluded)', 'INFO', count(*)::text from fns
    union all
    select 5100 + row_number() over (order by f.proname, f.args), 'INFO function public.' || f.proname || '(' || f.args || ')', 'INFO',
           case when f.prosecdef then 'SECURITY DEFINER' else 'security invoker' end || ' · owner ' || pg_get_userbyid(f.proowner) || ' · acl ' || coalesce(f.proacl::text, 'NULL (=PUBLIC)') || ' · config ' || coalesce(array_to_string(f.proconfig, ' '), 'none')
    from fns f
    union all
    select 5900 + row_number() over (order by e.evtname), 'INFO event trigger ' || e.evtname || ' (' || e.evtevent || ', enabled=' || e.evtenabled::text || ')', 'INFO', 'function ' || e.evtfoid::regproc::text
    from pg_event_trigger e
    union all
    select 5990, 'INFO number of event triggers', 'INFO', (select count(*) from pg_event_trigger)::text
    union all
    select 5991, 'INFO default privileges that apply to NEW functions in public', 'INFO',
           coalesce((select string_agg(pg_get_userbyid(d.defaclrole) || ': ' || d.defaclacl::text, ' ; ') from pg_default_acl d where d.defaclobjtype = 'f' and d.defaclnamespace in (0, 'public'::regnamespace)), 'none')
    union all
    select 5992, 'INFO installed extensions', 'INFO', (select string_agg(extname || ' ' || extversion, ', ' order by extname) from pg_extension)
    -- ===================================================== 6xxx privileges and roles =========================================================================
    union all
    select 6000, 'GATE roles anon, authenticated, authenticator and service_role exist', case when (select count(*) from pg_roles where rolname in ('anon','authenticated','authenticator','service_role')) = 4 then 'PASS' else 'FAIL' end,
           coalesce((select string_agg(rolname, ', ' order by rolname) from pg_roles where rolname in ('anon','authenticated','authenticator','service_role')), 'none')
    union all
    select 6001, 'GATE service_role bypasses row level security (the function runs as service_role, SECURITY INVOKER)', case when coalesce((select rolbypassrls from pg_roles where rolname = 'service_role'), false) then 'PASS' else 'FAIL' end,
           coalesce((select 'rolbypassrls=' || rolbypassrls from pg_roles where rolname = 'service_role'), 'role missing')
    union all
    select 6002, 'GATE authenticator can switch to service_role (PostgREST calls the function as service_role)', case when coalesce(pg_has_role('authenticator', 'service_role', 'member'), false) then 'PASS' else 'FAIL' end, 'pg_has_role(authenticator, service_role, member)'
    union all
    select 6003, 'GATE service_role has USAGE on schema public', case when has_schema_privilege('service_role', 'public', 'usage') then 'PASS' else 'FAIL' end, 'has_schema_privilege(service_role, public, usage)'
    union all
    select 6010 + p.o, 'GATE service_role has ' || p.priv || ' on public.' || p.t, case when to_regclass('public.' || p.t) is not null and has_table_privilege('service_role', 'public.' || p.t, p.priv) then 'PASS' else 'FAIL' end,
           'has_table_privilege(service_role, public.' || p.t || ', ' || p.priv || ')'
    from (values (1, 'collaborators', 'INSERT'), (2, 'collaborators', 'SELECT'), (3, 'audit_events', 'INSERT'), (4, 'audit_events', 'SELECT'), (5, 'user_profiles', 'SELECT'), (6, 'merchant_details', 'SELECT')) p(o, t, priv)
    union all
    select 6050 + row_number() over (order by c.t, c.col), 'GATE service_role may use the sequence behind ' || c.t || '.' || c.col,
           case when has_sequence_privilege('service_role', pg_get_serial_sequence('public.' || c.t, c.col), 'USAGE') then 'PASS' else 'FAIL' end, c.dflt
    from cols c where c.t in ('collaborators','audit_events') and c.dflt ~* 'nextval'
    union all
    select 6100, 'INFO anon / authenticated hold INSERT on collaborators / audit_events (row level security decides what they may do; this migration changes nothing here)', 'INFO',
           coalesce((select string_agg(x.role || ' ' || x.t, ', ' order by x.role, x.t) from (
                       select ro.role, tb.t from (values ('anon'), ('authenticated')) ro(role) cross join (values ('collaborators'), ('audit_events')) tb(t)
                       where to_regclass('public.' || tb.t) is not null and has_table_privilege(ro.role, 'public.' || tb.t, 'INSERT')) x), 'none')
    -- ===================================================== 7xxx migration history ============================================================================
    union all
    select 7000, 'INFO supabase_migrations.schema_migrations readable by this session', 'INFO', (select readable::text from hist)
    union all
    select 7010, 'INFO registered migrations (count) / last 8 versions', 'INFO', coalesce((select n_total from hist), 'n/a') || ' / ' || coalesce((select last8 from hist), 'n/a')
    union all
    select 7020, 'GATE 20261111000001 is NOT yet registered', case when (select n_this from hist) is null then 'FAIL' when (select n_this from hist)::int = 0 then 'PASS' else 'FAIL' end, coalesce((select n_this from hist), 'history not readable')
    union all
    select 7021, 'GATE prerequisite 20261109000001 (global partner network) IS registered', case when (select n_prereq from hist) is null then 'FAIL' when (select n_prereq from hist)::int = 1 then 'PASS' else 'FAIL' end, coalesce((select n_prereq from hist), 'history not readable')
    union all
    select 7022, 'GATE no migration with a LATER version is registered (no out-of-order apply)', case when (select n_later from hist) is null then 'FAIL' when (select n_later from hist)::int = 0 then 'PASS' else 'FAIL' end, coalesce((select n_later from hist), 'history not readable')
    -- ===================================================== 8xxx data shape (aggregates only) ===================================================================
    union all
    select 8000, 'INFO collaborators: rows / by status', 'INFO',
           (select count(*) from public.collaborators)::text || ' / ' || coalesce((select string_agg(coalesce(collaborators_status, 'null') || '=' || n, ', ' order by collaborators_status) from (select collaborators_status, count(*) n from public.collaborators group by 1) s), 'none')
    union all
    select 8010, 'INFO collaborators with the Members code shape COL+7 hex (expected 0 while nobody has used Merchant Members)', 'INFO', (select count(*) from public.collaborators where collaborators_code ~ '^COL[0-9A-F]{7}$')::text
    union all
    select 8020, 'INFO collaborators: groups of rows sharing a case-insensitive e-mail / rows in them (expected 3 / 6 at 2026-11-11T02:31Z; these block a unique index and are NOT touched)', 'INFO',
           (select count(*) from (select 1 from public.collaborators where collaborators_email is not null group by lower(collaborators_email) having count(*) > 1) g)::text || ' / '
           || coalesce((select sum(n) from (select count(*) n from public.collaborators where collaborators_email is not null group by lower(collaborators_email) having count(*) > 1) g), 0)::text
    union all
    select 8030, 'GATE collaborators: no duplicate collaborators_code (the API retries a generated code on a clash)', case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*)::text || ' duplicate code(s)'
    from (select 1 from public.collaborators where collaborators_code is not null group by collaborators_code having count(*) > 1) d
    union all
    select 8040, 'INFO audit_events: rows / creation events (expected 0) / reconciliation events from the withdrawn design (expected 0)', 'INFO',
           (select count(*) from public.audit_events)::text || ' / ' || (select count(*) from public.audit_events where action = 'collaborator.member_application_created')::text
           || ' / ' || (select count(*) from public.audit_events where action = 'collaborator.member_application_audit_reconciled')::text
    union all
    select 8050, 'INFO the one pending row that shares an e-mail with an active Partner (COL-05C60E056C3D4B5B): present / status / verified / audit events for it', 'INFO',
           coalesce((select 'present / ' || coalesce(c.collaborators_status, 'null') || ' / ' || coalesce(c.collaborators_verified::text, 'null') || ' / ' || (select count(*) from public.audit_events a where a.entity_id = c.id::text)::text
                     from public.collaborators c where c.collaborators_code = 'COL-05C60E056C3D4B5B'), 'absent')
    -- ===================================================== 9xxx digests (before / after comparison) =============================================================
    union all
    select 9000, 'INFO digest collaborators (rows / md5 of all rows): record BEFORE and AFTER the migration', 'INFO',
           (select count(*) from public.collaborators)::text || ' / ' || (select md5(coalesce(string_agg(md5(c::text), '' order by c.id), '')) from public.collaborators c)
    union all
    select 9010, 'INFO digest audit_events (rows / md5 of id+action+entity_id): record BEFORE and AFTER the migration', 'INFO',
           (select count(*) from public.audit_events)::text || ' / ' || (select md5(coalesce(string_agg(a.id::text || ':' || a.action || ':' || coalesce(a.entity_id, ''), ',' order by a.id), '')) from public.audit_events a)
  )
select lpad(ord::text, 4, '0') || '|' || label || '|' || verdict || '|' || replace(replace(coalesce(detail, ''), E'\n', ' '), '|', '¦') from checks
union all
select '9999|SUMMARY|' || count(*) filter (where verdict = 'PASS') || '|' || count(*) filter (where verdict = 'FAIL') || '|' || count(*) filter (where verdict = 'INFO') from checks
order by 1;

rollback;
