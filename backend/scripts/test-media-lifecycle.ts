import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { MediaService } from '../src/modules/media/media.service';

type MediaRow = Record<string, any>;

class FakeSupabaseClient {
  readonly objects = new Map<string, Buffer>();
  readonly mediaRows: MediaRow[] = [];
  readonly approvalRows: MediaRow[] = [];
  readonly removeAttempts: string[] = [];
  failUploadOnce = false;
  failInsertOnce = false;
  failRequestInsertOnce = false;
  failRemoveCount = 0;

  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Buffer, options: { upsert: boolean }) => {
        const key = `${bucket}/${path}`;
        if (this.failUploadOnce) {
          this.failUploadOnce = false;
          return { error: new Error('synthetic upload failure') };
        }
        if (!options.upsert && this.objects.has(key)) return { error: new Error('duplicate object') };
        this.objects.set(key, Buffer.from(bytes));
        return { error: null };
      },
      remove: async (paths: string[]) => {
        const key = `${bucket}/${paths[0]}`;
        this.removeAttempts.push(key);
        if (this.failRemoveCount > 0) {
          this.failRemoveCount -= 1;
          return { error: new Error('synthetic cleanup failure') };
        }
        this.objects.delete(key);
        return { error: null };
      },
    }),
  };

  from(table: string) {
    if (table === 'user_profiles') {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: {
            role: 'merchant',
            user_profiles_status: 'active',
            merchant_id: '20000000-0000-5000-8000-000000000002',
            collaborator_id: null,
          },
          error: null,
        }),
      };
      return chain;
    }
    if (table === 'media_assets') {
      return {
        select: () => {
          const conditions: Array<[string, unknown]> = []; let statuses: string[] | null = null;
          const chain: any = {
            eq: (column: string, value: unknown) => { conditions.push([column, value]); return chain; },
            in: (_column: string, values: string[]) => { statuses = values; return chain; },
            limit: () => chain,
            maybeSingle: async () => ({ data: this.mediaRows.find((r) => conditions.every(([c, v]) => r[c] === v)) ?? null, error: null }),
            then: (resolve: (value: any) => unknown) => resolve({ data: this.mediaRows.filter((r) => conditions.every(([c, v]) => r[c] === v) && (!statuses || statuses.includes(r.publication_status))), error: null }),
          };
          return chain;
        },
        insert: (row: MediaRow) => {
          const execute = async () => {
            if (this.failInsertOnce) {
              this.failInsertOnce = false;
              return { data: null, error: new Error('synthetic metadata failure') };
            }
            this.mediaRows.push({ ...row });
            return { data: { ...row }, error: null };
          };
          const result = {
            then: (resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) =>
              execute().then(resolve, reject),
            select: () => ({
            single: async () => {
              return execute();
            },
          }),
          };
          return result;
        },
        delete: () => {
          let id: string | undefined;
          const chain: any = { eq: (column: string, value: unknown) => { if (column === 'id') id = String(value); return chain; }, then: (resolve: (value: any) => unknown) => { const index = this.mediaRows.findIndex((row) => row.id === id); if (index >= 0) this.mediaRows.splice(index, 1); return Promise.resolve({ error: null }).then(resolve); } };
          return chain;
        },
        update: (patch: MediaRow) => {
          let id: string | undefined;
          const chain: any = { eq: (column: string, value: unknown) => { if (column === 'id') id = String(value); return chain; }, then: (resolve: (value: any) => unknown) => { const row = this.mediaRows.find((candidate) => candidate.id === id); if (row) Object.assign(row, patch); return Promise.resolve({ error: null }).then(resolve); } };
          return chain;
        },
      };
    }
    if (table === 'media_approval_requests') {
      return {
        select: () => {
          const conditions: Array<[string, unknown]> = [];
          const chain: any = { eq: (column: string, value: unknown) => { conditions.push([column, value]); return chain; }, limit: () => chain,
            then: (resolve: (value: any) => unknown) => resolve({ data: this.approvalRows.filter((r) => conditions.every(([c, v]) => r[c] === v)), error: null }) };
          return chain;
        },
        insert: (row: MediaRow) => ({
          select: () => ({ single: async () => {
            if (this.failRequestInsertOnce) { this.failRequestInsertOnce = false; return { data: null, error: new Error('synthetic request failure') }; }
            const saved = { id: `approval-${this.approvalRows.length + 1}`, status: 'pending', ...row };
            this.approvalRows.push(saved);
            return { data: saved, error: null };
          } }),
        }),
      };
    }
    throw new Error(`Unexpected fake table: ${table}`);
  }
}

