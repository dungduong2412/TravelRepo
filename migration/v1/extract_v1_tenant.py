#!/usr/bin/env python3
"""Read-only, tenant-scoped V1 extractor.

Opens an SSH tunnel to SQL Server, keeps the password in process memory, and
writes a private local staging snapshot. It never writes to V1 or prints rows.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import decimal
import hashlib
import json
import os
import shutil
import socket
import stat
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Iterable

try:
    import pymssql
except ImportError as exc:
    raise SystemExit("pymssql is required in an isolated local environment") from exc


DATABASES = (
    "Emos_Saas",
    "Emos_Administration",
    "Emos_Identity",
    "Emos_MdmService",
    "Emos_Cms",
    "Emos_Aeretha",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True)
    parser.add_argument("--ssh-port", type=int, default=2233)
    parser.add_argument("--ssh-user", default="ubuntu")
    parser.add_argument("--ssh-key", type=Path, required=True)
    parser.add_argument("--remote-sql-port", type=int, default=1434)
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--reuse-blobs-from",
        type=Path,
        help="Private prior staging directory; every reused blob is checked against a fresh source SHA-256 and byte length",
    )
    return parser.parse_args()


def ensure_private_destination(path: Path, key: Path) -> None:
    if path.exists():
        raise SystemExit(f"Output directory already exists: {path}")
    if stat.S_IMODE(key.stat().st_mode) & 0o077:
        raise SystemExit("SSH private key must not be accessible by group or others")
    resolved = path.resolve()
    for parent in (resolved, *resolved.parents):
        if (parent / ".git").exists():
            raise SystemExit("Refusing to put sensitive extraction inside a Git repository")
    path.mkdir(parents=True, mode=0o700)
    os.chmod(path, 0o700)


def private_open(path: Path, mode: str):
    handle = open(path, mode) if "b" in mode else open(path, mode, encoding="utf-8")
    os.chmod(path, 0o600)
    return handle


def private_mkdir(path: Path, root: Path) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    current = path
    while current == root or root in current.parents:
        os.chmod(current, 0o700)
        if current == root:
            break
        current = current.parent


def free_local_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def ssh_base(args: argparse.Namespace) -> list[str]:
    return [
        "ssh", "-i", str(args.ssh_key), "-p", str(args.ssh_port),
        "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10",
        "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
        f"{args.ssh_user}@{args.host}",
    ]


def read_password(args: argparse.Namespace) -> str:
    result = subprocess.run(
        ssh_base(args) + ["sudo docker exec sql-server-db printenv SA_PASSWORD"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    )
    password = result.stdout.decode("utf-8").rstrip("\r\n")
    if not password:
        raise RuntimeError("SQL password was unavailable inside the source container")
    return password


def start_tunnel(args: argparse.Namespace, local_port: int) -> subprocess.Popen[bytes]:
    command = ssh_base(args)
    command[1:1] = ["-N", "-L", f"{local_port}:127.0.0.1:{args.remote_sql_port}"]
    return subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def wait_for_tunnel(process: subprocess.Popen[bytes], port: int) -> None:
    for _ in range(100):
        if process.poll() is not None:
            detail = (process.stderr.read() if process.stderr else b"").decode("utf-8", "replace")
            raise RuntimeError(f"SSH tunnel failed: {detail.strip()}")
        with socket.socket() as sock:
            sock.settimeout(0.1)
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.1)
    raise RuntimeError("SSH tunnel did not become ready")


def quote_ident(value: str) -> str:
    return "[" + value.replace("]", "]]" ) + "]"


def json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, decimal.Decimal):
        return {"$decimal": str(value)}
    if isinstance(value, float):
        return {"$float_hex": value.hex()}
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return {"$datetime": value.isoformat()}
    if isinstance(value, uuid.UUID):
        return {"$uuid": str(value)}
    if isinstance(value, bytes):
        return {"$base64": base64.b64encode(value).decode("ascii")}
    return {"$text": str(value)}


def encode_json_line(value: dict[str, Any]) -> bytes:
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return payload.encode("utf-8") + b"\n"


def dump_json_line(handle, value: dict[str, Any]) -> None:
    handle.write(encode_json_line(value))


def connect(port: int, password: str, database: str):
    return pymssql.connect(
        server="127.0.0.1", port=port, user="sa", password=password,
        database=database, tds_version="7.4", login_timeout=15, timeout=0,
        charset="UTF-8", autocommit=True,
    )


def discover_direct_tables(connection) -> list[tuple[str, str]]:
    cursor = connection.cursor()
    cursor.execute(
        """
        SELECT s.name, t.name
        FROM sys.tables AS t
        JOIN sys.schemas AS s ON s.schema_id = t.schema_id
        WHERE EXISTS (
          SELECT 1 FROM sys.columns AS c
          WHERE c.object_id = t.object_id AND c.name = N'TenantId'
        )
        ORDER BY s.name, t.name
        """
    )
    return [(str(row[0]), str(row[1])) for row in cursor.fetchall()]


def columns(connection, schema: str, table: str) -> list[dict[str, Any]]:
    cursor = connection.cursor(as_dict=True)
    cursor.execute(
        """
        SELECT c.column_id, c.name AS column_name, ty.name AS type_name,
               c.max_length, c.precision, c.scale, c.is_nullable, c.is_computed
        FROM sys.tables AS t
        JOIN sys.schemas AS s ON s.schema_id = t.schema_id
        JOIN sys.columns AS c ON c.object_id = t.object_id
        JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
        WHERE s.name = %s AND t.name = %s
        ORDER BY c.column_id
        """,
        (schema, table),
    )
    return list(cursor.fetchall())


def primary_key_columns(connection, schema: str, table: str) -> list[str]:
    cursor = connection.cursor()
    cursor.execute(
        """
        SELECT c.name
        FROM sys.tables AS t
        JOIN sys.schemas AS s ON s.schema_id = t.schema_id
        JOIN sys.indexes AS i ON i.object_id = t.object_id AND i.is_primary_key = 1
        JOIN sys.index_columns AS ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
        JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE s.name = %s AND t.name = %s
        ORDER BY ic.key_ordinal
        """,
        (schema, table),
    )
    return [str(row[0]) for row in cursor.fetchall()]


def select_expression(alias: str, column: dict[str, Any]) -> str:
    name = quote_ident(str(column["column_name"]))
    source = f"{quote_ident(alias)}.{name}"
    type_name = str(column["type_name"]).lower()
    if type_name in {"decimal", "numeric", "money", "smallmoney"}:
        return f"CONVERT(nvarchar(100), {source}) AS {name}"
    if type_name in {"float", "real"}:
        return f"CONVERT(varchar(100), {source}, 3) AS {name}"
    if type_name in {"datetime", "datetime2", "smalldatetime", "date", "time"}:
        return f"CONVERT(nvarchar(50), {source}, 126) AS {name}"
    if type_name == "datetimeoffset":
        return f"CONVERT(nvarchar(50), {source}, 127) AS {name}"
    if type_name == "uniqueidentifier":
        return f"CONVERT(char(36), {source}) AS {name}"
    if type_name in {"geography", "geometry", "hierarchyid"}:
        return f"CONVERT(varbinary(max), {source}) AS {name}"
    return f"{source} AS {name}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_table(
    connection, output_dir: Path, database: str, schema: str, table: str,
    where_sql: str, parameters: Iterable[Any], scope: str,
    reuse_blobs_from: Path | None = None,
) -> dict[str, Any]:
    column_meta = columns(connection, schema, table)
    is_blob_table = table == "AbpBlobs" and any(
        str(item["column_name"]) == "Content" for item in column_meta
    )
    reuse_blob_files = is_blob_table and reuse_blobs_from is not None
    expression_list: list[str] = []
    for item in column_meta:
        if reuse_blob_files and str(item["column_name"]) == "Content":
            expression_list.extend((
                "HASHBYTES('SHA2_256', [src].[Content]) AS [__ContentSha256]",
                "DATALENGTH([src].[Content]) AS [__ContentBytes]",
            ))
        else:
            expression_list.append(select_expression("src", item))
    expressions = ", ".join(expression_list)
    ordering = primary_key_columns(connection, schema, table)
    sql = (
        f"SELECT {expressions} FROM {quote_ident(schema)}.{quote_ident(table)} AS [src] "
        f"WHERE {where_sql}"
    )
    if ordering:
        sql += " ORDER BY " + ", ".join(f"[src].{quote_ident(name)}" for name in ordering)

    table_dir = output_dir / "tables" / database
    private_mkdir(table_dir, output_dir)
    target = table_dir / f"{schema}.{table}.jsonl"
    partial_target = target.with_suffix(target.suffix + ".partial")
    if target.exists() or partial_target.exists():
        raise RuntimeError(
            f"Duplicate or stale table export target: {database}.{schema}.{table}"
        )
    blob_dir = output_dir / "blobs" / database / f"{schema}.{table}"
    if is_blob_table:
        private_mkdir(blob_dir, output_dir)

    cursor = connection.cursor(as_dict=True)
    cursor.execute(sql, tuple(parameters))
    row_count = blob_count = blob_bytes = 0
    blob_metadata_lines: list[bytes] = []
    handle = None if is_blob_table else private_open(partial_target, "wb")
    try:
        while True:
            batch = cursor.fetchmany(100)
            if not batch:
                break
            for row in batch:
                encoded = {
                    name: json_value(value)
                    for name, value in row.items()
                    if not (
                        is_blob_table
                        and name in {"Content", "__ContentSha256", "__ContentBytes"}
                    )
                }
                if is_blob_table:
                    source_id = str(row.get("Id", f"row-{row_count + 1}"))
                    blob_target = blob_dir / f"{source_id}.bin"
                    if reuse_blob_files and row.get("__ContentSha256") is not None:
                        expected_hash = bytes(row["__ContentSha256"]).hex()
                        expected_bytes = int(row["__ContentBytes"])
                        reuse_source = (
                            reuse_blobs_from / "blobs" / database
                            / f"{schema}.{table}" / f"{source_id}.bin"
                        )
                        if not reuse_source.is_file():
                            raise RuntimeError(f"Reusable blob is missing: {database}.{table}/{source_id}")
                        if reuse_source.stat().st_size != expected_bytes:
                            raise RuntimeError(f"Reusable blob size mismatch: {database}.{table}/{source_id}")
                        if sha256_file(reuse_source) != expected_hash:
                            raise RuntimeError(f"Reusable blob hash mismatch: {database}.{table}/{source_id}")
                        shutil.copy2(reuse_source, blob_target)
                        os.chmod(blob_target, 0o600)
                        content_bytes = expected_bytes
                        content_hash = expected_hash
                    elif isinstance(row.get("Content"), (bytes, bytearray)):
                        content = bytes(row["Content"])
                        with private_open(blob_target, "wb") as blob_handle:
                            blob_handle.write(content)
                        content_bytes = len(content)
                        content_hash = hashlib.sha256(content).hexdigest()
                    else:
                        encoded["Content"] = None
                        content_bytes = 0
                        content_hash = ""
                    if content_hash:
                        encoded["Content"] = {
                            "$blob_file": str(blob_target.relative_to(output_dir)),
                            "bytes": content_bytes,
                            "sha256": content_hash,
                        }
                        blob_count += 1
                        blob_bytes += content_bytes
                if is_blob_table:
                    blob_metadata_lines.append(encode_json_line(encoded))
                else:
                    dump_json_line(handle, encoded)
                row_count += 1
        if handle is not None:
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        if handle is not None:
            handle.close()
    if is_blob_table:
        with private_open(partial_target, "wb") as blob_metadata_handle:
            blob_metadata_handle.writelines(blob_metadata_lines)
            blob_metadata_handle.flush()
            os.fsync(blob_metadata_handle.fileno())
    os.replace(partial_target, target)
    os.chmod(target, 0o600)
    if not target.is_file() or partial_target.exists():
        raise RuntimeError(f"Table export finalization failed: {database}.{schema}.{table}")

    return {
        "database": database, "schema": schema, "table": table, "scope": scope,
        "rows": row_count, "columns": column_meta,
        "primary_key_columns": ordering, "file": str(target.relative_to(output_dir)),
        "file_sha256": sha256_file(target), "blob_files": blob_count,
        "blob_bytes": blob_bytes,
    }


def extract_table_with_transport_retry(
    args: argparse.Namespace, local_port: int, password: str, output_dir: Path,
    database: str, schema: str, table: str, where_sql: str,
    parameters: Iterable[Any], scope: str, reuse_blobs_from: Path | None,
) -> dict[str, Any]:
    """Retry only transient SQL transport failures, never integrity failures."""
    for attempt in range(1, 4):
        try:
            with connect(local_port, password, database) as connection:
                return extract_table(
                    connection, output_dir, database, schema, table, where_sql,
                    parameters, scope, reuse_blobs_from,
                )
        except pymssql.OperationalError:
            table_dir = output_dir / "tables" / database
            partial = table_dir / f"{schema}.{table}.jsonl.partial"
            if partial.is_file():
                partial.unlink()
            if attempt == 3:
                raise
            time.sleep(attempt * 2)
    raise AssertionError("unreachable")


def verify_snapshot(output_dir: Path, manifest: dict[str, Any]) -> dict[str, int]:
    table_files = row_count = blob_files = blob_bytes = 0
    if stat.S_IMODE(output_dir.stat().st_mode) != 0o700:
        raise RuntimeError("Snapshot root permissions are not 0700")
    for item in manifest["tables"]:
        table_path = output_dir / item["file"]
        if stat.S_IMODE(table_path.stat().st_mode) != 0o600:
            raise RuntimeError(f"Table-file permissions are not 0600: {item['file']}")
        digest = hashlib.sha256()
        actual_rows = 0
        with open(table_path, "rb") as raw:
            for raw_line in raw:
                digest.update(raw_line)
                actual_rows += 1
                row = json.loads(raw_line)
                for value in row.values():
                    if isinstance(value, dict) and "$blob_file" in value:
                        blob_path = output_dir / value["$blob_file"]
                        if stat.S_IMODE(blob_path.stat().st_mode) != 0o600:
                            raise RuntimeError(f"Blob permissions are not 0600: {value['$blob_file']}")
                        if blob_path.stat().st_size != value["bytes"]:
                            raise RuntimeError(f"Blob size verification failed: {value['$blob_file']}")
                        if sha256_file(blob_path) != value["sha256"]:
                            raise RuntimeError(f"Blob hash verification failed: {value['$blob_file']}")
                        blob_files += 1
                        blob_bytes += int(value["bytes"])
        if actual_rows != item["rows"]:
            raise RuntimeError(f"Row-count verification failed: {item['file']}")
        if digest.hexdigest() != item["file_sha256"]:
            raise RuntimeError(f"Table-file hash verification failed: {item['file']}")
        table_files += 1
        row_count += actual_rows
    expected = (
        manifest["total_rows"],
        manifest["total_blob_files"],
        manifest["total_blob_bytes"],
    )
    if (row_count, blob_files, blob_bytes) != expected:
        raise RuntimeError("Snapshot aggregate verification failed")
    return {
        "table_files": table_files,
        "rows": row_count,
        "blob_files": blob_files,
        "blob_bytes": blob_bytes,
    }


def relational_specs(tenant_id: str) -> list[tuple[str, str, str, str, tuple[Any, ...], str]]:
    return [
        ("Emos_Saas", "dbo", "SaasTenants", "[src].[Id] = %s", (tenant_id,), "tenant-registry-id"),
        ("Emos_Administration", "dbo", "AbpSettings", "[src].[ProviderName] = N'T' AND TRY_CONVERT(uniqueidentifier, [src].[ProviderKey]) = %s", (tenant_id,), "abp-tenant-provider-key"),
        ("Emos_Administration", "dbo", "AbpFeatureValues", "[src].[ProviderName] = N'T' AND TRY_CONVERT(uniqueidentifier, [src].[ProviderKey]) = %s", (tenant_id,), "abp-tenant-provider-key"),
        ("Emos_Administration", "dbo", "GdprRequests", "EXISTS (SELECT 1 FROM Emos_Identity.dbo.AbpUsers AS u WHERE u.Id = [src].[UserId] AND u.TenantId = %s)", (tenant_id,), "tenant-user"),
        ("Emos_Administration", "dbo", "GdprInfo", "EXISTS (SELECT 1 FROM dbo.GdprRequests AS gr JOIN Emos_Identity.dbo.AbpUsers AS u ON u.Id = gr.UserId WHERE gr.Id = [src].[RequestId] AND u.TenantId = %s)", (tenant_id,), "tenant-gdpr-request"),
        ("Emos_Identity", "dbo", "AbpLinkUsers", "[src].[SourceTenantId] = %s OR [src].[TargetTenantId] = %s", (tenant_id, tenant_id), "source-or-target-tenant"),
        ("Emos_Identity", "dbo", "OpenIddictAuthorizations", "EXISTS (SELECT 1 FROM dbo.AbpUsers AS u WHERE u.TenantId = %s AND [src].[Subject] = CONVERT(nvarchar(36), u.Id))", (tenant_id,), "tenant-user-subject-archive-only"),
        ("Emos_Identity", "dbo", "OpenIddictTokens", "EXISTS (SELECT 1 FROM dbo.AbpUsers AS u WHERE u.TenantId = %s AND [src].[Subject] = CONVERT(nvarchar(36), u.Id))", (tenant_id,), "tenant-user-subject-archive-only"),
        ("Emos_MdmService", "dbo", "MerchantImages", "EXISTS (SELECT 1 FROM dbo.Restaurant AS r WHERE r.Id = [src].[ResId] AND r.TenantId = %s)", (tenant_id,), "tenant-restaurant"),
        ("Emos_MdmService", "dbo", "RestaurantUserMap", "EXISTS (SELECT 1 FROM dbo.Restaurant AS r WHERE r.Id = [src].[ResId] AND r.TenantId = %s)", (tenant_id,), "tenant-restaurant"),
        ("Emos_MdmService", "dbo", "NumberingTypeDefinition", "EXISTS (SELECT 1 FROM dbo.NumberingConfigs AS c WHERE c.NumberingTypeDefinitionId = [src].[Id] AND c.TenantId = %s)", (tenant_id,), "tenant-numbering-config-reference"),
        ("Emos_MdmService", "dbo", "AbpBlobContainers", "EXISTS (SELECT 1 FROM dbo.AbpBlobs AS b WHERE b.ContainerId = [src].[Id] AND b.TenantId = %s)", (tenant_id,), "tenant-blob-reference"),
        ("Emos_MdmService", "dbo", "DomainVerificationAttempts", "EXISTS (SELECT 1 FROM dbo.TenantCustomDomains AS d WHERE d.Id = [src].[TenantCustomDomainId] AND d.TenantId = %s)", (tenant_id,), "tenant-custom-domain"),
        ("Emos_Cms", "dbo", "CmsBlogFeatures", "EXISTS (SELECT 1 FROM dbo.CmsBlogs AS b WHERE b.Id = [src].[BlogId] AND b.TenantId = %s)", (tenant_id,), "tenant-blog"),
        ("Emos_Cms", "dbo", "AbpBlobContainers", "EXISTS (SELECT 1 FROM dbo.AbpBlobs AS b WHERE b.ContainerId = [src].[Id] AND b.TenantId = %s)", (tenant_id,), "tenant-blob-reference"),
    ]


def main() -> int:
    args = parse_args()
    tenant_id = str(uuid.UUID(args.tenant_id))
    if args.reuse_blobs_from is not None and not args.reuse_blobs_from.is_dir():
        raise SystemExit(f"Reusable blob directory does not exist: {args.reuse_blobs_from}")
    ensure_private_destination(args.output_dir, args.ssh_key)
    status_path = args.output_dir / "status.json"
    with private_open(status_path, "w") as handle:
        json.dump({"status": "incomplete"}, handle)

    password = read_password(args)
    local_port = free_local_port()
    tunnel = start_tunnel(args, local_port)
    manifest: dict[str, Any] = {
        "format": "vno-v1-tenant-extract-v1",
        "created_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "tenant_id": tenant_id, "source_host": args.host,
        "source_databases": list(DATABASES), "tables": [],
    }
    try:
        wait_for_tunnel(tunnel, local_port)
        direct_keys: set[tuple[str, str, str]] = set()
        for database in DATABASES:
            with connect(local_port, password, database) as connection:
                direct_tables = discover_direct_tables(connection)
            for schema, table in direct_tables:
                direct_keys.add((database, schema, table))
                manifest["tables"].append(extract_table_with_transport_retry(
                    args, local_port, password, args.output_dir,
                    database, schema, table, "[src].[TenantId] = %s",
                    (tenant_id,), "direct-tenant-id", args.reuse_blobs_from,
                ))
        for database, schema, table, where_sql, params, scope in relational_specs(tenant_id):
            if (database, schema, table) in direct_keys:
                continue
            manifest["tables"].append(extract_table_with_transport_retry(
                args, local_port, password, args.output_dir,
                database, schema, table, where_sql, params, scope,
                args.reuse_blobs_from,
            ))
        manifest["total_rows"] = sum(item["rows"] for item in manifest["tables"])
        manifest["total_blob_files"] = sum(item["blob_files"] for item in manifest["tables"])
        manifest["total_blob_bytes"] = sum(item["blob_bytes"] for item in manifest["tables"])
        verification = verify_snapshot(args.output_dir, manifest)
        manifest["verification"] = verification
        manifest_path = args.output_dir / "manifest.json"
        with private_open(manifest_path, "w") as handle:
            json.dump(manifest, handle, ensure_ascii=False, indent=2, default=json_value)
        with private_open(status_path, "w") as handle:
            json.dump({
                "status": "complete", "manifest_sha256": sha256_file(manifest_path),
                "tables": len(manifest["tables"]), "rows": manifest["total_rows"],
                "blob_files": manifest["total_blob_files"],
                "blob_bytes": manifest["total_blob_bytes"],
            }, handle, indent=2)
        print(json.dumps({
            "status": "complete", "output_dir": str(args.output_dir),
            "tables": len(manifest["tables"]), "rows": manifest["total_rows"],
            "blob_files": manifest["total_blob_files"],
            "blob_bytes": manifest["total_blob_bytes"],
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
