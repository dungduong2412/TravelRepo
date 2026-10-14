#!/usr/bin/env python3
"""Seal and reconcile a completed VNO V1 tenant snapshot.

Sensitive source identifiers remain in private snapshot artifacts. Standard
output contains aggregate controls only.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import decimal
import hashlib
import json
import os
import platform
import stat
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

import pymssql

import extract_v1_tenant as base


BASELINE = {
    "merchants": 148,
    "collaborators": 270,
    "transactions": 102,
    "category_links": 272,
    "update_requests": 38,
    "merchant_image_references": 432,
    "document_total": "377705162.0000",
    "discount_total": "24077880.8000",
    "commission_total": "27466958.1000",
    "media_files": 618,
    "media_bytes": 416329553,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True)
    parser.add_argument("--ssh-port", type=int, default=2233)
    parser.add_argument("--ssh-user", default="ubuntu")
    parser.add_argument("--ssh-key", type=Path, required=True)
    parser.add_argument("--remote-sql-port", type=int, default=1434)
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--sample", type=Path, required=True)
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle]


def table(snapshot: Path, database: str, name: str) -> list[dict[str, Any]]:
    return read_jsonl(snapshot / "tables" / database / f"dbo.{name}.jsonl")


def money(value: decimal.Decimal | None) -> str:
    return str((value or decimal.Decimal(0)).quantize(decimal.Decimal("0.0001")))


def q_one(connection, sql: str, params: tuple[Any, ...]) -> tuple[Any, ...]:
    cursor = connection.cursor()
    cursor.execute(sql, params)
    row = cursor.fetchone()
    if row is None:
        raise RuntimeError("Expected one aggregate row")
    return tuple(row)


def snapshot_metrics(snapshot: Path) -> tuple[dict[str, Any], dict[str, set[str]]]:
    restaurants = table(snapshot, "Emos_MdmService", "Restaurant")
    collaborators = table(snapshot, "Emos_MdmService", "RestaurantMiddleman")
    transactions = table(snapshot, "Emos_MdmService", "RestaurantComTrack")
    links = table(snapshot, "Emos_MdmService", "RestaurantCategoryMap")
    updates = table(snapshot, "Emos_MdmService", "MerchantUpdateRequests")
    images = table(snapshot, "Emos_MdmService", "MerchantImages")
    categories = table(snapshot, "Emos_MdmService", "RestaurantCategory")
    mdm_blobs = table(snapshot, "Emos_MdmService", "AbpBlobs")
    cms_blobs = table(snapshot, "Emos_Cms", "AbpBlobs")
    numbering_configs = table(snapshot, "Emos_MdmService", "NumberingConfigs")
    numbering_details = table(snapshot, "Emos_MdmService", "NumberingConfigDetails")
    numbering_defs = table(snapshot, "Emos_MdmService", "NumberingTypeDefinition")
    feature_values = table(snapshot, "Emos_Administration", "AbpFeatureValues")

    restaurant_ids = {str(r["Id"]).lower() for r in restaurants}
    collaborator_ids = {str(r["Id"]).lower() for r in collaborators}
    category_ids = {str(r["Id"]).lower() for r in categories}
    merchant_names = {str(r["ImageId"]).lower() for r in images}
    partner_names = {
        str(r["Image"]).lower() for r in collaborators if r.get("Image") is not None
    }
    mdm_by_name = {str(r["Name"]).lower(): r for r in mdm_blobs}
    referenced_names = merchant_names | partner_names

    def blob_bytes(row: dict[str, Any]) -> int:
        return int(row["Content"]["bytes"])

    metrics = {
        "merchants": len(restaurants),
        "collaborators": len(collaborators),
        "transactions": len(transactions),
        "category_links": len(links),
        "update_requests": len(updates),
        "merchant_image_references": len(images),
        "document_total": money(sum((decimal.Decimal(str(r["DocTotal"])) for r in transactions), decimal.Decimal(0))),
        "discount_total": money(sum((decimal.Decimal(str(r["DocDiscountAmt"])) for r in transactions), decimal.Decimal(0))),
        "commission_total": money(sum((decimal.Decimal(str(r["CommissionAmt"])) for r in transactions), decimal.Decimal(0))),
        "missing_restaurant_links": sum(1 for r in transactions if str(r["RestaurantId"]).lower() not in restaurant_ids),
        "missing_collaborator_links": sum(1 for r in transactions if r.get("MiddlemanId") is not None and str(r["MiddlemanId"]).lower() not in collaborator_ids),
        "category_link_missing_merchant": sum(1 for r in links if str(r["ResId"]).lower() not in restaurant_ids),
        "category_link_missing_category": sum(1 for r in links if str(r["ResCatId"]).lower() not in category_ids),
        "update_request_missing_merchant": sum(1 for r in updates if str(r["MerchantId"]).lower() not in restaurant_ids),
        "merchant_missing_blobs": sum(1 for name in merchant_names if name not in mdm_by_name),
        "partner_image_references": len(partner_names),
        "partner_missing_blobs": sum(1 for name in partner_names if name not in mdm_by_name),
        "mdm_blob_files": len(mdm_blobs),
        "mdm_blob_bytes": sum(blob_bytes(r) for r in mdm_blobs),
        "referenced_mdm_blob_files": sum(1 for name in mdm_by_name if name in referenced_names),
        "referenced_mdm_blob_bytes": sum(blob_bytes(row) for name, row in mdm_by_name.items() if name in referenced_names),
        "unreferenced_mdm_blob_files": sum(1 for name in mdm_by_name if name not in referenced_names),
        "unreferenced_mdm_blob_bytes": sum(blob_bytes(row) for name, row in mdm_by_name.items() if name not in referenced_names),
        "cms_blob_files": len(cms_blobs),
        "cms_blob_bytes": sum(blob_bytes(r) for r in cms_blobs),
        "media_files": len(mdm_blobs) + len(cms_blobs),
        "media_bytes": sum(blob_bytes(r) for r in mdm_blobs + cms_blobs),
        "numbering_configs": len(numbering_configs),
        "numbering_details": len(numbering_details),
        "numbering_definitions": len(numbering_defs),
        "numbering_detail_orphans": sum(
            1 for r in numbering_details
            if str(r["NumberingConfigId"]).lower()
            not in {str(c["Id"]).lower() for c in numbering_configs}
        ),
        "feature_values": len(feature_values),
    }
    sets = {
        "merchant_names": merchant_names,
        "partner_names": partner_names,
        "referenced_names": referenced_names,
    }
    return metrics, sets


def live_metrics(args: argparse.Namespace, port: int, password: str, tenant: str) -> tuple[dict[str, Any], dict[str, str]]:
    version: dict[str, str] = {}
    metrics: dict[str, Any] = {}
    with base.connect(port, password, "Emos_MdmService") as c:
        started, product_version, edition = q_one(
            c, "SELECT SYSUTCDATETIME(), CONVERT(nvarchar(50), SERVERPROPERTY('ProductVersion')), CONVERT(nvarchar(100), SERVERPROPERTY('Edition'))", (),
        )
        version = {"product_version": str(product_version), "edition": str(edition)}
        metrics["control_started_utc"] = started.isoformat()
        count_tables = {
            "merchants": "Restaurant",
            "collaborators": "RestaurantMiddleman",
            "transactions": "RestaurantComTrack",
            "category_links": "RestaurantCategoryMap",
            "update_requests": "MerchantUpdateRequests",
            "numbering_configs": "NumberingConfigs",
            "numbering_details": "NumberingConfigDetails",
        }
        for key, name in count_tables.items():
            metrics[key] = int(q_one(c, f"SELECT COUNT_BIG(*) FROM dbo.[{name}] WHERE TenantId=%s", (tenant,))[0])
        metrics["merchant_image_references"] = int(q_one(c, """
            SELECT COUNT_BIG(*) FROM dbo.MerchantImages mi
            JOIN dbo.Restaurant r ON r.Id=mi.ResId WHERE r.TenantId=%s
        """, (tenant,))[0])
        fin = q_one(c, """
            SELECT SUM(CONVERT(decimal(38,4),DocTotal)),
                   SUM(CONVERT(decimal(38,4),DocDiscountAmt)),
                   SUM(CONVERT(decimal(38,4),CommissionAmt))
            FROM dbo.RestaurantComTrack WHERE TenantId=%s
        """, (tenant,))
        metrics.update(document_total=money(fin[0]), discount_total=money(fin[1]), commission_total=money(fin[2]))
        orphan = q_one(c, """
            SELECT SUM(CASE WHEN r.Id IS NULL THEN CONVERT(bigint,1) ELSE 0 END),
                   SUM(CASE WHEN ct.MiddlemanId IS NOT NULL AND rm.Id IS NULL THEN CONVERT(bigint,1) ELSE 0 END)
            FROM dbo.RestaurantComTrack ct
            LEFT JOIN dbo.Restaurant r ON r.Id=ct.RestaurantId
            LEFT JOIN dbo.RestaurantMiddleman rm ON rm.Id=ct.MiddlemanId
            WHERE ct.TenantId=%s
        """, (tenant,))
        metrics["missing_restaurant_links"] = int(orphan[0] or 0)
        metrics["missing_collaborator_links"] = int(orphan[1] or 0)
        media = q_one(c, """
            WITH UsedNames AS (
              SELECT CONVERT(nvarchar(36),mi.ImageId) n FROM dbo.MerchantImages mi
              JOIN dbo.Restaurant r ON r.Id=mi.ResId WHERE r.TenantId=%s
              UNION SELECT CONVERT(nvarchar(36),rm.Image) FROM dbo.RestaurantMiddleman rm
              WHERE rm.TenantId=%s AND rm.Image IS NOT NULL
            )
            SELECT COUNT_BIG(*), SUM(CONVERT(bigint,DATALENGTH(b.Content))),
                   SUM(CASE WHEN u.n IS NOT NULL THEN CONVERT(bigint,1) ELSE 0 END),
                   SUM(CASE WHEN u.n IS NOT NULL THEN CONVERT(bigint,DATALENGTH(b.Content)) ELSE 0 END),
                   SUM(CASE WHEN u.n IS NULL THEN CONVERT(bigint,1) ELSE 0 END),
                   SUM(CASE WHEN u.n IS NULL THEN CONVERT(bigint,DATALENGTH(b.Content)) ELSE 0 END)
            FROM dbo.AbpBlobs b LEFT JOIN UsedNames u ON u.n=b.Name WHERE b.TenantId=%s
        """, (tenant, tenant, tenant))
        for key, value in zip(("mdm_blob_files", "mdm_blob_bytes", "referenced_mdm_blob_files", "referenced_mdm_blob_bytes", "unreferenced_mdm_blob_files", "unreferenced_mdm_blob_bytes"), media):
            metrics[key] = int(value or 0)
        metrics["partner_image_references"] = int(q_one(c, "SELECT COUNT_BIG(DISTINCT Image) FROM dbo.RestaurantMiddleman WHERE TenantId=%s AND Image IS NOT NULL", (tenant,))[0])
        metrics["numbering_definitions"] = int(q_one(c, """
            SELECT COUNT_BIG(DISTINCT d.Id) FROM dbo.NumberingTypeDefinition d
            JOIN dbo.NumberingConfigs n ON n.NumberingTypeDefinitionId=d.Id AND n.TenantId=%s
        """, (tenant,))[0])
        metrics["control_completed_utc"] = q_one(c, "SELECT SYSUTCDATETIME()", ())[0].isoformat()
    with base.connect(port, password, "Emos_Cms") as c:
        cms = q_one(c, "SELECT COUNT_BIG(*), SUM(CONVERT(bigint,DATALENGTH(Content))) FROM dbo.AbpBlobs WHERE TenantId=%s", (tenant,))
        metrics["cms_blob_files"] = int(cms[0])
        metrics["cms_blob_bytes"] = int(cms[1] or 0)
    metrics["media_files"] = metrics["mdm_blob_files"] + metrics["cms_blob_files"]
    metrics["media_bytes"] = metrics["mdm_blob_bytes"] + metrics["cms_blob_bytes"]
    with base.connect(port, password, "Emos_Administration") as c:
        metrics["feature_values"] = int(q_one(c, "SELECT COUNT_BIG(*) FROM dbo.AbpFeatureValues WHERE ProviderName=N'T' AND TRY_CONVERT(uniqueidentifier,ProviderKey)=%s", (tenant,))[0])
        settings = q_one(c, """
            SELECT COUNT_BIG(*), SUM(CASE WHEN Value IN (N'Vietnam Number One',N'VN Number One',N'VNO') THEN CONVERT(bigint,1) ELSE 0 END)
            FROM dbo.AbpSettings WHERE ProviderName=N'T' AND TRY_CONVERT(uniqueidentifier,ProviderKey)=%s
        """, (tenant,))
        metrics["tenant_settings"] = int(settings[0])
        metrics["verified_brand_values"] = int(settings[1] or 0)
    with base.connect(port, password, "Emos_Saas") as c:
        metrics["tenant_registry_rows"] = int(q_one(c, "SELECT COUNT_BIG(*) FROM dbo.SaasTenants WHERE Id=%s", (tenant,))[0])
    return metrics, version


def write_media_report(snapshot: Path, sets: dict[str, set[str]]) -> tuple[Path, dict[str, int]]:
    target = snapshot / "media-checksums.csv"
    mime_counts: dict[str, int] = {}
    with base.private_open(target, "w") as handle:
        writer = csv.writer(handle)
        writer.writerow(("database", "provenance", "source_id", "source_name", "bytes", "sha256", "signature_hex", "detected_mime", "relative_file"))
        for database in ("Emos_MdmService", "Emos_Cms"):
            for row in table(snapshot, database, "AbpBlobs"):
                content = row["Content"]
                rel = str(content["$blob_file"])
                path = snapshot / rel
                name = str(row["Name"]).lower()
                if database == "Emos_Cms":
                    provenance = "cms"
                elif name in sets["merchant_names"] and name in sets["partner_names"]:
                    provenance = "merchant+partner"
                elif name in sets["merchant_names"]:
                    provenance = "merchant"
                elif name in sets["partner_names"]:
                    provenance = "partner"
                else:
                    provenance = "unreferenced"
                mime = subprocess.run(
                    ["/usr/bin/file", "--brief", "--mime-type", str(path)],
                    check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                ).stdout.strip()
                mime_counts[mime] = mime_counts.get(mime, 0) + 1
                with open(path, "rb") as raw:
                    signature = raw.read(16).hex()
                writer.writerow((database, provenance, row["Id"], row["Name"], content["bytes"], content["sha256"], signature, mime, rel))
    return target, mime_counts


def write_file_manifest(snapshot: Path) -> tuple[Path, str, int]:
    target = snapshot / "files.sha256"
    paths = sorted(
        p for p in snapshot.rglob("*")
        if p.is_file() and p.name not in {"files.sha256", "acceptance-manifest.json", "acceptance-manifest.sha256"}
    )
    with base.private_open(target, "w") as handle:
        for path in paths:
            handle.write(f"{base.sha256_file(path)}  {path.relative_to(snapshot)}\n")
    return target, base.sha256_file(target), len(paths)


def main() -> int:
    args = parse_args()
    snapshot = args.snapshot.resolve()
    tenant = str(uuid.UUID(args.tenant_id))
    status = json.loads((snapshot / "status.json").read_text())
    manifest_path = snapshot / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if status.get("status") != "complete" or status.get("manifest_sha256") != base.sha256_file(manifest_path):
        raise RuntimeError("Snapshot completion status or manifest hash is invalid")
    verification = base.verify_snapshot(snapshot, manifest)
    sample = json.loads((args.sample / "sample-manifest.json").read_text())
    if sample.get("total_files") != 100 or not sample.get("all_source_local_hashes_match"):
        raise RuntimeError("The bounded 100-blob sample is not accepted")

    snap, sets = snapshot_metrics(snapshot)
    media_report, mime_counts = write_media_report(snapshot, sets)
    password = base.read_password(args)
    port = base.free_local_port()
    tunnel = base.start_tunnel(args, port)
    try:
        base.wait_for_tunnel(tunnel, port)
        live, sql_version = live_metrics(args, port, password, tenant)
    finally:
        password = ""
        tunnel.terminate()
        try:
            tunnel.wait(timeout=5)
        except subprocess.TimeoutExpired:
            tunnel.kill()

    compare_keys = tuple(BASELINE) + (
        "missing_restaurant_links", "missing_collaborator_links",
        "mdm_blob_files", "mdm_blob_bytes", "referenced_mdm_blob_files",
        "referenced_mdm_blob_bytes", "unreferenced_mdm_blob_files",
        "unreferenced_mdm_blob_bytes", "cms_blob_files", "cms_blob_bytes",
        "partner_image_references", "numbering_configs", "numbering_details",
        "numbering_definitions", "feature_values",
    )
    source_snapshot_differences = {
        key: {"source": live.get(key), "snapshot": snap.get(key)}
        for key in compare_keys if live.get(key) != snap.get(key)
    }
    baseline_differences = {
        key: {"baseline": value, "source": live.get(key), "snapshot": snap.get(key)}
        for key, value in BASELINE.items()
        if live.get(key) != value or snap.get(key) != value
    }
    relationship_failures = {
        key: snap[key] for key in (
            "missing_collaborator_links", "category_link_missing_merchant",
            "category_link_missing_category", "update_request_missing_merchant",
            "merchant_missing_blobs", "partner_missing_blobs",
            "numbering_detail_orphans",
        ) if snap[key] != 0
    }
    expected_orphan_preserved = (
        live["missing_restaurant_links"] == 1
        and snap["missing_restaurant_links"] == 1
    )
    pass_status = (
        not source_snapshot_differences
        and not baseline_differences
        and not relationship_failures
        and expected_orphan_preserved
        and verification["blob_files"] == 618
        and verification["blob_bytes"] == 416329553
        and live["tenant_registry_rows"] == 1
        and live["verified_brand_values"] >= 3
    )

    file_manifest, file_manifest_hash, file_count = write_file_manifest(snapshot)
    acceptance = {
        "format": "vno-v1-phase-d1-acceptance-v1",
        "status": "PASS" if pass_status else "FAIL",
        "sealed_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "tenant_id": tenant,
        "source_control_window": {
            "started_utc": live["control_started_utc"],
            "completed_utc": live["control_completed_utc"],
        },
        "export_versions": {
            "snapshot_format": manifest["format"],
            "python": platform.python_version(),
            "pymssql": pymssql.__version__,
            "sql_server": sql_version,
            "extractor_sha256": base.sha256_file(Path(__file__).with_name("extract_v1_tenant.py")),
            "sample_validator_sha256": base.sha256_file(Path(__file__).with_name("validate_v1_media_sample.py")),
            "reconciler_sha256": base.sha256_file(Path(__file__)),
        },
        "snapshot_manifest": {
            "path": "manifest.json",
            "sha256": base.sha256_file(manifest_path),
            "table_files": verification["table_files"],
            "rows": verification["rows"],
        },
        "file_manifest": {"path": file_manifest.name, "sha256": file_manifest_hash, "files": file_count},
        "media_checksum_report": {"path": media_report.name, "sha256": base.sha256_file(media_report), "mime_counts": mime_counts},
        "sample_gate": {"files": 100, "bytes": sample["total_bytes"], "status": "PASS", "manifest_sha256": base.sha256_file(args.sample / "sample-manifest.json")},
        "phase_c_baseline": BASELINE,
        "source_metrics": live,
        "snapshot_metrics": snap,
        "baseline_differences": baseline_differences,
        "source_snapshot_differences": source_snapshot_differences,
        "relationship_failures": relationship_failures,
        "expected_missing_restaurant_relationship_preserved": expected_orphan_preserved,
        "verification": verification,
    }
    acceptance_path = snapshot / "acceptance-manifest.json"
    with base.private_open(acceptance_path, "w") as handle:
        json.dump(acceptance, handle, ensure_ascii=False, indent=2)
    digest = base.sha256_file(acceptance_path)
    digest_path = snapshot / "acceptance-manifest.sha256"
    with base.private_open(digest_path, "w") as handle:
        handle.write(f"{digest}  acceptance-manifest.json\n")
    os.chmod(acceptance_path, 0o400)
    os.chmod(digest_path, 0o400)
    print(json.dumps({
        "status": acceptance["status"],
        "snapshot_rows": verification["rows"],
        "media_files": snap["media_files"],
        "media_bytes": snap["media_bytes"],
        "baseline_differences": len(baseline_differences),
        "source_snapshot_differences": len(source_snapshot_differences),
        "relationship_failures": len(relationship_failures),
    }))
    return 0 if pass_status else 2


if __name__ == "__main__":
    sys.exit(main())
