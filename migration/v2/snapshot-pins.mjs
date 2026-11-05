import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const lower = (v) => (v == null ? null : String(v).toLowerCase());

// Only these sealed snapshots may be imported or have media uploaded. A snapshot is selected by label and must match both
// its pinned path and its pinned manifest hash. Changing a pin is a reviewed code change. Shared by the importer and the
// media-only resume tool so there is exactly one place to pin.
export const SNAPSHOT_PINS = {
  'snapshot-3': {
    dir: '/Users/dungduongdinhquoc/Documents/VNO/phase-d1-20261013/snapshot-3',
    manifestSha256: 'da291214739f71cd2c5d02a356f5ea73cbb66cc36914de150d74a0b97b7abfa8',
    acceptanceSha256: null,
    requireControls: false,
  },
  // snapshot-4 is sealed but SUPERSEDED: it cannot be imported into real UAT (duplicate merchant code M2500119 vs UNIQUE(merchant_code)).
  'snapshot-5': {
    dir: '/Users/dungduongdinhquoc/Documents/VNO/phase-e1e2-20261101/snapshot-5',
    manifestSha256: 'a422c9443bca84a08f46f289f8ccdaf1d7b278ba826b6cb4590ddaf41d16c124',
    acceptanceSha256: '5225ffc67b9b7e47d6e7ec04850f01bd8a971a8704243116b3731797502c8e9b',
    requireControls: true,
  },
};

// Full seal check (acceptance + control-file hashes + manifest + every tracked file). Identical for importer and media resume.
export async function verifySealedSnapshot({ label, snapshotDir, tenant }) {
  const pin = SNAPSHOT_PINS[label];
  if (!pin) throw new Error(`unknown snapshot label ${label}`);
  const [resolvedSnapshot, resolvedAcceptedSnapshot] = await Promise.all([
    realpath(snapshotDir),
    realpath(pin.dir),
  ]);
  if (resolvedSnapshot !== resolvedAcceptedSnapshot) {
    throw new Error(`only the accepted ${label} path may be imported`);
  }
  const acceptanceBytes = await readFile(path.join(snapshotDir, 'acceptance-manifest.json'));
  const acceptanceDigest = (await readFile(
    path.join(snapshotDir, 'acceptance-manifest.sha256'), 'utf8'))
    .trim().split(/\s+/)[0];
  if (sha256(acceptanceBytes) !== acceptanceDigest) {
    throw new Error('acceptance manifest hash mismatch');
  }
  if (pin.acceptanceSha256 && sha256(acceptanceBytes) !== pin.acceptanceSha256) {
    throw new Error('acceptance manifest does not match the pinned hash');
  }
  const acceptance = JSON.parse(acceptanceBytes);
  if (acceptance.status !== 'PASS') throw new Error('snapshot acceptance status is not PASS');
  if (pin.requireControls) {
    for (const [field, file] of [['orphan_mapping_sha256', 'orphan-transaction-mapping.json'],
      ['excluded_merchants_sha256', 'excluded-deleted-merchants.json'],
      ['merchant_code_mapping_sha256', 'merchant-code-conflict-mapping.json']]) {
      const actual = sha256(await readFile(path.join(snapshotDir, file)));
      if (!acceptance[field] || acceptance[field] !== actual) throw new Error(`${file} does not match the sealed acceptance hash`);
    }
  }
  const manifestBytes = await readFile(path.join(snapshotDir, 'manifest.json'));
  const expectedManifest = acceptance.snapshot_manifest_sha256 || acceptance.manifest_sha256;
  const actualManifest = sha256(manifestBytes);
  if (actualManifest !== pin.manifestSha256 ||
      (expectedManifest && actualManifest !== expectedManifest)) {
    throw new Error('manifest hash mismatch');
  }
  const checksumLines = (await readFile(path.join(snapshotDir, 'files.sha256'), 'utf8'))
    .split('\n').filter(Boolean);
  for (const line of checksumLines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) throw new Error('invalid files.sha256 format');
    const candidate = path.resolve(snapshotDir, match[2]);
    if (!candidate.startsWith(`${resolvedSnapshot}${path.sep}`)) {
      throw new Error('unsafe path in files.sha256');
    }
    const bytes = await readFile(candidate);
    if (sha256(bytes) !== match[1]) throw new Error(`sealed file hash mismatch: ${match[2]}`);
  }
  const manifest = JSON.parse(manifestBytes);
  if (lower(manifest.tenant_id) !== tenant) throw new Error('tenant mismatch');
  return { manifest, manifest_sha256: sha256(manifestBytes), tracked_files: checksumLines.length };
}

