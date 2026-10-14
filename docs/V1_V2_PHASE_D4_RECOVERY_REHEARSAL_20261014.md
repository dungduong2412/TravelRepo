# VNO Phase D4 — Recovery procedure and isolated rehearsal

Date: 2026-10-14 (Asia/Ho_Chi_Minh)

This extends the Phase D3 rollback runbook. It does not authorize an import or production restore.

## Just-in-time production procedure

Immediately before an approved import window:

1. Freeze V2 writes and record UTC plus Asia/Ho_Chi_Minh timestamps.
2. Establish a Supabase database recovery point at or after the freeze and create an encrypted logical prestate export of affected `public`, `auth` and `storage` metadata. Record tool versions, byte size and SHA-256.
3. Export counts and deterministic hashes for affected tables and Auth IDs/metadata. Never export password hashes or tokens.
4. Download every existing private Storage object to encrypted private storage; record bucket/key, size and byte SHA-256. Database backups do not contain Storage bytes.
5. Rerun duplicate matching. The expected hosted prestate remains 14 merchants, 14 collaborators, 15 Auth users, zero transactions and zero media assets. Drift is a hard stop.
6. During import, record every created database identity, Auth ID and Storage key under one signed migration batch. Never overwrite an existing object with a different checksum.
7. On rollback, stop writers/importer; remove only batch-owned child rows, Storage keys and newly created Auth accounts; restore reused-account metadata from prestate; remove the batch last. Do not delete the pre-existing 14 merchants or 14 collaborators.
8. If ownership is ambiguous, use the recorded whole-database recovery point and then restore Storage bytes separately. Additive schema changes require a reviewed forward migration, not an improvised destructive rollback.

## Isolated restoration rehearsal

`migration/v2/test-rollback-recovery.mjs` ran only against the local isolated Supabase rehearsal. It captured prestate hashes, created one synthetic migration batch, one synthetic Auth user and one 4 KiB private Storage object, verified the object bytes, then removed those exact synthetic identities and compared poststate.

Result: **PASS**.

| Component | Before/after count | Before/after SHA-256 | Restored |
|---|---:|---|---|
| Migration batches | 1 | `b4027c559053fa5fa2fee0f8af3a873bf01b4c350afb7527b3f7107a26e099a5` | Yes |
| Auth users | 420 | `029f4dc38d8048f2274dae1b7474003b32fd2311b4d1f6dd31dbf70e78d10adb` | Yes |
| Merchant Storage inventory | 542 | `fcc450c486989b60577c0013f254dad1f56a430deb05919515463a8806101192` | Yes |
| Partner Storage inventory | 76 | `5f5a7ed9ea82be4e7318c294126bd3b642c1095d10b2d4ed4dd1215779fcec14` | Yes |

Core imported rehearsal state also remained unchanged: 163 merchants, 285 collaborators, 102 transactions, 618 media rows and 420 profiles, with matching pre/post ID-set hashes. The synthetic Storage object passed byte-level SHA-256 verification. Targeted recovery took **0.097 seconds**; total test time was **0.571 seconds** on the local workstation.

This proves the deterministic targeted rollback mechanism in isolation. It does not replace the mandatory just-in-time hosted recovery point, encrypted Storage byte backup or a timed rehearsal using production-scale backups in the final maintenance window.
