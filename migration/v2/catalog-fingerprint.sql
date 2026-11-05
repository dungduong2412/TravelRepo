-- Read-only catalog fingerprint (no OIDs, no row data). Run on the source and on the restored target; sections must be identical.
select jsonb_pretty(jsonb_build_object(
  'extensions', (select coalesce(jsonb_agg(jsonb_build_object('name', e.extname, 'schema', n.nspname) order by e.extname), '[]') from pg_extension e join pg_namespace n on n.oid = e.extnamespace),
  'public_relations', (select coalesce(jsonb_agg(jsonb_build_object('name', c.relname, 'kind', c.relkind, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'owner', pg_get_userbyid(c.relowner), 'acl', c.relacl::text) order by c.relname), '[]')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'S')),
  'public_columns', (select coalesce(jsonb_agg(jsonb_build_object('t', table_name, 'c', column_name, 'type', data_type, 'udt', udt_name, 'null', is_nullable, 'default', column_default, 'len', character_maximum_length, 'prec', numeric_precision, 'scale', numeric_scale, 'identity', is_identity, 'generated', is_generated) order by table_name, ordinal_position), '[]')
    from information_schema.columns where table_schema = 'public'),
  'policies', (select coalesce(jsonb_agg(jsonb_build_object('schema', schemaname, 'table', tablename, 'name', policyname, 'permissive', permissive, 'roles', roles::text, 'cmd', cmd, 'qual', qual, 'check', with_check) order by schemaname, tablename, policyname), '[]')
    from pg_policies where schemaname in ('public', 'storage')),
  'constraints', (select coalesce(jsonb_agg(jsonb_build_object('t', c.conrelid::regclass::text, 'name', c.conname, 'type', c.contype, 'def', pg_get_constraintdef(c.oid)) order by c.conrelid::regclass::text, c.conname), '[]')
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public'),
  'indexes', (select coalesce(jsonb_agg(jsonb_build_object('t', tablename, 'name', indexname, 'def', indexdef) order by tablename, indexname), '[]') from pg_indexes where schemaname = 'public'),
  'triggers', (select coalesce(jsonb_agg(jsonb_build_object('t', c.relname, 'name', t.tgname, 'enabled', t.tgenabled, 'def', pg_get_triggerdef(t.oid)) order by c.relname, t.tgname), '[]')
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal),
  'functions', (select coalesce(jsonb_agg(jsonb_build_object('name', p.proname, 'args', pg_get_function_identity_arguments(p.oid), 'secdef', p.prosecdef, 'config', p.proconfig, 'acl', p.proacl::text, 'owner', pg_get_userbyid(p.proowner), 'def_md5', md5(pg_get_functiondef(p.oid))) order by p.proname, pg_get_function_identity_arguments(p.oid)), '[]')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f', 'p')),
  'view_defs', (select coalesce(jsonb_agg(jsonb_build_object('name', viewname, 'def_md5', md5(definition)) order by viewname), '[]') from pg_views where schemaname = 'public'),
  'default_privileges', (select coalesce(jsonb_agg(jsonb_build_object('role', pg_get_userbyid(d.defaclrole), 'schema', (select nspname from pg_namespace where oid = d.defaclnamespace), 'objtype', d.defaclobjtype, 'acl', d.defaclacl::text) order by pg_get_userbyid(d.defaclrole), d.defaclnamespace::regnamespace::text, d.defaclobjtype), '[]') from pg_default_acl d),
  'schema_acls_app', (select coalesce(jsonb_agg(jsonb_build_object('name', nspname, 'owner', pg_get_userbyid(nspowner), 'acl', nspacl::text) order by nspname), '[]') from pg_namespace where nspname in ('public', 'supabase_migrations')),
  'schema_acls_managed', (select coalesce(jsonb_agg(jsonb_build_object('name', nspname, 'owner', pg_get_userbyid(nspowner), 'acl', nspacl::text) order by nspname), '[]') from pg_namespace where nspname in ('auth', 'storage')),
  'auth_tables', (select coalesce(jsonb_agg(jsonb_build_object('t', table_name, 'c', column_name, 'type', udt_name) order by table_name, ordinal_position), '[]') from information_schema.columns where table_schema = 'auth'),
  'storage_buckets', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'public', public, 'limit', file_size_limit, 'mimes', allowed_mime_types) order by id), '[]') from storage.buckets),
  'roles', (select coalesce(jsonb_agg(jsonb_build_object('name', rolname, 'super', rolsuper, 'inherit', rolinherit, 'createrole', rolcreaterole, 'createdb', rolcreatedb, 'login', rolcanlogin, 'repl', rolreplication, 'bypassrls', rolbypassrls, 'connlimit', rolconnlimit) order by rolname), '[]')
    from pg_roles where rolname !~ '^pg_' and rolname not like 'cli_login_%'),
  'role_settings', (select coalesce(jsonb_agg(jsonb_build_object('role', coalesce(r.rolname, '<all>'), 'db', coalesce(d.datname, '<all>'), 'settings', s.setconfig) order by coalesce(r.rolname, ''), coalesce(d.datname, '')), '[]')
    from pg_db_role_setting s left join pg_roles r on r.oid = s.setrole left join pg_database d on d.oid = s.setdatabase)
));
