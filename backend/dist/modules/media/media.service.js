"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaService = void 0;
exports.hasExpectedImageSignature = hasExpectedImageSignature;
const common_1 = require("@nestjs/common");
const supabase_service_1 = require("../../infrastructure/supabase/supabase.service");
const crypto_1 = require("crypto");
const media_dto_1 = require("./media.dto");
const audit_service_1 = require("../audit/audit.service");
function hasExpectedImageSignature(bytes, mimeType) {
    if (mimeType === 'image/jpeg')
        return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (mimeType === 'image/png')
        return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mimeType === 'image/webp')
        return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    return false;
}
let MediaService = class MediaService {
    constructor(supabase, audit) {
        this.supabase = supabase;
        this.audit = audit;
    }
    async findAll() {
        const { data, error } = await this.supabase.getClient().from('media_assets')
            .select('id,merchant_id,collaborator_id,bucket_id,object_path,mime_type,size_bytes,is_hero,display_order,transfer_status,publication_status,publication_version,uploaded_by,approved_by,approved_at,effective_from,effective_until');
        if (error)
            throw new common_1.InternalServerErrorException('Unable to load media');
        return data;
    }
    async createAuthorizedSignedUrl(userId, mediaId) {
        const client = this.supabase.getClient();
        const [{ data: profile }, { data: media, error }] = await Promise.all([
            client.from('user_profiles').select('role,user_profiles_status,merchant_id,collaborator_id')
                .eq('user_id', userId).maybeSingle(),
            client.from('media_assets').select('id,merchant_id,collaborator_id,bucket_id,object_path')
                .eq('id', mediaId).maybeSingle(),
        ]);
        if (error || !media)
            throw new common_1.NotFoundException('Media not found');
        const allowed = profile?.user_profiles_status === 'active' && (profile.role === 'admin' ||
            (profile.role === 'merchant' && profile.merchant_id === media.merchant_id) ||
            (profile.role === 'collaborator' && profile.collaborator_id === media.collaborator_id));
        if (!allowed)
            throw new common_1.ForbiddenException('Media access denied');
        const { data, error: signedError } = await client.storage.from(media.bucket_id)
            .createSignedUrl(media.object_path, 300);
        if (signedError)
            throw new common_1.InternalServerErrorException('Unable to sign media URL');
        return { ...data, expires_in: 300 };
    }
    async activeProfile(userId) {
        const { data, error } = await this.supabase.getClient().from('user_profiles')
            .select('role,user_profiles_status,merchant_id,collaborator_id')
            .eq('user_id', userId).maybeSingle();
        if (error || !data || data.user_profiles_status !== 'active') {
            throw new common_1.ForbiddenException('Active profile required');
        }
        return data;
    }
    async removeUploadedObject(client, bucketId, objectPath) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const { error } = await client.storage.from(bucketId).remove([objectPath]);
            if (!error)
                return true;
        }
        return false;
    }
    async findMine(userId) {
        const profile = await this.activeProfile(userId);
        let query = this.supabase.getClient().from('media_assets')
            .select('id,merchant_id,collaborator_id,bucket_id,object_path,original_filename,mime_type,size_bytes,sha256_hex,is_hero,display_order,transfer_status,publication_status,publication_version,created_at,approval_requests:media_approval_requests!media_approval_requests_proposed_media_id_fkey(id,action,slot,status,requested_at,decided_at,decision_reason,target_media_id,requested_display_order)')
            .order('created_at', { ascending: false });
        if (profile.role === 'merchant' && profile.merchant_id)
            query = query.eq('merchant_id', profile.merchant_id);
        else if (profile.role === 'collaborator' && profile.collaborator_id)
            query = query.eq('collaborator_id', profile.collaborator_id);
        else if (profile.role !== 'admin')
            throw new common_1.ForbiddenException('Media access is not assigned');
        const { data, error } = await query;
        if (error)
            throw new common_1.InternalServerErrorException('Unable to load media');
        return data || [];
    }
    async ownedTarget(userId, mediaId) {
        const client = this.supabase.getClient();
        const profile = await this.activeProfile(userId);
        const { data: media, error } = await client.from('media_assets')
            .select('id,merchant_id,collaborator_id,bucket_id,object_path,is_hero,display_order,publication_status,publication_version')
            .eq('id', mediaId).maybeSingle();
        if (error || !media)
            throw new common_1.NotFoundException('Target media not found');
        const owns = profile.role === 'admin' ||
            (profile.role === 'merchant' && profile.merchant_id === media.merchant_id) ||
            (profile.role === 'collaborator' && profile.collaborator_id === media.collaborator_id);
        if (!owns)
            throw new common_1.ForbiddenException('Media target is outside the assigned owner');
        if (!['legacy_effective', 'preexisting_effective', 'approved'].includes(media.publication_status)) {
            throw new common_1.BadRequestException('Only effective media can be changed');
        }
        return { profile, media };
    }
    async upload(userId, dto) {
        const client = this.supabase.getClient();
        const profile = await this.activeProfile(userId);
        let merchantId = null;
        let collaboratorId = null;
        let bucketId;
        let ownerPath;
        if (profile.role === 'merchant' && profile.merchant_id) {
            if (dto.collaborator_id || (dto.merchant_id && dto.merchant_id !== profile.merchant_id)) {
                throw new common_1.ForbiddenException('Media target is outside the merchant assignment');
            }
            merchantId = profile.merchant_id;
            bucketId = 'merchant-media';
            ownerPath = `merchants/${merchantId}`;
        }
        else if (profile.role === 'collaborator' && profile.collaborator_id) {
            if (dto.merchant_id || (dto.collaborator_id && dto.collaborator_id !== profile.collaborator_id)) {
                throw new common_1.ForbiddenException('Media target is outside the collaborator assignment');
            }
            collaboratorId = profile.collaborator_id;
            bucketId = 'partner-media';
            ownerPath = `collaborators/${collaboratorId}`;
        }
        else if (profile.role === 'admin') {
            if (!!dto.merchant_id === !!dto.collaborator_id) {
                throw new common_1.BadRequestException('Admin uploads require exactly one merchant or collaborator target');
            }
            merchantId = dto.merchant_id || null;
            collaboratorId = dto.collaborator_id || null;
            bucketId = merchantId ? 'merchant-media' : 'partner-media';
            ownerPath = merchantId ? `merchants/${merchantId}` : `collaborators/${collaboratorId}`;
            const table = merchantId ? 'merchant_details' : 'collaborators';
            const column = merchantId ? 'merchant_system_id' : 'id';
            const target = merchantId || collaboratorId;
            const { data } = await client.from(table).select(column).eq(column, target).maybeSingle();
            if (!data)
                throw new common_1.BadRequestException('Media target does not exist');
        }
        else {
            throw new common_1.ForbiddenException('Media upload is not assigned');
        }
        if (dto.direct_publish && profile.role !== 'admin') {
            throw new common_1.ForbiddenException('Only Platform Admin can directly publish media');
        }
        let targetMedia = null;
        if (dto.action === 'replace' && dto.target_media_id) {
            targetMedia = (await this.ownedTarget(userId, dto.target_media_id)).media;
            if (targetMedia.merchant_id !== merchantId || targetMedia.collaborator_id !== collaboratorId) {
                throw new common_1.ForbiddenException('Replacement target owner mismatch');
            }
        }
        let bytes;
        try {
            bytes = Buffer.from(dto.base64_data, 'base64');
        }
        catch {
            throw new common_1.BadRequestException('Invalid base64 media payload');
        }
        if (!bytes.length || bytes.length !== dto.size_bytes || bytes.length > media_dto_1.MAX_MEDIA_BYTES) {
            throw new common_1.BadRequestException('Media size does not match the declared size');
        }
        if (!hasExpectedImageSignature(bytes, dto.mime_type)) {
            throw new common_1.BadRequestException('Media content signature does not match its MIME type');
        }
        const id = (0, crypto_1.randomUUID)();
        const safeFilename = dto.filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'upload';
        const objectPath = `${ownerPath}/${id}-${safeFilename}`;
        const { error: uploadError } = await client.storage.from(bucketId).upload(objectPath, bytes, {
            contentType: dto.mime_type,
            upsert: false,
        });
        if (uploadError)
            throw new common_1.InternalServerErrorException('Unable to store media object');
        const record = {
            id,
            merchant_id: merchantId,
            collaborator_id: collaboratorId,
            bucket_id: bucketId,
            object_path: objectPath,
            original_filename: dto.filename,
            mime_type: dto.mime_type,
            sha256_hex: (0, crypto_1.createHash)('sha256').update(bytes).digest('hex'),
            size_bytes: bytes.length,
            uploaded_by: userId,
            is_hero: false,
            display_order: dto.display_order || 0,
            transfer_status: 'verified',
            publication_status: 'pending',
        };
        const { data, error } = await client.from('media_assets').insert(record).select().single();
        if (error) {
            const removed = await this.removeUploadedObject(client, bucketId, objectPath);
            if (!removed) {
                const { error: trackingError } = await client.from('media_assets').insert({
                    ...record,
                    transfer_status: 'failed',
                    publication_status: 'failed',
                });
                if (trackingError) {
                    throw new common_1.InternalServerErrorException('Unable to persist media metadata; stored object requires reconciliation');
                }
                throw new common_1.InternalServerErrorException('Unable to persist verified media metadata; stored object is tracked as failed');
            }
            throw new common_1.InternalServerErrorException('Unable to persist media metadata');
        }
        const { data: approvalRequest, error: requestError } = await client.from('media_approval_requests').insert({
            owner_type: merchantId ? 'merchant' : 'collaborator',
            merchant_id: merchantId,
            collaborator_id: collaboratorId,
            action: dto.action,
            slot: dto.slot,
            proposed_media_id: id,
            target_media_id: targetMedia?.id || null,
            requested_display_order: dto.display_order ?? (dto.slot === 'main' ? 0 : null),
            expected_target_version: targetMedia?.publication_version ?? null,
            requested_by: userId,
        }).select().single();
        if (requestError || !approvalRequest) {
            const removed = await this.removeUploadedObject(client, bucketId, objectPath);
            if (removed) {
                await client.from('media_assets').delete().eq('id', id).eq('publication_status', 'pending');
            }
            else {
                await client.from('media_assets').update({ transfer_status: 'failed', publication_status: 'failed' }).eq('id', id);
                throw new common_1.InternalServerErrorException('Unable to create approval request; stored object is tracked as failed');
            }
            throw new common_1.InternalServerErrorException('Unable to create media approval request');
        }
        await this.audit.record({ id: userId, role: profile.role }, 'media.proposed', 'media_asset', id, {
            merchant_id: merchantId,
            collaborator_id: collaboratorId,
            mime_type: dto.mime_type,
            size_bytes: bytes.length,
            sha256_hex: record.sha256_hex,
            approval_request_id: approvalRequest.id,
            action: dto.action,
            slot: dto.slot,
        });
        if (dto.direct_publish) {
            const decision = await this.approve(userId, approvalRequest.id, 'Direct Platform Admin publication');
            const { data: published } = await client.from('media_assets').select('*').eq('id', id).single();
            return { ...published, approval_request: decision };
        }
        return { ...data, approval_request: approvalRequest };
    }
    async requestChange(userId, dto) {
        const { profile, media } = await this.ownedTarget(userId, dto.target_media_id);
        const { data, error } = await this.supabase.getClient().from('media_approval_requests').insert({
            owner_type: media.merchant_id ? 'merchant' : 'collaborator',
            merchant_id: media.merchant_id,
            collaborator_id: media.collaborator_id,
            action: dto.action,
            slot: media.is_hero ? 'main' : 'gallery',
            proposed_media_id: null,
            target_media_id: media.id,
            requested_display_order: dto.display_order ?? null,
            expected_target_version: media.publication_version,
            requested_by: userId,
        }).select().single();
        if (error || !data)
            throw new common_1.BadRequestException('Unable to create media change request');
        await this.audit.record({ id: userId, role: profile.role }, 'media.change_requested', 'media_approval_request', data.id, {
            action: dto.action, target_media_id: media.id, requested_display_order: dto.display_order,
        });
        return data;
    }
    async cancel(userId, requestId) {
        const client = this.supabase.getClient();
        const { data: request } = await client.from('media_approval_requests')
            .select('id,proposed_media_id,proposed:media_assets!media_approval_requests_proposed_media_id_fkey(bucket_id,object_path)')
            .eq('id', requestId).maybeSingle();
        const { data, error } = await client.rpc('cancel_media_request', {
            p_request_id: requestId, p_actor_user_id: userId,
        });
        if (error)
            throw new common_1.BadRequestException(error.message);
        let object_removed = null;
        const proposed = Array.isArray(request?.proposed) ? request?.proposed[0] : request?.proposed;
        if (proposed?.bucket_id && proposed?.object_path) {
            object_removed = await this.removeUploadedObject(client, proposed.bucket_id, proposed.object_path);
        }
        return { request: data, object_removed };
    }
    async approve(userId, requestId, reason) {
        const { data, error } = await this.supabase.getClient().rpc('approve_media_request', {
            p_request_id: requestId, p_actor_user_id: userId, p_reason: reason || null,
        });
        if (error)
            throw new common_1.BadRequestException(error.message);
        return data;
    }
    async reject(userId, requestId, reason) {
        if (!reason?.trim())
            throw new common_1.BadRequestException('Rejection reason is required');
        const { data, error } = await this.supabase.getClient().rpc('reject_media_request', {
            p_request_id: requestId, p_actor_user_id: userId, p_reason: reason.trim(),
        });
        if (error)
            throw new common_1.BadRequestException(error.message);
        return data;
    }
    async approvalQueue(filter) {
        const from = (filter.page - 1) * filter.page_size;
        let query = this.supabase.getClient().from('media_approval_requests').select([
            'id,owner_type,merchant_id,collaborator_id,action,slot,status,requested_display_order,expected_target_version,requested_by,requested_at,decided_by,decided_at,decision_reason',
            'merchant:merchant_details!media_approval_requests_merchant_id_fkey(merchant_system_id,merchant_code,merchant_name)',
            'collaborator:collaborators!media_approval_requests_collaborator_id_fkey(id,collaborators_code,collaborators_name)',
            'proposed:media_assets!media_approval_requests_proposed_media_id_fkey(id,original_filename,mime_type,size_bytes,sha256_hex,bucket_id,object_path,publication_status)',
            'target:media_assets!media_approval_requests_target_media_id_fkey(id,original_filename,mime_type,size_bytes,sha256_hex,bucket_id,object_path,is_hero,display_order,publication_status,publication_version)',
        ].join(','), { count: 'exact' }).eq('status', filter.status);
        if (filter.owner_type)
            query = query.eq('owner_type', filter.owner_type);
        const { data, error, count } = await query.order('requested_at', { ascending: true })
            .range(from, from + filter.page_size - 1);
        if (error)
            throw new common_1.InternalServerErrorException('Unable to load media approvals');
        return { items: data || [], page: filter.page, page_size: filter.page_size, total: count || 0,
            page_count: Math.ceil((count || 0) / filter.page_size) };
    }
    async findEffective(ownerType, ownerId) {
        if (!['merchant', 'collaborator'].includes(ownerType) || !/^[0-9a-f-]{36}$/i.test(ownerId)) {
            throw new common_1.BadRequestException('Invalid media owner');
        }
        const client = this.supabase.getClient();
        const query = client.from('media_assets').select('id,bucket_id,object_path,original_filename,mime_type,size_bytes,sha256_hex,is_hero,display_order,publication_status,effective_from')
            .eq(ownerType === 'merchant' ? 'merchant_id' : 'collaborator_id', ownerId)
            .in('publication_status', ['legacy_effective', 'preexisting_effective', 'approved'])
            .eq('transfer_status', 'verified').order('is_hero', { ascending: false }).order('display_order');
        const { data, error } = await query;
        if (error)
            throw new common_1.InternalServerErrorException('Unable to load approved media');
        return Promise.all((data || []).map(async (asset) => {
            const { data: signed, error: signedError } = await client.storage.from(asset.bucket_id).createSignedUrl(asset.object_path, 300);
            if (signedError)
                throw new common_1.InternalServerErrorException('Unable to sign approved media');
            return { ...asset, signed_url: signed.signedUrl, expires_in: 300 };
        }));
    }
    async upsertImported(rows) {
        const { error } = await this.supabase.getClient().from('media_assets').upsert(rows, { onConflict: 'id' });
        if (error)
            throw new common_1.InternalServerErrorException('Unable to persist imported media metadata');
    }
};
exports.MediaService = MediaService;
exports.MediaService = MediaService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService,
        audit_service_1.AuditService])
], MediaService);
//# sourceMappingURL=media.service.js.map