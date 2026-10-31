// R08 unit guard: approving a Merchant/Partner whose owner has not claimed it is a controlled 4xx
// with a stable error code, raised before ANY write, audit event or profile change.
import assert from 'node:assert/strict';
import { MerchantsService } from '../src/modules/merchants/merchants.service';
import { CollaboratorsService } from '../src/modules/collaborators/collaborators.service';

const ID = '22222222-2222-4222-8222-222222222222';
const writes: string[] = []; const audits: string[] = [];
function client(rows: Record<string, any>) {
  return { auth: { admin: { getUserById: async () => { throw new Error('no Auth lookup expected'); } } },
    from: (table: string) => {
      const q: any = { select: () => q, eq: () => q, single: async () => ({ data: rows[table] ?? null, error: rows[table] ? null : { message: 'none' } }),
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        update: () => { writes.push(`update ${table}`); return q; }, insert: () => { writes.push(`insert ${table}`); return q; } };
      return q;
    } };
}
const audit: any = { record: async (_a: any, action: string) => { audits.push(action); } };
const profiles: any = { createOrUpdate: async () => { writes.push('createOrUpdate'); }, assertLinkedAuthEmailConfirmed: async () => undefined };
const code = (e: any) => e?.getResponse?.().code; const status = (e: any) => e?.getStatus?.();
const rejectsWith = async (p: Promise<unknown>, st: number, c: string) => assert.rejects(p, (e: any) => status(e) === st && code(e) === c, `expected ${st} ${c}`);

(async () => {
  const unclaimed = { merchant_details: { merchant_system_id: ID, owner_email: 'o@x.test', merchants_status: 'pending', merchant_verified: false }, collaborators: { id: ID, collaborators_code: 'COL-X', collaborators_email: 'p@x.test' } };
  const m = (rows: any) => new MerchantsService({ getClient: () => client(rows) } as any, profiles, audit);
  const c = (rows: any) => new CollaboratorsService({ getClient: () => client(rows) } as any, profiles, audit);
  await rejectsWith(m(unclaimed).approve({ id: 'a' } as any, ID), 409, 'OWNER_NOT_CLAIMED');
  await rejectsWith(m(unclaimed).approve({ id: 'a' } as any, 'not-a-uuid'), 400, 'INVALID_ID');
  await rejectsWith(m({}).approve({ id: 'a' } as any, ID), 404, 'MERCHANT_NOT_FOUND');
  await rejectsWith(m({ merchant_details: { ...unclaimed.merchant_details, owner_email: null } }).approve({ id: 'a' } as any, ID), 422, 'OWNER_EMAIL_REQUIRED');
  await rejectsWith(c(unclaimed).approve({ id: 'a' } as any, ID), 409, 'OWNER_NOT_CLAIMED');
  assert.deepEqual(writes, [], 'no write may happen on a refused approval');
  assert.deepEqual(audits, [], 'no audit event may be recorded for a refused approval');
  console.log(JSON.stringify({ status: 'PASS', controls: 7 }));
})().catch((e) => { console.error(e); process.exit(1); });
