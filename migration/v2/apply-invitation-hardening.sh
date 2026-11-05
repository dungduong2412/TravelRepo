#!/usr/bin/env bash
# Applies EXACTLY ONE migration (supabase/migrations/20261102000001_vno_invitation_link_hardening.sql) to the approved UAT project,
# in a single transaction, and registers it in supabase_migrations.schema_migrations the way `supabase migration up` does.
#
#   apply-invitation-hardening.sh dry-run                   # runs everything, then aborts the transaction on purpose (nothing persists)
#   apply-invitation-hardening.sh apply <expected-sha256>   # same, but commits; refuses unless the migration file hash equals <expected-sha256>
#
# Transport (env VNO_TRANSPORT): "api" (default) = `supabase db query --linked` (Management API over HTTPS, uses the owner's CLI login);
#                                "psql" = direct Postgres (PG* env, or the linked pooler + SUPABASE_DB_PASSWORD). Never `db push`.
# Any failed assertion aborts and rolls back. Production is refused (only the approved UAT project ref is accepted).
set -euo pipefail
MODE="${1:-}"; EXPECT="${2:-}"
[[ "$MODE" == "dry-run" || ( "$MODE" == "apply" && -n "$EXPECT" ) ]] || { echo "usage: $0 dry-run | apply <expected-sha256-of-migration-file>" >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION=20261102000001; NAME=vno_invitation_link_hardening
FILE="$ROOT/supabase/migrations/${VERSION}_${NAME}.sql"
UAT_REF=hsezyogfxgnkpweoqqny
TRANSPORT="${VNO_TRANSPORT:-api}"
[[ -f "$FILE" ]] || { echo "missing $FILE" >&2; exit 2; }
SHA="$(shasum -a 256 "$FILE" | cut -c1-64)"
echo "migration file sha256: $SHA"
if [[ "$MODE" == "apply" && "$SHA" != "$EXPECT" ]]; then echo "refusing: file hash does not match the reviewed hash" >&2; exit 2; fi
grep -q 'vno_mig' "$FILE" && { echo "refusing: migration text contains the reserved quote tag" >&2; exit 2; }

HOSTED=1; [[ -n "${PGHOST:-}" && "$TRANSPORT" == "psql" ]] && HOSTED=0   # explicit PGHOST + psql = local/scratch target
if [[ "$HOSTED" == 1 ]]; then
  [[ "$(tr -d '[:space:]' < "$ROOT/supabase/.temp/project-ref")" == "$UAT_REF" ]] || { echo "refusing: linked project is not the approved UAT project" >&2; exit 2; }
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
SQLF="$TMP/apply.sql"
{
sed -e "s/__VERSION__/$VERSION/g" -e "s/__NAME__/$NAME/g" <<'SQL'
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = pg_catalog, public;
create temp table _log (n serial, msg text);

-- ---------- 1. preflight (any failure aborts) ----------
do $$ begin
  if current_setting('server_version_num')::int < 140000 then raise exception 'PRECHECK: unexpected server version'; end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '__VERSION__') then raise exception 'PRECHECK: __VERSION__ is already registered'; end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261031000001') then raise exception 'PRECHECK: prerequisite 20261031000001 (invitations) is not registered'; end if;
  if (select max(version) from supabase_migrations.schema_migrations) > '__VERSION__' then raise exception 'PRECHECK: a newer migration is already registered; refusing out-of-order apply'; end if;
  if to_regclass('public.invitations') is null then raise exception 'PRECHECK: public.invitations is missing'; end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.invitations'::regclass and not tgisinternal) then raise exception 'PRECHECK: unexpected trigger on invitations (could touch other tables)'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.invitations'::regclass) then raise exception 'PRECHECK: RLS is not enabled on invitations'; end if;
end $$;

-- fingerprints (count + content hash) of EVERY other public table, and of the invitation rows with invite_link excluded
create temp table _pre_tables as
select c.relname as t,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text::bigint as n,
       (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(x::text, %L order by x::text), %L)) as h from public.%I x', '', '', c.relname), false, true, '')))[1]::text as h
