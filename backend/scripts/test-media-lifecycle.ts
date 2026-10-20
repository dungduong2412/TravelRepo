import assert from 'node:assert/strict';
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
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const dto = {
    filename: 'same-name.png',
    mime_type: 'image/png' as const,
    size_bytes: png.length,
    base64_data: png.toString('base64'),
    action: 'add' as const,
    slot: 'main' as const,
    direct_publish: false,
  };
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

  const second = await service.upload('merchant-user', dto);
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

  client.failUploadOnce = true;
  const beforeUploadFailure = { objects: client.objects.size, rows: client.mediaRows.length };
  await assert.rejects(() => service.upload('merchant-user', dto), /Unable to store media object/);
  assert.deepEqual(
    { objects: client.objects.size, rows: client.mediaRows.length },
    beforeUploadFailure,
  );
  pass('Storage failure creates no metadata row or orphan object');

  const retried = await service.upload('merchant-user', dto);
  assert.equal(retried.transfer_status, 'verified');
  assert.equal(client.objects.size, beforeUploadFailure.objects + 1);
  assert.equal(client.mediaRows.length, beforeUploadFailure.rows + 1);
  pass('retry after transient Storage failure succeeds exactly once');

  client.failRequestInsertOnce = true;
  const beforeRequestFailure = { objects: client.objects.size, rows: client.mediaRows.length };
  await assert.rejects(() => service.upload('merchant-user', dto), /Unable to create media approval request/);
  assert.deepEqual({ objects: client.objects.size, rows: client.mediaRows.length }, beforeRequestFailure);
  pass('approval-request failure removes uploaded object and pending metadata');

  client.failInsertOnce = true;
  client.failRemoveCount = 1;
  const beforeMetadataFailure = { objects: client.objects.size, rows: client.mediaRows.length };
  const removeAttemptsBefore = client.removeAttempts.length;
  await assert.rejects(() => service.upload('merchant-user', dto), /Unable to persist media metadata/);
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
    () => service.upload('merchant-user', dto),
    /stored object is tracked as failed/,
  );
  assert.equal(client.objects.size, objectsBeforeTrackedFailure + 1);
  assert.equal(client.mediaRows.length, rowsBeforeTrackedFailure + 1);
  const failedRow = client.mediaRows.at(-1);
  assert.equal(failedRow?.transfer_status, 'failed');
  assert.equal(failedRow?.publication_status, 'failed');
  assert(client.objects.has(`${failedRow?.bucket_id}/${failedRow?.object_path}`));
  pass('persistent cleanup failure keeps the object linked to failed metadata for reconciliation');

  console.log(JSON.stringify({ status: 'PASS', controls: controls.length, results: controls }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
