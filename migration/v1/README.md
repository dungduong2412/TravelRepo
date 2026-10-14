# VNO V1 read-only extraction kit

These scripts are inspection/export queries for the SQL Server 2022 source. They
do not modify V1. Run them only after setting `TenantId` to a tenant UUID proven
by the evidence query.

Order:

1. `sql/01_tenant_evidence.sql` — candidate tenant IDs and aggregate counts.
   Confirm the leading candidate with `sql/00b_tenant_brand_evidence.sql`.
2. Human verification of the VNO tenant name/domain and cross-database counts.
3. `sql/02_core_extract.sql` — tenant-scoped relational rows, including original
   numeric statuses and exact decimal amounts.
4. `sql/03_status_analysis.sql` — observed status values and non-semantic timing
   evidence. It deliberately does not infer payment state.
5. `sql/04_media_manifest.sql` — image/asset/blob/file-descriptor relationships.
6. `sql/05_tenant_archive_inventory.sql` — complete field manifest and tables
   that need relationship-based scoping.
7. `sql/06_validation_aggregates.sql` — counts, financial totals and orphan
   checks to compare after loading V2.
8. `sql/07_media_provenance_aggregates.sql` — FK evidence, blob ownership,
   descriptor counts and relationship anomalies without returning filenames.
9. `sql/08_image_id_resolution.sql` — aggregate-only discovery of undeclared
   image-ID relationships and ABP blob naming conventions.
10. `sql/09_partner_media_coverage.sql` — partner-avatar provenance and union
    coverage across all tenant-owned MDM blobs.
11. `sql/10_direct_tenant_table_counts.sql` — aggregate counts for all tables
    that carry `TenantId` directly.
12. `sql/11_relational_scope_counts.sql` — aggregate counts for child tables
    scoped through verified tenant relationships.
13. `sql/12_cms_blob_provenance.sql` — aggregate-only provenance for tenant CMS
    blobs and descriptor candidates.

`extract_v1_tenant.py` is the controlled local extractor. It opens an SSH
tunnel, keeps the SQL credential only in memory, and writes a mode-0700 local
staging directory outside Git. Row files and binary blobs are mode 0600. Exact
decimal, float, GUID, and SQL temporal representations are retained; blob bytes
are stored separately with SHA-256 hashes. It prints only aggregate completion
metadata.

`generate_field_matrix.py` converts the six-database schema inventory into the
complete CSV field-accountability matrix and a JSON control summary without
connecting to either database. It assigns every `COLUMN` record exactly once,
rejects duplicates/malformed records, makes core V2 mappings explicit, and
leaves unproven shared tables blocked rather than treating them as exclusions.

```sh
python3 migration/v1/generate_field_matrix.py \
  --inventory /absolute/path/to/vno_v1_schema_20261011_152737.txt \
  --output docs/V1_V2_FIELD_MATRIX.csv \
  --schema-object-output docs/V1_V2_SCHEMA_OBJECT_MATRIX.csv \
  --summary docs/V1_V2_FIELD_MATRIX_SUMMARY.json
```

When an earlier incomplete private staging directory contains downloaded blob
files, pass it with `--reuse-blobs-from`. Reuse is not trusted implicitly: SQL
Server recomputes `SHA2_256` and byte length for every source blob, and the
extractor compares those values before copying any blob into the new snapshot.

`validate_v1_media_sample.py` performs the deterministic 100-blob gate across
merchant, partner, unreferenced MDM, and CMS provenance. It compares
source-side and local SHA-256/length values and records byte signatures and
detected MIME types in a private manifest.

`reconcile_v1_snapshot.py` verifies a completed snapshot, creates the private
full media checksum report and flattened file manifest, reruns live aggregate
controls, and seals an acceptance manifest. A snapshot passes only when the
Phase C baseline, current source, snapshot rows, media, financial totals, and
relationship controls agree.

Example invocation inside the V1 SQL Server container:

```sh
export SQLCMDPASSWORD="$SA_PASSWORD"
/opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -C -b -W -w 65535 -s '|' \
  -v TenantId='<verified-tenant-uuid>' \
  -i /path/to/query.sql
```

Never put the SQL Server password in the command line. Redirect outputs to a
mode-0600 staging directory and encrypt them before transfer. Customer rows,
password hashes, bank details, and blob contents must not be printed to shared
logs.
