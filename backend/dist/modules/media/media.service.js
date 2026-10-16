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
            .select('id,merchant_id,collaborator_id,bucket_id,object_path,mime_type,size_bytes,is_hero,display_order,transfer_status');
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
    async findMine(userId) {
        const profile = await this.activeProfile(userId);
        let query = this.supabase.getClient().from('media_assets')
            .select('id,merchant_id,collaborator_id,bucket_id,object_path,original_filename,mime_type,size_bytes,is_hero,display_order,transfer_status,created_at')
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
            is_hero: dto.is_hero || false,
            display_order: dto.display_order || 0,
            transfer_status: 'completed',
        };
        const { data, error } = await client.from('media_assets').insert(record).select().single();
        if (error) {
            await client.storage.from(bucketId).remove([objectPath]);
            throw new common_1.InternalServerErrorException('Unable to persist media metadata');
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