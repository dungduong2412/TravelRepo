"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollaboratorsService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const supabase_service_1 = require("../../infrastructure/supabase/supabase.service");
const user_profiles_service_1 = require("../user-profiles/user-profiles.service");
const QRCode = __importStar(require("qrcode"));
const audit_service_1 = require("../audit/audit.service");
let CollaboratorsService = class CollaboratorsService {
    constructor(supabase, userProfilesService, audit) {
        this.supabase = supabase;
        this.userProfilesService = userProfilesService;
        this.audit = audit;
    }
    async createCollaborator(actor, dto) {
        await this.userProfilesService.assertIdentityAvailable(dto.collaborators_email);
        const { collaborators_password, ...restDto } = dto;
        const insertData = {
            ...restDto,
            collaborators_password: null,
            collaborators_code: this.generateCollaboratorCode(),
            collaborators_verified: false,
            collaborators_status: 'pending',
            collaborators_registered_date: new Date().toISOString(),
        };
        const { data, error } = await this.supabase.getClient()
            .from('collaborators')
            .insert(insertData)
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to create collaborator: ${error.message}`);
        }
        if (data.collaborators_email && collaborators_password) {
            try {
                await this.userProfilesService.createOrUpdate({
                    email: data.collaborators_email,
                    role: 'collaborator',
                    merchant_id: null,
                    collaborator_id: data.id,
                    password: collaborators_password,
                    status: 'pending',
                });
            }
            catch (identityError) {
                await this.supabase.getClient().from('collaborators').delete().eq('id', data.id);
                throw identityError;
            }
        }
        return this.withoutPassword(data);
    }
    async createByAdmin(actor, dto) {
        if (dto.merchant_system_id) {
            const { data: merchant } = await this.supabase.getClient().from('merchant_details')
                .select('merchant_system_id').eq('merchant_system_id', dto.merchant_system_id).maybeSingle();
            if (!merchant)
                throw new common_1.BadRequestException('Assigned merchant does not exist');
        }
        const { data, error } = await this.supabase.getClient().from('collaborators').insert({
            ...dto,
            collaborators_code: this.generateCollaboratorCode(),
            collaborators_password: null,
            collaborators_registered_date: new Date().toISOString(),
            collaborators_verified: false,
            collaborators_status: 'pending',
        }).select().single();
        if (error)
            throw new common_1.BadRequestException(`Failed to create collaborator: ${error.message}`);
        await this.audit.record(actor, 'collaborator.created', 'collaborator', data.id, {
            code: data.collaborators_code,
            merchant_system_id: data.merchant_system_id,
            status: data.collaborators_status,
        });
        return this.withoutPassword(data);
    }
    withoutPassword(row) {
        if (!row)
            return row;
        const { collaborators_password: _password, ...safe } = row;
        return safe;
    }
    async assertOwner(actor, collaboratorId) {
        if (!actor?.id)
            throw new common_1.ForbiddenException('Collaborator access denied');
        const { data: profile } = await this.supabase.getClient().from('user_profiles')
            .select('role,user_profiles_status,collaborator_id').eq('user_id', actor.id).maybeSingle();
        if (!profile || profile.user_profiles_status !== 'active' ||
            !(profile.role === 'collaborator' && profile.collaborator_id === collaboratorId)) {
            throw new common_1.ForbiddenException('Collaborator access denied');
        }
    }
    async requireActiveCollaboratorProfile(userId) {
        const { data: profile, error } = await this.supabase.getClient().from('user_profiles')
            .select('id,role,user_profiles_status,collaborator_id')
            .eq('user_id', userId)
            .maybeSingle();
        if (error || !profile || profile.role !== 'collaborator' ||
            profile.user_profiles_status !== 'active' || !profile.collaborator_id) {
            throw new common_1.ForbiddenException('Active collaborator access required');
        }
        return profile;
    }
    async getMyCollaborator(actor) {
        if (!actor?.id) {
            throw new common_1.NotFoundException('User identity not found in token');
        }
        const profile = await this.requireActiveCollaboratorProfile(actor.id);
        const { data, error } = await this.supabase.getClient()
            .from('collaborators')
            .select('*')
            .eq('id', profile.collaborator_id)
            .maybeSingle();
        if (error) {
            throw new Error(`Failed to fetch collaborator: ${error.message}`);
        }
        if (!data) {
            throw new common_1.NotFoundException('Collaborator not found');
        }
        return this.withoutPassword(data);
    }
    async getMyQrCode(actor) {
        const collaborator = await this.getMyCollaborator(actor);
        if (!collaborator.collaborators_verified) {
            throw new common_1.ForbiddenException('Collaborator must be verified to access QR code');
        }
        const payload = collaborator.collaborators_code;
        const qrCodeImage = await this.generateCodeImage(payload, 360);
        return {
            qr_code: qrCodeImage,
            qr_code_image: qrCodeImage,
            qr_payload: payload,
            qr_payload_format: 'collaborator_code',
            code: collaborator.collaborators_code,
            collaborator_code: collaborator.collaborators_code,
            name: collaborator.collaborators_name,
            collaborator_name: collaborator.collaborators_name,
            collaborator_phone: collaborator.collaborators_phone,
            verified: collaborator.collaborators_verified,
        };
    }
    generateCollaboratorCode() {
        return 'COL-' + (0, crypto_1.randomBytes)(8).toString('hex').toUpperCase();
    }
    async generateCodeImage(code, width = 300) {
        try {
            return await QRCode.toDataURL(code, {
                errorCorrectionLevel: 'H',
                type: 'image/png',
                width,
                margin: 1,
            });
        }
        catch {
            throw new Error('Failed to generate QR code');
        }
    }
    collaboratorCodeFromPayload(payload) {
        const trimmed = payload.trim();
        try {
            const parsed = new URL(trimmed);
            const segments = parsed.pathname.split('/').filter(Boolean);
            if (segments.length >= 2 && segments[segments.length - 2] === 'c') {
                return decodeURIComponent(segments[segments.length - 1] || '').trim();
            }
        }
        catch {
        }
        return trimmed;
    }
    async updateCollaborator(actor, collaboratorId, dto) {
        await this.assertOwner(actor, collaboratorId);
        const { data: collaborator, error: fetchError } = await this.supabase.getClient()
            .from('collaborators')
            .select('*')
            .eq('id', collaboratorId)
            .single();
        if (fetchError || !collaborator) {
            throw new common_1.NotFoundException('Collaborator not found');
        }
        const { data, error } = await this.supabase.getClient()
            .from('collaborators')
            .update(dto)
            .eq('id', collaboratorId)
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to update collaborator: ${error.message}`);
        }
        return this.withoutPassword(data);
    }
    async deactivateCollaborator(actor, collaboratorId) {
        const { data: collaborator, error: fetchError } = await this.supabase.getClient()
            .from('collaborators')
            .select('*')
            .eq('id', collaboratorId)
            .single();
        if (fetchError || !collaborator) {
            throw new common_1.NotFoundException('Collaborator not found');
        }
        const { data, error } = await this.supabase.getClient()
            .from('collaborators')
            .update({ collaborators_verified: false, collaborators_status: 'inactive' })
            .eq('id', collaboratorId)
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to deactivate collaborator: ${error.message}`);
        }
        await this.supabase.getClient().from('user_profiles')
            .update({ user_profiles_status: 'inactive' })
            .eq('collaborator_id', collaboratorId)
            .eq('role', 'collaborator');
        await this.audit.record(actor, 'collaborator.deactivated', 'collaborator', collaboratorId);
        return this.withoutPassword(data);
    }
    async listMembers(userId) {
        const profile = await this.requireActiveCollaboratorProfile(userId);
        const { data: self, error: selfError } = await this.supabase.getClient().from('collaborators')
            .select('merchant_system_id').eq('id', profile.collaborator_id).maybeSingle();
        if (selfError || !self?.merchant_system_id) {
            throw new common_1.BadRequestException('Collaborator is not assigned to a merchant team');
        }
        const { data, error } = await this.supabase.getClient().from('collaborators')
            .select('id,collaborators_name,collaborators_phone,collaborators_email,collaborators_avatar_url,collaborators_registered_date,collaborators_verified,collaborators_status')
            .eq('merchant_system_id', self.merchant_system_id)
            .order('collaborators_registered_date', { ascending: false });
        if (error)
            throw new Error(`Failed to fetch collaborator members: ${error.message}`);
        return data || [];
    }
    async createMember(userId, dto) {
        const profile = await this.requireActiveCollaboratorProfile(userId);
        const { data: self } = await this.supabase.getClient().from('collaborators')
            .select('merchant_system_id').eq('id', profile.collaborator_id).maybeSingle();
        if (!self?.merchant_system_id) {
            throw new common_1.BadRequestException('Collaborator is not assigned to a merchant team');
        }
        await this.userProfilesService.assertIdentityAvailable(dto.collaborators_email);
        const { collaborators_password, ...safeDto } = dto;
        const client = this.supabase.getClient();
        const { data, error } = await client.from('collaborators').insert({
            ...safeDto,
            merchant_system_id: self.merchant_system_id,
            collaborators_code: this.generateCollaboratorCode(),
            collaborators_password: null,
            collaborators_registered_date: new Date().toISOString(),
            collaborators_verified: false,
            collaborators_status: 'pending',
        }).select().single();
        if (error)
            throw new common_1.BadRequestException(`Failed to create member: ${error.message}`);
        try {
            await this.userProfilesService.createOrUpdate({
                email: dto.collaborators_email,
                role: 'collaborator', merchant_id: null, collaborator_id: data.id,
                password: collaborators_password, status: 'pending',
            });
        }
        catch (error) {
            await client.from('collaborators').delete().eq('id', data.id);
            throw error;
        }
        return this.withoutPassword(data);
    }
    async resolveByCode(code) {
        const { data: collaborator, error } = await this.supabase.getClient()
            .from('collaborators')
            .select('*')
            .eq('collaborators_code', code)
            .eq('collaborators_verified', true)
            .single();
        if (error || !collaborator) {
            throw new common_1.ForbiddenException('Invalid or unverified collaborator code');
        }
        return {
            collaboratorId: collaborator.id,
            displayName: collaborator.collaborators_name,
            rating: collaborator.collaborators_rating,
            verified: collaborator.collaborators_verified,
        };
    }
    async listAll() {
        const { data, error } = await this.supabase.getClient()
            .from('collaborators')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) {
            throw new Error(`Failed to fetch collaborators: ${error.message}`);
        }
        return (data || []).map((row) => this.withoutPassword(row));
    }
    async findPending() {
        const { data, error } = await this.supabase.getClient()
            .from('collaborators')
            .select('*')
            .eq('collaborators_verified', false);
        if (error) {
            throw new Error(`Failed to fetch pending collaborators: ${error.message}`);
        }
        return (data || []).map((row) => this.withoutPassword(row));
    }
    async approve(actor, id) {
        const { data: collaborator, error: fetchError } = await this.supabase.getClient()
            .from('collaborators')
            .select('*')
            .eq('id', id)
            .single();
        if (fetchError || !collaborator) {
            throw new common_1.NotFoundException('Collaborator not found');
        }
        const qrCodeBase64 = await this.generateCodeImage(collaborator.collaborators_code);
        const { data, error } = await this.supabase.getClient()
            .from('collaborators')
            .update({
            collaborators_verified: true,
            collaborators_status: 'active',
            collaborators_qr_code: qrCodeBase64,
        })
            .eq('id', id)
            .select()
            .single();
        if (error || !data) {
            throw new common_1.NotFoundException('Failed to update collaborator');
        }
        if (data.collaborators_email) {
            try {
                await this.userProfilesService.createOrUpdate({
                    email: data.collaborators_email,
                    role: 'collaborator',
                    merchant_id: null,
                    collaborator_id: data.id,
                    status: 'active',
                });
            }
            catch (err) {
                console.error('Failed to create user profile:', err);
                await this.supabase.getClient().from('collaborators').update({
                    collaborators_verified: false,
                    collaborators_status: 'pending',
                    collaborators_qr_code: collaborator.collaborators_qr_code || null,
                }).eq('id', id);
                throw new Error('Collaborator approved but account activation failed');
            }
        }
        await this.audit.record(actor, 'collaborator.approved', 'collaborator', id);
        return this.withoutPassword(data);
    }
    async resolveByQrToken(qrToken) {
        return this.resolveByCode(this.collaboratorCodeFromPayload(qrToken));
    }
    async resolveQrForMerchant(userId, payload) {
        const { data: profile, error: profileError } = await this.supabase.getClient()
            .from('user_profiles')
            .select('role,user_profiles_status,merchant_id')
            .eq('user_id', userId)
            .maybeSingle();
        if (profileError || !profile || profile.role !== 'merchant' ||
            profile.user_profiles_status !== 'active' || !profile.merchant_id) {
            throw new common_1.ForbiddenException('Active merchant access required');
        }
        const code = this.collaboratorCodeFromPayload(payload);
        const { data: collaborator, error } = await this.supabase.getClient()
            .from('collaborators')
            .select('id,collaborators_code,collaborators_name,collaborators_verified,collaborators_status,merchant_system_id')
            .eq('collaborators_code', code)
            .eq('collaborators_verified', true)
            .maybeSingle();
        if (error || !collaborator)
            throw new common_1.NotFoundException('Invalid or unverified collaborator code');
        return {
            collaborator_id: collaborator.id,
            collaborator_code: collaborator.collaborators_code,
            collaborator_name: collaborator.collaborators_name,
            verified: collaborator.collaborators_verified,
            status: collaborator.collaborators_status,
            association: collaborator.merchant_system_id === profile.merchant_id
                ? 'assigned_to_this_merchant'
                : collaborator.merchant_system_id ? 'assigned_elsewhere' : 'unassigned',
            idempotent: true,
            financial_action_created: false,
        };
    }
    async reject(actor, id) {
        const { data, error } = await this.supabase.getClient()
            .from('collaborators')
            .update({
            collaborators_verified: false,
            collaborators_status: 'blocked',
        })
            .eq('id', id)
            .select()
            .single();
        if (error || !data) {
            throw new common_1.NotFoundException('Failed to reject collaborator');
        }
        await this.supabase.getClient().from('user_profiles')
            .update({ user_profiles_status: 'blocked' })
            .eq('collaborator_id', id)
            .eq('role', 'collaborator');
        await this.audit.record(actor, 'collaborator.rejected', 'collaborator', id);
        return this.withoutPassword(data);
    }
    async updateByAdmin(actor, id, dto) {
        const before = await this.findOne(id);
        if (dto.merchant_system_id) {
            const { data: merchant } = await this.supabase.getClient().from('merchant_details')
                .select('merchant_system_id').eq('merchant_system_id', dto.merchant_system_id).maybeSingle();
            if (!merchant)
                throw new common_1.BadRequestException('Assigned merchant does not exist');
        }
        const { data, error } = await this.supabase.getClient().from('collaborators')
            .update(dto).eq('id', id).select().single();
        if (error || !data)
            throw new common_1.NotFoundException('Failed to update collaborator');
        await this.audit.record(actor, 'collaborator.updated', 'collaborator', id, {
            changed_fields: Object.keys(dto),
            previous_status: before.collaborators_status,
            status: data.collaborators_status,
        });
        return this.withoutPassword(data);
    }
    async findOne(id) {
        const { data, error } = await this.supabase.getClient()
            .from('collaborators')
            .select('*')
            .eq('id', id)
            .single();
        if (error || !data) {
            throw new common_1.NotFoundException('Collaborator not found');
        }
        return this.withoutPassword(data);
    }
    async generateQRCodeImage(id) {
        const collaborator = await this.findOne(id);
        if (!collaborator.collaborators_verified) {
            throw new common_1.ForbiddenException('Collaborator must be verified to generate QR code');
        }
        try {
            const qrCodeBase64 = await this.generateCodeImage(collaborator.collaborators_code, 400);
            return {
                qr_code_image: qrCodeBase64,
                collaborator_code: collaborator.collaborators_code,
                collaborator_name: collaborator.collaborators_name,
                verified: collaborator.collaborators_verified,
            };
        }
        catch (error) {
            throw new Error('Failed to generate QR code image');
        }
    }
};
exports.CollaboratorsService = CollaboratorsService;
exports.CollaboratorsService = CollaboratorsService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)((0, common_1.forwardRef)(() => user_profiles_service_1.UserProfilesService))),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService,
        user_profiles_service_1.UserProfilesService,
        audit_service_1.AuditService])
], CollaboratorsService);
//# sourceMappingURL=collaborators.service.js.map