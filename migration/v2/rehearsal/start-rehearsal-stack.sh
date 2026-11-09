#!/usr/bin/env bash
# Disposable local rehearsal stack for migrations that touch the transaction functions: Postgres 17 (Supabase image) + PostgREST v14.5.
#   Postgres :54999 (container vno-rehearsal-pg)   PostgREST :54998 (container vno-rehearsal-rest)
# It applies the rehearsal baseline and EVERY migration in supabase/migrations except the ones named in SKIP (default: none), in order.
# Never touches hosted UAT. Remove with: docker rm -f vno-rehearsal-pg vno-rehearsal-rest
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
SKIP="${SKIP:-}"                                  # e.g. SKIP="20261109000001" to stop BEFORE the migration under test
PG=vno-rehearsal-pg; REST=vno-rehearsal-rest
docker rm -f $PG $REST >/dev/null 2>&1 || true
docker run -d --name $PG -e POSTGRES_PASSWORD=rehearsal -p 54999:5432 public.ecr.aws/supabase/postgres:17.6.1.131 >/dev/null
for _ in $(seq 1 40); do docker exec $PG pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 2; done
psql_pg() { docker exec -i $PG psql -U postgres -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql_admin() { docker exec -i $PG psql -U supabase_admin -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql_pg < migration/v2/rehearsal/00000000000000_vno_rehearsal_baseline.sql
# the Storage service owns storage.*; a bare Postgres needs the one table the D2 migration inserts into
psql_admin -c "create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]); grant all on storage.buckets to postgres;"
for f in $(ls supabase/migrations/*.sql | sort); do
  b=$(basename "$f"); skip=0; for s in $SKIP; do case "$b" in "$s"*) skip=1;; esac; done; [ $skip = 1 ] && { echo "skip $b"; continue; }
  # the baseline is a reconstruction: the pre-D14 payment_status constraint (named in the D14 patch's UNDO note) is not in it
  case "$b" in 20261105000002*) psql_pg -c "alter table public.referral_transactions add constraint referral_transactions_payment_status_ck check (payment_status = any (array['unverified','unpaid','partially_paid','paid','disputed']));" ;; esac
  psql_pg < "$f"; echo "ok $b"
done
psql_admin -c "alter role authenticator with password 'rehearsal';"
docker run -d --name $REST -p 54998:3000 -e PGRST_DB_URI='postgres://authenticator:rehearsal@host.docker.internal:54999/postgres' -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET='rehearsal-jwt-secret-0123456789-abcdefghij' -e PGRST_SERVER_PORT=3000 public.ecr.aws/supabase/postgrest:v14.5 >/dev/null
sleep 4; echo "rehearsal stack ready: Postgres :54999, PostgREST :54998"
