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
const common_1 = require("@nestjs/common");
const supabase_service_1 = require("../../infrastructure/supabase/supabase.service");
let MediaService = class MediaService {
    constructor(supabase) {
        this.supabase = supabase;
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
    async upsertImported(rows) {
        const { error } = await this.supabase.getClient().from('media_assets').upsert(rows, { onConflict: 'id' });
        if (error)
            throw new common_1.InternalServerErrorException('Unable to persist imported media metadata');
    }
};
exports.MediaService = MediaService;
exports.MediaService = MediaService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], MediaService);
//# sourceMappingURL=media.service.js.map