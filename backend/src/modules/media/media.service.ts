import { ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

@Injectable()
export class MediaService {
  constructor(private readonly supabase: SupabaseService) {}

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

  async upsertImported(rows: Record<string, unknown>[]) {
    const { error } = await this.supabase.getClient().from('media_assets').upsert(rows, { onConflict: 'id' });
    if (error) throw new InternalServerErrorException('Unable to persist imported media metadata');
  }
}
