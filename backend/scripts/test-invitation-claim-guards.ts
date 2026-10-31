// Unit-level guard check: claim must refuse identities whose email is not Auth-confirmed,
// and must never create a profile or consume the invitation in that case.
import assert from 'node:assert/strict';
import { InvitationsService } from '../src/modules/invitations/invitations.service';

const entityId = '11111111-1111-4111-8111-111111111111';
const touched: string[] = [];
const client: any = {
  auth: { admin: { getUserById: async () => ({ data: { user: { id: 'u1', email: 'owner@x.test', email_confirmed_at: null } }, error: null }) } },
  from: (table: string) => { touched.push(table); throw new Error(`unexpected table access: ${table}`); },
};
const service = new InvitationsService({ getClient: () => client } as any, { record: async () => undefined } as any, {
  createOrUpdate: async () => { throw new Error('profile must not be created'); },
} as any);

(async () => {
  await assert.rejects(() => service.claim('u1', 'owner@x.test', 'merchant', entityId), /Email confirmation is required/);
  assert.deepEqual(touched, [], 'no table may be touched before identity verification');
  await assert.rejects(() => service.claim('u1', 'owner@x.test', 'merchant', 'nope'), /Invalid entity id/);
  await assert.rejects(() => service.claim('u1', 'owner@x.test', 'admin', entityId), /Unsupported entity type/);
  console.log(JSON.stringify({ status: 'PASS', controls: 3 }));
})().catch((e) => { console.error(e); process.exit(1); });
