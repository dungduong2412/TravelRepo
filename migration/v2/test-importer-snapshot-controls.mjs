#!/usr/bin/env node
// Negative tests for importer seal/pin/orphan/exclusion controls. Every case must abort before any write.
// Usage: test-importer-snapshot-controls.mjs <snapshot-5 dir> <evidence.json>   (env: VNO_TARGET_URL, VNO_TARGET_SERVICE_ROLE_KEY - local only)
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [, , snap5, evidenceOut] = process.argv;
const url = process.env.VNO_TARGET_URL;
if (!snap5 || !evidenceOut || !url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('local target and arguments required');
const importer = path.resolve(new URL('./import-sealed-snapshot.mjs', import.meta.url).pathname);
const src = readFileSync(importer, 'utf8');
const here = path.dirname(importer);
const pinsSrc = readFileSync(path.join(here, 'snapshot-pins.mjs'), 'utf8');
const mediaSrc = readFileSync(path.join(here, 'media-upload.mjs'), 'utf8');
const remapSrc = readFileSync(path.join(here, 'partner-code-remap.mjs'), 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const work = realpathSync(mkdtempSync(path.join(tmpdir(), 'vno-importer-controls-')));
const results = [];

// pinsSource lets a case run the real importer against patched pins (dir / acceptance hash); the importer, uploader and seal code are unmodified copies.
function run(label, env, pinsSource = pinsSrc) {
  const dir = path.join(work, `run-${results.length}-${label}`);
  execFileSync('mkdir', ['-p', dir]);
  const file = path.join(dir, 'import-sealed-snapshot.mjs');
  writeFileSync(file, src); writeFileSync(path.join(dir, 'media-upload.mjs'), mediaSrc); writeFileSync(path.join(dir, 'partner-code-remap.mjs'), remapSrc); writeFileSync(path.join(dir, 'snapshot-pins.mjs'), pinsSource);
  const r = spawnSync('node', [file], { env: { ...process.env, ...env, VNO_D2_PRIVATE_DIR: path.join(work, 'private') }, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr };
}
function expectFail(id, name, r, pattern) {
  const ok = r.status !== 0 && pattern.test(r.stderr);
  results.push({ id, name, status: ok ? 'PASS' : 'FAIL', evidence: ok ? `aborted: ${(r.stderr.match(pattern) || [''])[0]}` : `exit ${r.status}; ${r.stderr.split('\n').filter((l) => /Error/.test(l)).slice(0, 2).join(' | ').slice(0, 300)}` });
  console.error(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}`);
}
const clone = (name) => { const dest = path.join(work, name); execFileSync('cp', ['-Rc', snap5, dest]); return dest; };
function reseal(dir) {
  const files = execFileSync('find', [dir, '-type', 'f', '!', '-name', 'files.sha256', '!', '-name', 'acceptance-manifest.json', '!', '-name', 'acceptance-manifest.sha256'], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
  writeFileSync(path.join(dir, 'files.sha256'), files.map((f) => `${sha(readFileSync(f))}  ${path.relative(dir, f)}`).join('\n') + '\n');
  const acc = JSON.parse(readFileSync(path.join(dir, 'acceptance-manifest.json'), 'utf8'));
  acc.orphan_mapping_sha256 = sha(readFileSync(path.join(dir, 'orphan-transaction-mapping.json')));
  acc.excluded_merchants_sha256 = sha(readFileSync(path.join(dir, 'excluded-deleted-merchants.json')));
  acc.merchant_code_mapping_sha256 = sha(readFileSync(path.join(dir, 'merchant-code-conflict-mapping.json')));
  chmodSync(path.join(dir, 'acceptance-manifest.json'), 0o600);
  chmodSync(path.join(dir, 'acceptance-manifest.sha256'), 0o600);
  const text = JSON.stringify(acc, null, 2);
  writeFileSync(path.join(dir, 'acceptance-manifest.json'), text);
  writeFileSync(path.join(dir, 'acceptance-manifest.sha256'), `${sha(text)}  acceptance-manifest.json\n`);
  return sha(text);
}
const patchedSource = (dir, acceptanceSha) => pinsSrc.replace(/'snapshot-5': \{\s*dir: '[^']*',/, `'snapshot-5': {\n    dir: '${dir}',`).replace(/acceptanceSha256: '[0-9a-f]{64}'/, `acceptanceSha256: '${acceptanceSha}'`);
const base5 = { VNO_SNAPSHOT_LABEL: 'snapshot-5' };
const PINNED_ACCEPTANCE = /snapshot-5': \{[^}]*acceptanceSha256: '([0-9a-f]{64})'/.exec(pinsSrc)[1];
const SNAPSHOT_4 = '/Users/dungduongdinhquoc/Documents/VNO/phase-e1e2-20261101/snapshot-4';

expectFail('T1', 'unknown snapshot label is rejected', run('T1', { VNO_SNAPSHOT_LABEL: 'snapshot-9' }), /unknown snapshot label/);
expectFail('T2', 'snapshot-5 label with the snapshot-3 directory is rejected', run('T2', { ...base5, VNO_SNAPSHOT_DIR: '/Users/dungduongdinhquoc/Documents/VNO/phase-d1-20261013/snapshot-3' }), /only the accepted snapshot-5 path/);
expectFail('T3', 'snapshot-3 label with the snapshot-5 directory is rejected', run('T3', { VNO_SNAPSHOT_LABEL: 'snapshot-3', VNO_SNAPSHOT_DIR: snap5 }), /only the accepted snapshot-3 path/);

// tampered table byte (path pin satisfied by patching the clone path; hashes remain the real pinned ones)
const t4 = clone('tamper-table');
const tableFile = path.join(t4, 'tables/Emos_MdmService/dbo.Restaurant.jsonl');
chmodSync(tableFile, 0o600);
writeFileSync(tableFile, readFileSync(tableFile, 'utf8').replace('"', '"​'));
expectFail('T4', 'one altered byte in a table file is rejected by files.sha256', run('T4', { ...base5, VNO_SNAPSHOT_DIR: t4 }, patchedSource(t4, PINNED_ACCEPTANCE)), /sealed file hash mismatch/);

// tampered orphan mapping with files.sha256 recomputed but acceptance left untouched
const t5 = clone('tamper-mapping');
chmodSync(path.join(t5, 'orphan-transaction-mapping.json'), 0o600);
writeFileSync(path.join(t5, 'orphan-transaction-mapping.json'), readFileSync(path.join(t5, 'orphan-transaction-mapping.json'), 'utf8').replace('"count": 3', '"count": 2'));
expectFail('T5', 'altered orphan mapping no longer matches the sealed acceptance hash', run('T5', { ...base5, VNO_SNAPSHOT_DIR: t5 }, patchedSource(t5, PINNED_ACCEPTANCE)), /does not match the sealed acceptance hash/);

// forged snapshot, fully re-sealed with new hashes but wrong orphan set -> controls must still abort before writes
const t6 = clone('forged-orphans');
const mapPath = path.join(t6, 'orphan-transaction-mapping.json');
chmodSync(mapPath, 0o600);
const mapping = JSON.parse(readFileSync(mapPath, 'utf8'));
mapping.transactions = mapping.transactions.slice(1);
writeFileSync(mapPath, JSON.stringify(mapping, null, 2));
const forgedSha = reseal(t6);
expectFail('T6', 'forged but re-sealed snapshot with an incomplete orphan mapping aborts before any write', run('T6', { ...base5, VNO_SNAPSHOT_DIR: t6 }, patchedSource(t6, forgedSha)), /orphan transactions differ from the approved mapping/);

const t7 = clone('forged-amount');
const mapPath7 = path.join(t7, 'orphan-transaction-mapping.json');
chmodSync(mapPath7, 0o600);
const mapping7 = JSON.parse(readFileSync(mapPath7, 'utf8'));
mapping7.transactions[0].document_total = '1.0000';
writeFileSync(mapPath7, JSON.stringify(mapping7, null, 2));
const forgedSha7 = reseal(t7);
expectFail('T7', 'forged mapping that changes an orphan amount aborts (amounts are never recalculated)', run('T7', { ...base5, VNO_SNAPSHOT_DIR: t7 }, patchedSource(t7, forgedSha7)), /differs from the approved mapping/);

const t8 = clone('forged-exclusion');
const exPath = path.join(t8, 'excluded-deleted-merchants.json');
chmodSync(exPath, 0o600);
const ex = JSON.parse(readFileSync(exPath, 'utf8'));
ex.remaining_references_are_exactly_the_approved_orphans = false;
writeFileSync(exPath, JSON.stringify(ex, null, 2));
const forgedSha8 = reseal(t8);
expectFail('T8', 'exclusion evidence that is not clean aborts before any write', run('T8', { ...base5, VNO_SNAPSHOT_DIR: t8 }, patchedSource(t8, forgedSha8)), /exclusion evidence is not clean/);

// ---- D6 (merchant code) controls --------------------------------------------------------------------------------------------------
const forge = (name, edit) => { const d = clone(name); edit(d); return { d, sha: reseal(d) }; };
const rewrite = (file, fn) => { chmodSync(file, 0o600); writeFileSync(file, fn(readFileSync(file, 'utf8'))); };
const t9 = forge('d6-replacement', (d) => rewrite(path.join(d, 'merchant-code-conflict-mapping.json'), (x) => x.replace('M2500119-DUP-d669a426', 'M2500119-DUP-zzzzzzzz')));
expectFail('T9', 'D6: re-sealed mapping with a different replacement code aborts before any write', run('T9', { ...base5, VNO_SNAPSHOT_DIR: t9.d }, patchedSource(t9.d, t9.sha)), /differ from the sealed D6 mapping/);
const t10 = forge('d6-swapped', (d) => rewrite(path.join(d, 'merchant-code-conflict-mapping.json'), (x) => { const m = JSON.parse(x); const c = m.conflicts[0]; [c.kept_legacy_id, c.remapped_legacy_id] = [c.remapped_legacy_id, c.kept_legacy_id]; return JSON.stringify(m, null, 2); }));
expectFail('T10', 'D6: re-sealed mapping with kept/remapped IDs swapped aborts (exact ID matching)', run('T10', { ...base5, VNO_SNAPSHOT_DIR: t10.d }, patchedSource(t10.d, t10.sha)), /differ from the sealed D6 mapping/);
const t11 = forge('d6-extra-duplicate', (d) => rewrite(path.join(d, 'tables/Emos_MdmService/dbo.Restaurant.jsonl'), (x) => { const lines = x.split('\n'); const i = lines.findIndex((l) => l && !l.includes('M2500119')); const j = lines.findIndex((l, k) => k > i && l && !l.includes('M2500119')); const code = JSON.parse(lines[i]).Code; const row = JSON.parse(lines[j]); row.Code = code; lines[j] = JSON.stringify(row); return lines.join('\n'); }));
expectFail('T11', 'D6: a second duplicate Merchant code outside the approved set aborts', run('T11', { ...base5, VNO_SNAPSHOT_DIR: t11.d }, patchedSource(t11.d, t11.sha)), /differ from the sealed D6 mapping|not exactly the owner-approved D6 set/);
const t12 = forge('d6-collision', (d) => rewrite(path.join(d, 'tables/Emos_MdmService/dbo.Restaurant.jsonl'), (x) => { const lines = x.split('\n'); const j = lines.findIndex((l) => l && !l.includes('M2500119')); const row = JSON.parse(lines[j]); row.Code = 'M2500119-DUP-d669a426'; lines[j] = JSON.stringify(row); return lines.join('\n'); }));
expectFail('T12', 'D6: a replacement code that collides with another V1 code aborts', run('T12', { ...base5, VNO_SNAPSHOT_DIR: t12.d }, patchedSource(t12.d, t12.sha)), /is not unique/);
const t13 = clone('d6-unsealed');
rewrite(path.join(t13, 'merchant-code-conflict-mapping.json'), (x) => x.replace('"rule"', '"rule_"'));
expectFail('T13', 'D6: mapping edited without re-sealing does not match the sealed acceptance hash', run('T13', { ...base5, VNO_SNAPSHOT_DIR: t13 }, patchedSource(t13, PINNED_ACCEPTANCE)), /sealed file hash mismatch|does not match the sealed acceptance hash/);
expectFail('T14', 'superseded snapshot-4 label is no longer importable', run('T14', { VNO_SNAPSHOT_LABEL: 'snapshot-4', VNO_SNAPSHOT_DIR: SNAPSHOT_4 }), /unknown snapshot label snapshot-4/);

rmSync(work, { recursive: true, force: true });
const summary = { generated_utc: new Date().toISOString(), pass: results.filter((r) => r.status === 'PASS').length, fail: results.filter((r) => r.status === 'FAIL').length, results };
writeFileSync(evidenceOut, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ pass: summary.pass, fail: summary.fail }));
