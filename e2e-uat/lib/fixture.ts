import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { api } from './api';
import { Cred } from './env';

// Paired fixture = Merchant + Partner identities AND records created and claimed in the SAME onboarding run.
// Stored in .auth/fixture.json (git-ignored, contains credentials). Operational tests read it; they never create or claim.
const FILE = path.join(__dirname, '..', '.auth', 'fixture.json');
export type Fixture = { run: string; merchantId: string; partnerId: string; partnerCode: string; merchant: Cred; partner: Cred; merchantImageSha: string; partnerImageSha?: string };
export const readFixture = (): Fixture | null => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; } };
export const writeFixture = (f: Fixture) => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(f, null, 2), { mode: 0o600 }); };
export const sha256 = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex');

// Download the effective approved image(s) for an owner through the public approved feed and hash the actual bytes.
export async function approvedImages(ownerType: 'merchant' | 'collaborator', ownerId: string) {
  const feed = await api(null, 'GET', `/media/approved/${ownerType}/${ownerId}`);
  const list: any[] = Array.isArray(feed.body) ? feed.body : feed.body?.items ?? [];
  const out: { id: string; sha: string; bytes: number; type: string }[] = [];
  for (const m of list) {
    if (!m.signed_url) continue;
    const r = await fetch(m.signed_url); const buf = Buffer.from(await r.arrayBuffer());
    out.push({ id: String(m.id), sha: sha256(buf), bytes: buf.length, type: r.headers.get('content-type') ?? '' });
  }
  return { status: feed.status, items: out };
}
