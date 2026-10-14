#!/usr/bin/env python3
"""Validate a deterministic 100-blob VNO sample without modifying V1.

The private manifest contains source IDs and file names. Standard output emits
aggregate control results only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import stat
import subprocess
import sys
import uuid
from pathlib import Path

import extract_v1_tenant as base


SAMPLE_PLAN = (
    ("merchant", "Emos_MdmService", 40),
    ("partner", "Emos_MdmService", 20),
    ("unreferenced", "Emos_MdmService", 33),
    ("cms", "Emos_Cms", 7),
)


def args_parser() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True)
    parser.add_argument("--ssh-port", type=int, default=2233)
    parser.add_argument("--ssh-user", default="ubuntu")
    parser.add_argument("--ssh-key", type=Path, required=True)
    parser.add_argument("--remote-sql-port", type=int, default=1434)
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def query_for(category: str, limit: int) -> str:
    common = f"""
      SELECT TOP ({limit}) b.Id, b.Name, b.ContainerId, b.Content,
             DATALENGTH(b.Content) AS SourceBytes,
             HASHBYTES('SHA2_256', b.Content) AS SourceSha256
      FROM dbo.AbpBlobs AS b
    """
    if category == "merchant":
        return common + """
          WHERE b.TenantId = %s AND EXISTS (
            SELECT 1 FROM dbo.MerchantImages mi
            JOIN dbo.Restaurant r ON r.Id = mi.ResId AND r.TenantId = %s
            WHERE CONVERT(nvarchar(36), mi.ImageId) = b.Name
          ) ORDER BY b.Id
        """
    if category == "partner":
        return common + """
          WHERE b.TenantId = %s AND EXISTS (
            SELECT 1 FROM dbo.RestaurantMiddleman rm
            WHERE rm.TenantId = %s AND CONVERT(nvarchar(36), rm.Image) = b.Name
          ) AND NOT EXISTS (
            SELECT 1 FROM dbo.MerchantImages mi
            JOIN dbo.Restaurant r ON r.Id = mi.ResId AND r.TenantId = %s
            WHERE CONVERT(nvarchar(36), mi.ImageId) = b.Name
          ) ORDER BY b.Id
        """
    if category == "unreferenced":
        return common + """
          WHERE b.TenantId = %s
            AND NOT EXISTS (
              SELECT 1 FROM dbo.MerchantImages mi
              JOIN dbo.Restaurant r ON r.Id = mi.ResId AND r.TenantId = %s
              WHERE CONVERT(nvarchar(36), mi.ImageId) = b.Name
            )
            AND NOT EXISTS (
              SELECT 1 FROM dbo.RestaurantMiddleman rm
              WHERE rm.TenantId = %s AND CONVERT(nvarchar(36), rm.Image) = b.Name
            ) ORDER BY b.Id
        """
    if category == "cms":
        return common + " WHERE b.TenantId = %s ORDER BY b.Id"
    raise ValueError(category)


def params_for(category: str, tenant_id: str) -> tuple[str, ...]:
    if category == "merchant":
        return (tenant_id, tenant_id)
    if category == "unreferenced":
        return (tenant_id, tenant_id, tenant_id)
    if category == "partner":
        return (tenant_id, tenant_id, tenant_id)
    return (tenant_id,)


def detected_mime(path: Path) -> str:
    result = subprocess.run(
        ["/usr/bin/file", "--brief", "--mime-type", str(path)],
        check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    return result.stdout.strip()


def main() -> int:
    args = args_parser()
    tenant_id = str(uuid.UUID(args.tenant_id))
    base.ensure_private_destination(args.output_dir, args.ssh_key)
    sample_dir = args.output_dir / "blobs"
    base.private_mkdir(sample_dir, args.output_dir)
    status_path = args.output_dir / "status.json"
    with base.private_open(status_path, "w") as handle:
        json.dump({"status": "incomplete"}, handle)

    password = base.read_password(args)
    local_port = base.free_local_port()
    tunnel = base.start_tunnel(args, local_port)
    records: list[dict[str, object]] = []
    try:
        base.wait_for_tunnel(tunnel, local_port)
        for category, database, expected_count in SAMPLE_PLAN:
            with base.connect(local_port, password, database) as connection:
                cursor = connection.cursor(as_dict=True)
                cursor.execute(query_for(category, expected_count), params_for(category, tenant_id))
                rows = list(cursor.fetchall())
                if len(rows) != expected_count:
                    raise RuntimeError(
                        f"Sample category {category} returned {len(rows)} rows; expected {expected_count}"
                    )
                category_dir = sample_dir / category
                base.private_mkdir(category_dir, args.output_dir)
                for row in rows:
                    content = bytes(row["Content"] or b"")
                    source_hash = bytes(row["SourceSha256"] or b"").hex()
                    source_bytes = int(row["SourceBytes"] or 0)
                    source_id = str(row["Id"])
                    target = category_dir / f"{source_id}.bin"
                    with base.private_open(target, "wb") as handle:
                        handle.write(content)
                    local_hash = hashlib.sha256(content).hexdigest()
                    if len(content) != source_bytes or local_hash != source_hash:
                        raise RuntimeError(f"Source/local mismatch in {category} sample")
                    records.append({
                        "category": category,
                        "database": database,
                        "source_id": source_id,
                        "source_name": str(row["Name"]),
                        "container_id": str(row["ContainerId"]),
                        "relative_file": str(target.relative_to(args.output_dir)),
                        "bytes": source_bytes,
                        "source_sha256": source_hash,
                        "local_sha256": local_hash,
                        "signature_hex": content[:16].hex(),
                        "detected_mime": detected_mime(target),
                        "validation": "pass",
                    })

        manifest = {
            "format": "vno-v1-media-sample-v1",
            "created_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
            "tenant_id": tenant_id,
            "sample_plan": [
                {"category": c, "database": d, "count": n}
                for c, d, n in SAMPLE_PLAN
            ],
            "records": records,
            "total_files": len(records),
            "total_bytes": sum(int(r["bytes"]) for r in records),
            "all_source_local_hashes_match": all(
                r["source_sha256"] == r["local_sha256"] for r in records
            ),
        }
        manifest_path = args.output_dir / "sample-manifest.json"
        with base.private_open(manifest_path, "w") as handle:
            json.dump(manifest, handle, ensure_ascii=False, indent=2)
        with base.private_open(status_path, "w") as handle:
            json.dump({
                "status": "pass",
                "files": len(records),
                "bytes": manifest["total_bytes"],
                "manifest_sha256": base.sha256_file(manifest_path),
            }, handle, indent=2)
        print(json.dumps({
            "status": "pass", "files": len(records),
            "bytes": manifest["total_bytes"],
            "categories": {c: n for c, _, n in SAMPLE_PLAN},
        }))
        return 0
    finally:
        password = ""
        tunnel.terminate()
        try:
            tunnel.wait(timeout=5)
        except subprocess.TimeoutExpired:
            tunnel.kill()


if __name__ == "__main__":
    sys.exit(main())
