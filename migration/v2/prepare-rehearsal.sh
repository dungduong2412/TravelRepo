#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
rehearsal_root="${VNO_D2_REHEARSAL_DIR:-/Users/dungduongdinhquoc/Documents/VNO/phase-d2-20261013/rehearsal}"

install -d -m 0700 "$rehearsal_root/supabase/migrations"
install -m 0600 "$repo_root/migration/v2/rehearsal/config.toml" "$rehearsal_root/supabase/config.toml"
install -m 0600 "$repo_root/migration/v2/rehearsal/00000000000000_vno_rehearsal_baseline.sql" \
  "$rehearsal_root/supabase/migrations/00000000000000_vno_rehearsal_baseline.sql"
for migration in \
  20261011155533_vno_v1_phase2_schema_reconciliation.sql \
  20261011155535_vno_v1_remaining_additive_gaps.sql \
  20261011155725_vno_v1_advisor_repairs.sql \
  20261013090000_vno_phase_d2_import_readiness.sql \
  20261014080000_vno_phase_d2_fk_indexes.sql \
  20261016140546_vno_phase_d6_functional_parity.sql
do
  install -m 0600 "$repo_root/supabase/migrations/$migration" \
    "$rehearsal_root/supabase/migrations/$migration"
done

printf '%s\n' "$rehearsal_root"