from pg_class c join pg_namespace s on s.oid = c.relnamespace
where s.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'invitations';
create temp table _pre_inv as select id, to_jsonb(i) - 'invite_link' as rest, (invite_link is not null) as had_link from public.invitations i;
create temp table _pre_misc as select
  (select count(*) from auth.users) as auth_users, (select count(*) from storage.objects) as objects,
  (select count(*) from public.legacy_identity_map) as idmap,
  (select string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'invitations') as grants,
  (select string_agg(policyname || ':' || roles::text || ':' || cmd, ',' order by policyname) from pg_policies where tablename = 'invitations') as policies,
  (select string_agg(indexname, ',' order by indexname) from pg_indexes where tablename = 'invitations') as idx;
insert into _log(msg) select 'BEFORE invitations total=' || count(*) || ' with_stored_link=' || count(*) filter (where had_link) || ' by_status: ' ||
       coalesce((select string_agg(s || '=' || n, ' ') from (select (rest->>'status') s, count(*) n from _pre_inv group by 1 order by 1) q), '') from _pre_inv;
insert into _log(msg) select 'BEFORE other public tables fingerprinted: ' || count(*) || ' (rows ' || coalesce(sum(n), 0) || '); auth.users=' || (select auth_users from _pre_misc) || ' storage.objects=' || (select objects from _pre_misc) || ' legacy_identity_map=' || (select idmap from _pre_misc) from _pre_tables;
insert into _log(msg) select 'BEFORE rls=on grants[' || (select grants from _pre_misc) || '] policies[' || (select policies from _pre_misc) || ']';

-- ---------- 2. the single approved migration, verbatim ----------
SQL
cat "$FILE"; printf '\n'
sed -e "s/__VERSION__/$VERSION/g" -e "s/__NAME__/$NAME/g" <<'SQL'

-- ---------- 3. history registration (same shape `supabase migration up` writes) ----------
insert into supabase_migrations.schema_migrations (version, name, statements) values ('__VERSION__', '__NAME__', array[
SQL
printf '$vno_mig$%s$vno_mig$' "$(cat "$FILE")"
sed -e "s/__VERSION__/$VERSION/g" -e "s/__NAME__/$NAME/g" -e "s/__MODE__/$MODE/g" <<'SQL'
]);

-- ---------- 4. post-conditions (any failure aborts and rolls back) ----------
do $$
declare bad text;
begin
  if exists (select 1 from public.invitations where invite_link is not null) then raise exception 'POST: stored invitation links remain'; end if;
  if (select count(*) from public.invitations) <> (select count(*) from _pre_inv) then raise exception 'POST: invitation row count changed'; end if;
  if exists (select 1 from public.invitations i join _pre_inv p using (id) where to_jsonb(i) - 'invite_link' is distinct from p.rest) then raise exception 'POST: a non-link invitation column changed'; end if;
  select string_agg(p.t, ',') into bad from _pre_tables p
   where (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', p.t), false, true, '')))[1]::text::bigint is distinct from p.n
      or (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(x::text, %L order by x::text), %L)) as h from public.%I x', '', '', p.t), false, true, '')))[1]::text is distinct from p.h;
  if bad is not null then raise exception 'POST: tables changed: %', bad; end if;
  if (select auth_users from _pre_misc) <> (select count(*) from auth.users) or (select objects from _pre_misc) <> (select count(*) from storage.objects) or (select idmap from _pre_misc) <> (select count(*) from public.legacy_identity_map) then raise exception 'POST: auth.users, storage.objects or legacy_identity_map count changed'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.invitations'::regclass) then raise exception 'POST: RLS disabled'; end if;
  if (select grants from _pre_misc) is distinct from (select string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'invitations') then raise exception 'POST: grants changed'; end if;
  if (select policies from _pre_misc) is distinct from (select string_agg(policyname || ':' || roles::text || ':' || cmd, ',' order by policyname) from pg_policies where tablename = 'invitations') then raise exception 'POST: policies changed'; end if;
  if (select idx from _pre_misc) is distinct from (select string_agg(indexname, ',' order by indexname) from pg_indexes where tablename = 'invitations') then raise exception 'POST: indexes changed'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'invitations' and grantee in ('anon', 'authenticated', 'PUBLIC')) then raise exception 'POST: client roles hold privileges on invitations'; end if;
  if (select count(*) from supabase_migrations.schema_migrations where version = '__VERSION__') <> 1 then raise exception 'POST: history row count <> 1'; end if;
  if col_description('public.invitations'::regclass, (select attnum from pg_attribute where attrelid = 'public.invitations'::regclass and attname = 'invite_link')) not like 'Deprecated: always NULL%' then raise exception 'POST: column comment missing'; end if;
