// Contract tests for Merchant Main Photo selection (no network, no database): rule parity, atomic-looking swap, tenant and state guards.
import assert from 'node:assert/strict';
import { MediaService } from '../src/modules/media/media.service';
import { pickMainMedia } from '../src/modules/media/main-media';

type Row = Record<string, any>;
class FakeClient {
  tables: Record<string, Row[]> = { user_profiles: [], media_assets: [], media_approval_requests: [], audit_events: [] };
  failPromote = false;
  from(table: string) {
    const rows = this.tables[table];
    let filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    let limit = Infinity;
    const run = () => {
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (patch) {
        if (this.failPromote && table === 'media_assets' && patch.is_hero === true) { this.failPromote = false; return { data: null, error: new Error('synthetic promote failure') }; }
        hit.forEach((r) => Object.assign(r, patch));
      }
      return { data: hit.slice(0, limit).map((r) => ({ ...r })), error: null };
    };
    const chain: any = {
      select: () => chain,
      update: (p: Row) => { patch = p; return chain; },
      insert: async (row: Row) => { rows.push(row); return { error: null }; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return chain; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return chain; },
      limit: (n: number) => { limit = n; return chain; },
      maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return chain;
  }
}

const M1 = '10000000-0000-4000-8000-000000000001';
const M2 = '10000000-0000-4000-8000-000000000002';
const ADMIN = 'a0000000-0000-4000-8000-000000000001';
const media = (id: string, merchant: string, extra: Row = {}): Row => ({
  id, merchant_id: merchant, collaborator_id: null, is_hero: false, display_order: 0, created_at: '2026-01-01T00:00:00Z',
  publication_status: 'legacy_effective', transfer_status: 'verified', publication_version: 0, ...extra,
});
function setup() {
  const client = new FakeClient();
  client.tables.user_profiles.push({ user_id: ADMIN, role: 'admin', user_profiles_status: 'active' }, { user_id: 'm', role: 'merchant', user_profiles_status: 'active' });
  client.tables.media_assets.push(
    media('hero', M1, { is_hero: true, display_order: 0 }), media('g1', M1, { display_order: 1 }), media('g2', M1, { display_order: 2 }),
    media('removed', M1, { publication_status: 'removed' }), media('pending', M1, { publication_status: 'pending' }),
    media('other', M2, { is_hero: true }),
  );
  const audits: Row[] = client.tables.audit_events;
  const service = new MediaService({ getClient: () => client } as any, { record: async (_a: unknown, action: string, _t: string, _id: string, details: Row) => { audits.push({ action, details }); } } as any);
  return { client, service, audits };
}
const heroes = (c: FakeClient, merchant: string) => c.tables.media_assets.filter((r) => r.merchant_id === merchant && r.is_hero).map((r) => r.id);
let n = 0;
const t = async (name: string, fn: () => Promise<void> | void) => { await fn(); n++; console.log(`PASS ${name}`); };
const rejects = (p: Promise<unknown>, name: string) => assert.rejects(p, (e: any) => e.constructor.name === name, name);

(async () => {
  await t('rule: hero wins, then display_order, created_at, id', () => {
    assert.equal(pickMainMedia([{ id: 'b', display_order: 0 }, { id: 'a', is_hero: true, display_order: 9 }])?.id, 'a');
    assert.equal(pickMainMedia([{ id: 'b', display_order: 2 }, { id: 'a', display_order: 1 }])?.id, 'a');
    assert.equal(pickMainMedia([{ id: 'b', created_at: '2026-01-02T00:00:00Z' }, { id: 'a', created_at: '2026-01-03T00:00:00Z' }])?.id, 'b');
    assert.equal(pickMainMedia([{ id: 'b' }, { id: 'a' }])?.id, 'a');
    assert.equal(pickMainMedia([]), null);
  });
  await t('promotes a gallery image: exactly one hero, old hero and all others stay effective and keep their order', async () => {
    const { client, service, audits } = setup();
    const before = JSON.stringify(client.tables.media_assets.filter((r) => r.merchant_id === M1).map((r) => [r.id, r.object_path, r.display_order, r.publication_status, r.legacy_image_id]));
    const result = await service.setMerchantMain(ADMIN, M1, 'g1');
    assert.deepEqual(heroes(client, M1), ['g1']);
    assert.deepEqual(result, { merchant_id: M1, main_media_id: 'g1', previous_main_media_ids: ['hero'], changed: true });
    assert.equal(client.tables.media_assets.find((r) => r.id === 'hero')!.publication_status, 'legacy_effective');
    assert.equal(JSON.stringify(client.tables.media_assets.filter((r) => r.merchant_id === M1).map((r) => [r.id, r.object_path, r.display_order, r.publication_status, r.legacy_image_id])), before);
    assert.equal(client.tables.media_assets.find((r) => r.id === 'g1')!.publication_version, 1);
    assert.equal(audits[0].action, 'media.main_set');
  });
  await t('other Merchants are never touched', async () => {
    const { client, service } = setup();
    await service.setMerchantMain(ADMIN, M1, 'g2');
    assert.deepEqual(heroes(client, M2), ['other']);
  });
  await t('selecting the current Main Photo is an idempotent no-op', async () => {
    const { client, service, audits } = setup();
    assert.equal((await service.setMerchantMain(ADMIN, M1, 'hero')).changed, false);
    assert.deepEqual(heroes(client, M1), ['hero']); assert.equal(audits.length, 0);
  });
  await t('a Merchant with no hero can get one', async () => {
    const { client, service } = setup();
    client.tables.media_assets.find((r) => r.id === 'hero')!.is_hero = false;
    assert.equal((await service.setMerchantMain(ADMIN, M1, 'g2')).changed, true);
    assert.deepEqual(heroes(client, M1), ['g2']);
  });
  await t('tenant isolation: another Merchant\'s image is not found and nothing changes', async () => {
    const { client, service } = setup();
    await rejects(service.setMerchantMain(ADMIN, M1, 'other'), 'NotFoundException');
    await rejects(service.setMerchantMain(ADMIN, M2, 'g1'), 'NotFoundException');
    assert.deepEqual(heroes(client, M1), ['hero']); assert.deepEqual(heroes(client, M2), ['other']);
  });
  await t('only effective, verified images are eligible', async () => {
    const { client, service } = setup();
    await rejects(service.setMerchantMain(ADMIN, M1, 'removed'), 'BadRequestException');
    await rejects(service.setMerchantMain(ADMIN, M1, 'pending'), 'BadRequestException');
    client.tables.media_assets.find((r) => r.id === 'g1')!.transfer_status = 'failed';
    await rejects(service.setMerchantMain(ADMIN, M1, 'g1'), 'BadRequestException');
    assert.deepEqual(heroes(client, M1), ['hero']);
  });
  await t('RBAC: only an active Platform Admin may change the Main Photo', async () => {
    const { client, service } = setup();
    await rejects(service.setMerchantMain('m', M1, 'g1'), 'ForbiddenException');
    await rejects(service.setMerchantMain('nobody', M1, 'g1'), 'ForbiddenException');
    client.tables.user_profiles[0].user_profiles_status = 'blocked';
    await rejects(service.setMerchantMain(ADMIN, M1, 'g1'), 'ForbiddenException');
    assert.deepEqual(heroes(client, M1), ['hero']);
  });
  await t('a pending change request on either image blocks the swap', async () => {
    const { client, service } = setup();
    client.tables.media_approval_requests.push({ status: 'pending', target_media_id: 'hero' });
    await rejects(service.setMerchantMain(ADMIN, M1, 'g1'), 'ConflictException');
    assert.deepEqual(heroes(client, M1), ['hero']);
  });
  await t('a failed promotion restores the previous Main Photo', async () => {
    const { client, service } = setup();
    client.failPromote = true;
    await rejects(service.setMerchantMain(ADMIN, M1, 'g1'), 'InternalServerErrorException');
    assert.deepEqual(heroes(client, M1), ['hero']);
  });
  await t('a concurrent version change aborts the swap and restores the previous hero', async () => {
    const { client, service } = setup();
    const target = client.tables.media_assets.find((r) => r.id === 'g1')!;
    const original = client.from.bind(client);
    client.from = (table: string) => { const chain = original(table); if (table === 'media_assets') { const orig = chain.maybeSingle; chain.maybeSingle = async () => { const r = await orig(); target.publication_version += 5; return r; }; } return chain; };
    await rejects(service.setMerchantMain(ADMIN, M1, 'g1'), 'ConflictException');
    assert.deepEqual(heroes(client, M1), ['hero']);
  });
  await t('concurrent requests for different images leave exactly one Main Photo (serialised)', async () => {
    const { client, service } = setup();
    const results = await Promise.allSettled([service.setMerchantMain(ADMIN, M1, 'g1'), service.setMerchantMain(ADMIN, M1, 'g2'), service.setMerchantMain(ADMIN, M1, 'hero')]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
    assert.equal(heroes(client, M1).length, 1);
    assert.equal(heroes(client, M1)[0], 'hero', 'last request wins');
  });
  await t('a second hero that appears during the swap (other instance) makes this request back out with 409', async () => {
    const { client, service } = setup();
    const original = client.from.bind(client); let promotes = 0;
    client.from = (table: string) => { const chain = original(table); if (table === 'media_assets') { const upd = chain.update; chain.update = (p: Row) => { if (p.is_hero === true && ++promotes === 1) client.tables.media_assets.find((r) => r.id === 'g2')!.is_hero = true; return upd(p); }; } return chain; };
    await rejects(service.setMerchantMain(ADMIN, M1, 'g1'), 'ConflictException');
    assert.deepEqual(heroes(client, M1), ['g2'], 'the other request keeps its choice; ours is withdrawn');
  });
  console.log(`${n} passed`);
})().catch((error) => { console.error(error); process.exit(1); });
