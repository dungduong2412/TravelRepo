import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { createHash, randomUUID } from 'crypto';
import { MAX_MEDIA_BYTES, UploadMediaDto } from './media.dto';
import { AuditService } from '../audit/audit.service';

export function hasExpectedImageSignature(bytes: Buffer, mimeType: string) {
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

@Injectable()
export class MediaService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
  ) {}

  async findAll() {
    const { data, error } = await this.supabase.getClient().from('media_assets')
      .select('id,merchant_id,collaborator_id,bucket_id,object_path,mime_type,size_bytes,is_hero,display_order,transfer_status');
    if (error) throw new InternalServerErrorException('Unable to load media');
    return data;
  }

  async createAuthorizedSignedUrl(userId: string, mediaId: string) {
    const client = this.supabase.getClient();
    const [{ data: profile }, { data: media, error }] = await Promise.all([
      client.from('user_profiles').select('role,user_profiles_status,merchant_id,collaborator_id')
        .eq('user_id', userId).maybeSingle(),
      client.from('media_assets').select('id,merchant_id,collaborator_id,bucket_id,object_path')
        .eq('id', mediaId).maybeSingle(),
    ]);
    if (error || !media) throw new NotFoundException('Media not found');
    const allowed = profile?.user_profiles_status === 'active' && (
      profile.role === 'admin' ||
      (profile.role === 'merchant' && profile.merchant_id === media.merchant_id) ||
      (profile.role === 'collaborator' && profile.collaborator_id === media.collaborator_id)
    );
    if (!allowed) throw new ForbiddenException('Media access denied');
    const { data, error: signedError } = await client.storage.from(media.bucket_id)
      .createSignedUrl(media.object_path, 300);
    if (signedError) throw new InternalServerErrorException('Unable to sign media URL');
    return { ...data, expires_in: 300 };
  }

  private async activeProfile(userId: string) {
    const { data, error } = await this.supabase.getClient().from('user_profiles')
      .select('role,user_profiles_status,merchant_id,collaborator_id')
      .eq('user_id', userId).maybeSingle();
    if (error || !data || data.user_profiles_status !== 'active') {
      throw new ForbiddenException('Active profile required');
    }
    return data;
  }

  private async removeUploadedObject(
    client: ReturnType<SupabaseService['getClient']>,
    bucketId: 'merchant-media' | 'partner-media',
    objectPath: string,
  ) {
    // A metadata failure must not leave an untracked private object. Retry the
    // compensating delete once for transient Storage errors, then surface the
    // cleanup failure instead of hiding a possible orphan.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { error } = await client.storage.from(bucketId).remove([objectPath]);
      if (!error) return true;
    }
    return false;
  }

  async findMine(userId: string) {
    const profile = await this.activeProfile(userId);
    let query = this.supabase.getClient().from('media_assets')
      .select('id,merchant_id,collaborator_id,bucket_id,object_path,original_filename,mime_type,size_bytes,is_hero,display_order,transfer_status,created_at')
      .order('created_at', { ascending: false });
    if (profile.role === 'merchant' && profile.merchant_id) query = query.eq('merchant_id', profile.merchant_id);
    else if (profile.role === 'collaborator' && profile.collaborator_id) query = query.eq('collaborator_id', profile.collaborator_id);
    else if (profile.role !== 'admin') throw new ForbiddenException('Media access is not assigned');
    const { data, error } = await query;
    if (error) throw new InternalServerErrorException('Unable to load media');
    return data || [];
  }

  async upload(userId: string, dto: UploadMediaDto) {
    const client = this.supabase.getClient();
    const profile = await this.activeProfile(userId);
    let merchantId: string | null = null;
    let collaboratorId: string | null = null;
    let bucketId: 'merchant-media' | 'partner-media';
    let ownerPath: string;

    if (profile.role === 'merchant' && profile.merchant_id) {
      if (dto.collaborator_id || (dto.merchant_id && dto.merchant_id !== profile.merchant_id)) {
        throw new ForbiddenException('Media target is outside the merchant assignment');
      }
      merchantId = profile.merchant_id;
      bucketId = 'merchant-media';
      ownerPath = `merchants/${merchantId}`;
    } else if (profile.role === 'collaborator' && profile.collaborator_id) {
      if (dto.merchant_id || (dto.collaborator_id && dto.collaborator_id !== profile.collaborator_id)) {
        throw new ForbiddenException('Media target is outside the collaborator assignment');
      }
      collaboratorId = profile.collaborator_id;
      bucketId = 'partner-media';
      ownerPath = `collaborators/${collaboratorId}`;
    } else if (profile.role === 'admin') {
      if (!!dto.merchant_id === !!dto.collaborator_id) {
        throw new BadRequestException('Admin uploads require exactly one merchant or collaborator target');
      }
      merchantId = dto.merchant_id || null;
      collaboratorId = dto.collaborator_id || null;
      bucketId = merchantId ? 'merchant-media' : 'partner-media';
      ownerPath = merchantId ? `merchants/${merchantId}` : `collaborators/${collaboratorId}`;
      const table = merchantId ? 'merchant_details' : 'collaborators';
      const column = merchantId ? 'merchant_system_id' : 'id';
      const target = merchantId || collaboratorId;
      const { data } = await client.from(table).select(column).eq(column, target).maybeSingle();
      if (!data) throw new BadRequestException('Media target does not exist');
    } else {
      throw new ForbiddenException('Media upload is not assigned');
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(dto.base64_data, 'base64');
    } catch {
      throw new BadRequestException('Invalid base64 media payload');
    }
    if (!bytes.length || bytes.length !== dto.size_bytes || bytes.length > MAX_MEDIA_BYTES) {
      throw new BadRequestException('Media size does not match the declared size');
    }
    if (!hasExpectedImageSignature(bytes, dto.mime_type)) {
      throw new BadRequestException('Media content signature does not match its MIME type');
    }

    const id = randomUUID();
    const safeFilename = dto.filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'upload';
    const objectPath = `${ownerPath}/${id}-${safeFilename}`;
    const { error: uploadError } = await client.storage.from(bucketId).upload(objectPath, bytes, {
      contentType: dto.mime_type,
      upsert: false,
    });
    if (uploadError) throw new InternalServerErrorException('Unable to store media object');

    const record = {
      id,
      merchant_id: merchantId,
      collaborator_id: collaboratorId,
      bucket_id: bucketId,
      object_path: objectPath,
      original_filename: dto.filename,
      mime_type: dto.mime_type,
      sha256_hex: createHash('sha256').update(bytes).digest('hex'),
      size_bytes: bytes.length,
      is_hero: dto.is_hero || false,
      display_order: dto.display_order || 0,
      transfer_status: 'verified',
    };
    const { data, error } = await client.from('media_assets').insert(record).select().single();
    if (error) {
      const removed = await this.removeUploadedObject(client, bucketId, objectPath);
      if (!removed) {
        // If Storage cleanup is unavailable, keep the object discoverable for
        // reconciliation instead of leaving an untracked blob behind.
        const { error: trackingError } = await client.from('media_assets').insert({
          ...record,
          transfer_status: 'failed',
        });
        if (trackingError) {
          throw new InternalServerErrorException('Unable to persist media metadata; stored object requires reconciliation');
        }
        throw new InternalServerErrorException('Unable to persist verified media metadata; stored object is tracked as failed');
      }
      throw new InternalServerErrorException('Unable to persist media metadata');
    }
    await this.audit.record({ id: userId, role: profile.role }, 'media.uploaded', 'media_asset', id, {
      merchant_id: merchantId,
      collaborator_id: collaboratorId,
      mime_type: dto.mime_type,
      size_bytes: bytes.length,
      sha256_hex: record.sha256_hex,
    });
    return data;
  }

  async upsertImported(rows: Record<string, unknown>[]) {
    const { error } = await this.supabase.getClient().from('media_assets').upsert(rows, { onConflict: 'id' });
    if (error) throw new InternalServerErrorException('Unable to persist imported media metadata');
  }
}