async function main() {
  const client = new FakeSupabaseClient();
  const auditEvents: MediaRow[] = [];
  const service = new MediaService(
    { getClient: () => client } as any,
    { record: async (...args: any[]) => auditEvents.push({ args }) } as any,
  );
  // Real, minimal PNGs (valid header and data): the service reads the pixel size, so a signature-only fake is (rightly) refused.
  const crc = (buf: Buffer) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (~c) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const makePng = (shade: number, w = 40, h = 40) => {
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, shade)]);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
  };
  const dtoOf = (png: Buffer, extra: Record<string, unknown> = {}) => ({
    filename: 'same-name.png', mime_type: 'image/png' as const, size_bytes: png.length, base64_data: png.toString('base64'), action: 'add' as const, slot: 'main' as const, direct_publish: false, ...extra,
  });
  const png = makePng(10); const dto = dtoOf(png);
  const controls: Array<{ name: string; status: 'PASS' }> = [];
  const pass = (name: string) => controls.push({ name, status: 'PASS' });

  const first = await service.upload('merchant-user', dto);
  assert.equal(first.transfer_status, 'verified');
  assert.equal(first.publication_status, 'pending');
  assert.equal(first.approval_request.status, 'pending');
  assert.equal(first.bucket_id, 'merchant-media');
  assert.equal(first.size_bytes, png.length);
  assert.equal(first.sha256_hex.length, 64);
  assert.equal(client.objects.size, 1);
  assert.equal(client.mediaRows.length, 1);
  assert.equal(auditEvents.length, 1);
  pass('successful upload is verified, checksummed, persisted and audited');

  const secondDto = dtoOf(makePng(20));
  const second = await service.upload('merchant-user', secondDto);
  assert.notEqual(second.id, first.id);
  assert.notEqual(second.object_path, first.object_path);
  assert.equal(client.objects.size, 2);
  assert.equal(client.mediaRows.length, 2);
  pass('duplicate filename creates a distinct non-overwriting object');

  const beforeSignatureFailure = { objects: client.objects.size, rows: client.mediaRows.length };
  await assert.rejects(() => service.upload('merchant-user', {
    ...dto,
    filename: 'mismatch.jpg',
    mime_type: 'image/jpeg',
  }));
  assert.deepEqual(
    { objects: client.objects.size, rows: client.mediaRows.length },
    beforeSignatureFailure,
  );
  pass('MIME/signature failure creates no object or metadata row');

  const dtoC = dtoOf(makePng(30), { slot: 'gallery' });
  client.failUploadOnce = true;
  const beforeUploadFailure = { objects: client.objects.size, rows: client.mediaRows.length };
  await assert.rejects(() => service.upload('merchant-user', dtoC), /Unable to store media object/);
  assert.deepEqual(
    { objects: client.objects.size, rows: client.mediaRows.length },
    beforeUploadFailure,
  );
  pass('Storage failure creates no metadata row or orphan object');

  const retried = await service.upload('merchant-user', dtoC);
  assert.equal(retried.transfer_status, 'verified');
  assert.equal(client.objects.size, beforeUploadFailure.objects + 1);
  assert.equal(client.mediaRows.length, beforeUploadFailure.rows + 1);
  pass('retry after transient Storage failure succeeds exactly once');

  client.failRequestInsertOnce = true;
  const beforeRequestFailure = { objects: client.objects.size, rows: client.mediaRows.length };
  await assert.rejects(() => service.upload('merchant-user', dtoOf(makePng(40))), /Unable to create media approval request/);
  assert.deepEqual({ objects: client.objects.size, rows: client.mediaRows.length }, beforeRequestFailure);
  pass('approval-request failure removes uploaded object and pending metadata');

  client.failInsertOnce = true;
  client.failRemoveCount = 1;
  const beforeMetadataFailure = { objects: client.objects.size, rows: client.mediaRows.length };
  const removeAttemptsBefore = client.removeAttempts.length;
  await assert.rejects(() => service.upload('merchant-user', dtoOf(makePng(50))), /Unable to persist media metadata/);
  assert.deepEqual(
    { objects: client.objects.size, rows: client.mediaRows.length },
    beforeMetadataFailure,
  );
  assert.equal(client.removeAttempts.length - removeAttemptsBefore, 2);
  pass('metadata failure retries cleanup once and leaves no orphan object or row');

  client.failInsertOnce = true;
  client.failRemoveCount = 2;
  const rowsBeforeTrackedFailure = client.mediaRows.length;
  const objectsBeforeTrackedFailure = client.objects.size;
  await assert.rejects(
    () => service.upload('merchant-user', dtoOf(makePng(60))),
    /stored object is tracked as failed/,
  );
  assert.equal(client.objects.size, objectsBeforeTrackedFailure + 1);
  assert.equal(client.mediaRows.length, rowsBeforeTrackedFailure + 1);
  const failedRow = client.mediaRows.at(-1);
  assert.equal(failedRow?.transfer_status, 'failed');
  assert.equal(failedRow?.publication_status, 'failed');
  assert(client.objects.has(`${failedRow?.bucket_id}/${failedRow?.object_path}`));
  pass('persistent cleanup failure keeps the object linked to failed metadata for reconciliation');

  // ---- new rules -------------------------------------------------------------------------------------------------------------------------------
  const codeOf = (e: any) => e?.getResponse?.().code; const statusOf = (e: any) => e?.getStatus?.();
  const snapshot = () => ({ objects: client.objects.size, rows: client.mediaRows.length, approvals: client.approvalRows.length });
  const refused = async (label: string, d: any, code: string, status: number) => {
    const before = snapshot(); await assert.rejects(() => service.upload('merchant-user', d), (e: any) => codeOf(e) === code && statusOf(e) === status && /[À-ỹ]/.test(String(e.getResponse().message)), label);
    assert.deepEqual(snapshot(), before, `${label}: nothing is stored`);
  };
  await refused('a repeated submission of a PENDING image', dto, 'MEDIA_DUPLICATE', 409); pass('the same image submitted again while pending is refused (409 MEDIA_DUPLICATE), nothing stored');
  client.mediaRows.find((r) => r.sha256_hex === first.sha256_hex)!.publication_status = 'approved';
  await refused('an image that is already showing', dto, 'MEDIA_DUPLICATE', 409); pass('an image already in the profile is refused as a duplicate');
  const truncated = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  await refused('right signature, no real header', dtoOf(truncated), 'MEDIA_CORRUPT', 400); pass('a file with a valid signature but no readable image header is refused (MEDIA_CORRUPT)');
  await refused('degenerate 1x1 image', dtoOf(makePng(70, 1, 1)), 'MEDIA_TOO_SMALL', 400); pass('an image smaller than 32 px is refused (MEDIA_TOO_SMALL)');
  await refused('absurd dimensions', dtoOf(makePng(71, 13000, 40)), 'MEDIA_TOO_LARGE_DIMENSIONS', 400); pass('an image larger than 12000 px per side is refused');
  await refused('declared size lies', { ...dtoOf(makePng(72)), size_bytes: 5 }, 'MEDIA_SIZE_MISMATCH', 400); pass('a declared size that does not match the bytes is refused');
  await refused('wrong extension for the content', { ...dtoOf(makePng(73)), mime_type: 'image/jpeg' as const }, 'MEDIA_SIGNATURE', 400); pass('content that does not match its MIME type is refused with an actionable message');
  // a pending proposal never blocks an UNRELATED new image
  const unrelated = await service.upload('merchant-user', dtoOf(makePng(80), { slot: 'gallery' })); assert.equal(unrelated.publication_status, 'pending'); pass('a pending proposal does not block a different, valid image');
  // owner association: the stored row and object belong to the Merchant of the signed-in profile
  for (const row of client.mediaRows) { assert.equal(row.merchant_id, '20000000-0000-5000-8000-000000000002'); assert.equal(row.collaborator_id, null); assert.ok(String(row.object_path).startsWith('merchants/20000000-0000-5000-8000-000000000002/')); }
  pass('every stored image is owned by the signed-in Merchant, in its own folder');
  await assert.rejects(() => service.upload('merchant-user', dtoOf(makePng(81), { merchant_id: '30000000-0000-5000-8000-000000000003' })), (e: any) => statusOf(e) === 403); pass('an upload aimed at another Merchant is forbidden');

  console.log(JSON.stringify({ status: 'PASS', controls: controls.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