end $$;
insert into _log(msg) select 'AFTER  invite_link non-null=' || count(*) filter (where invite_link is not null) || ' invitations=' || count(*) from public.invitations;
insert into _log(msg) select 'AFTER  history rows for __VERSION__ = ' || count(*) || ', latest = ' || (select max(version) from supabase_migrations.schema_migrations) from supabase_migrations.schema_migrations where version = '__VERSION__';
insert into _log(msg) values ('ALL ASSERTIONS PASSED (invitation rows/columns, 100% of other public tables by count+hash, auth.users, storage.objects, legacy_identity_map, RLS, grants, policies, indexes, history)');
SQL
if [[ "$MODE" == "dry-run" ]]; then
cat <<'SQL'
do $$ begin raise exception E'DRY-RUN OK (transaction aborted on purpose; nothing persisted)\n%', (select string_agg(msg, E'\n' order by n) from _log); end $$;
SQL
else
cat <<'SQL'
select msg from _log order by n;
SQL
fi
} > "$SQLF"

echo "mode=$MODE transport=$TRANSPORT target=$([[ $HOSTED == 1 ]] && echo "UAT $UAT_REF" || echo "explicit PG* (non-hosted)")"
OUT="$TMP/out.txt"
if [[ "$TRANSPORT" == "api" ]]; then
  [[ "$HOSTED" == 1 ]] || { echo "api transport is hosted only" >&2; exit 2; }
  supabase db query --linked -o json -f "$SQLF" > "$OUT" 2>&1 || true
else
  if [[ "$HOSTED" == 1 ]]; then   # direct psql to the linked pooler
    : "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD must be exported in this shell}"
    URL="$(tr -d '[:space:]' < "$ROOT/supabase/.temp/pooler-url")"; HP="${URL#*@}"; export PGHOST="${HP%%[:/]*}"; PP="${HP#*:}"; export PGPORT="${PP%%/*}"
    UP="${URL#*://}"; export PGUSER="${UP%%[:@]*}" PGDATABASE=postgres PGSSLMODE=require PGCONNECT_TIMEOUT=20
    PGPASSWORD="$SUPABASE_DB_PASSWORD"; export PGPASSWORD
    [[ "$PGUSER" == *".$UAT_REF" ]] || { echo "refusing: pooler user does not belong to the UAT project" >&2; exit 2; }
  fi
  psql -X -q -At -v ON_ERROR_STOP=1 --single-transaction -f "$SQLF" > "$OUT" 2>&1 || true
fi
grep -v -E 'new version of Supabase CLI|We recommend updating' "$OUT" | sed -e 's/\\n/\n/g' -e 's/\\u003c/</g; s/\\u003e/>/g'
if [[ "$MODE" == "dry-run" ]]; then grep -q 'DRY-RUN OK' "$OUT" && { echo "RESULT: DRY-RUN PASS (nothing persisted)"; exit 0; }
else grep -q 'ALL ASSERTIONS PASSED' "$OUT" && ! grep -q -E 'ERROR|"message"' "$OUT" && { echo "RESULT: APPLIED"; exit 0; }; fi
echo "RESULT: FAIL (transaction rolled back; see message above)"; exit 1
