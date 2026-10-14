# VNO Phase D3 — Pre-import rollback and recovery runbook

Date: 2026-10-14 (Asia/Ho_Chi_Minh)
Target: Supabase project `hsezyogfxgnkpweoqqny` (`VietnamNumberOne`)
Scope: rollback planning only; no production import, restore, or destructive action was executed.

## Release boundary

The production import must not start until one named operator records every item in the preflight evidence bundle and a second reviewer signs it. The import must use only:

- `/Users/dungduongdinhquoc/Documents/VNO/phase-d1-20261013/snapshot-3/`
- manifest SHA-256 `da291214739f71cd2c5d02a356f5ea73cbb66cc36914de150d74a0b97b7abfa8`
- tenant `b7688a1c-23f9-637d-c2fb-3a16eb1befd2`

The importer verifies the accepted path, acceptance-manifest hash, manifest hash, every `files.sha256` entry, and tenant before it contacts the target.

## 1. Pre-import recovery point

Immediately before the approved maintenance window:

1. Pause V2 onboarding and all application writes; record the freeze timestamp in UTC and Asia/Ho_Chi_Minh.
2. In Supabase Dashboard, open **Database → Backups**. Record the latest recoverable point and whether PITR is enabled. The recovery point must be at or after the write-freeze timestamp. If this cannot be established, stop.
3. Create an encrypted logical database export using the approved operator workstation and store it in the private release evidence directory. Include `public`, `auth`, and `storage` metadata; record tool versions, byte size, and SHA-256. Never commit the export or its credentials.
4. Export read-only prestate inventories for all affected tables, Auth users, and Storage objects. Sensitive values remain in the encrypted evidence bundle; the review report contains only counts and hashes.
5. Verify that the hosted counts are still 14 merchants, 14 collaborators, zero referral transactions, zero media assets, and that the reviewed duplicate analysis still has zero merchant/collaborator/Auth matches. Any drift requires a fresh match analysis and review.

Supabase database backups contain Storage metadata but not Storage object bytes. Database recovery is therefore necessary but insufficient for Storage rollback. See [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups).

## 2. Storage protection

Before import, enumerate every existing object in private buckets `merchant-media` and `partner-media`, including bucket, object key, size, ETag when available, and SHA-256 from downloaded bytes. Copy the bytes to encrypted private storage and verify the copy against the manifest.

During import, record the exact set of newly created object keys. Rollback may delete only keys in that signed import manifest. Existing keys must never be overwritten: a pre-existing key with a different hash is a hard stop. Restore any changed or missing pre-import object from the encrypted copy and verify its checksum.

## 3. Database rollback

The preferred recovery path is targeted batch rollback, not whole-project restore:

1. Stop the application and importer; preserve logs and the import summary.
2. Mark the migration batch failed and record the failure reason.
3. In a single reviewed transaction, remove rows proven to belong to the import by accepted legacy tenant/source identifiers and deterministic batch/source IDs, in child-to-parent order. Do not delete or rewrite the 14 pre-existing merchants, 14 pre-existing collaborators, or V2-only categories.
4. Restore the four matched category prestates from the encrypted pre-import inventory if any category field differs. The current importer preserves their V2 values and adds only source identity metadata.
5. Remove migration checkpoints, conflicts, run records, archive records, and audit records only for the recorded batch ID, then remove the batch row last.
6. Re-run pre-import counts, uniqueness checks, foreign-key checks, financial totals, authorization tests, and advisor checks.

If targeted rollback cannot prove ownership for every changed row, do not improvise deletes. Escalate to a Supabase PITR/daily-backup restore to the recorded pre-import point, accepting planned downtime, then separately restore and verify Storage bytes.

Additive schema migrations are not rolled back during data rollback. A schema rollback requires a separately reviewed forward migration.

## 4. Auth rollback and irreversible side effects

Before import, create a private Auth prestate manifest containing Auth user ID, a one-way email digest, provider identities, role/app metadata, confirmation timestamps, and the related profile ID. Do not export password hashes or tokens.

The importer creates accounts with deterministic legacy UUIDs, random bootstrap passwords, `password_reset_required=true`, and no outbound recovery/invite message. It must abort on any unreviewed existing Auth or profile collision.

For targeted rollback:

1. Revoke sessions for Auth IDs listed as newly created in the signed import manifest.
2. Delete only those newly created Auth IDs after their imported profiles and identity mappings are removed.
3. Restore metadata for any reviewed, explicitly reused Auth account from prestate; never change its password as part of rollback.
4. Do not attempt to retract an email. An accidentally sent recovery/invite email is irreversible; invalidate sessions/links as supported, notify the incident owner, and follow the approved support response. The import intentionally sends no email.

## 5. Acceptance after rollback

Rollback is accepted only when all of these hold:

- pre-existing database row counts and prestate hashes match;
- no import-owned Auth user, session, profile, or identity mapping remains;
- both Storage buckets match the pre-import object manifest byte-for-byte;
- anonymous, Admin, Merchant, and Collaborator authorization smoke tests pass;
- the application is healthy before writes are re-enabled;
- the incident record contains the batch ID, recovery point, operator, reviewer, commands/tool versions, and hashes.

The pre-import backup/recovery-point creation and a restore drill against a separate environment remain mandatory release-window actions. This document does not authorize either a production import or a restore.
