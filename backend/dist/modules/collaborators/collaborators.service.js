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
let CollaboratorsService = class CollaboratorsService {
    constructor(supabase, userProfilesService) {
        this.supabase = supabase;
        this.userProfilesService = userProfilesService;
    }
    async createCollaborator(actor, dto) {
        const { collaborators_password, ...restDto } = dto;
        const insertData = {
            ...restDto,
            collaborators_password: null,
            collaborators_code: dto.collaborators_code || this.generateCollaboratorCode(),
            collaborators_verified: dto.collaborators_verified ?? false,
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
            await this.userProfilesService.createOrUpdate({
                email: data.collaborators_email,
                role: 'collaborator',
                merchant_id: null,
                collaborator_id: data.id,
                password: collaborators_password,
                status: 'pending',
            });
        }
        return this.withoutPassword(data);
    }
    withoutPassword(row) {
        if (!row)
            return row;
        const { collaborators_password: _password, ...safe } = row;
        return safe;
    }
    async assertOwnerOrAdmin(actor, collaboratorId) {
        if (!actor?.id)
            throw new common_1.ForbiddenException('Collaborator access denied');
        const { data: profile } = await this.supabase.getClient().from('user_profiles')
            .select('role,user_profiles_status,collaborator_id').eq('user_id', actor.id).maybeSingle();
        if (!profile || profile.user_profiles_status !== 'active' ||
            (profile.role !== 'admin' && !(profile.role === 'collaborator' && profile.collaborator_id === collaboratorId))) {
            throw new common_1.ForbiddenException('Collaborator access denied');
        }
    }
    async getMyCollaborator(actor) {
        if (!actor?.id && !actor?.email) {
            throw new common_1.NotFoundException('User identity not found in token');
        }
        if (actor?.email) {
            const { data: byEmailDirect, error: byEmailDirectError } = await this.supabase.getClient()
                .from('collaborators')
                .select('*')
                .eq('collaborators_email', actor.email)
                .maybeSingle();
            if (byEmailDirectError) {
                throw new Error(`Failed to fetch collaborator by email: ${byEmailDirectError.message}`);
            }
            if (byEmailDirect) {
                return this.withoutPassword(byEmailDirect);
            }
        }
        let profile = null;
        if (actor?.id) {
            const { data: byUserId, error: byUserIdError } = await this.supabase.getClient()
                .from('user_profiles')
                .select('collaborator_id, role')
                .eq('user_id', actor.id)
                .eq('role', 'collaborator')
                .maybeSingle();
            if (byUserIdError) {
                throw new Error(`Failed to fetch collaborator profile by user_id: ${byUserIdError.message}`);
            }
            profile = byUserId;
        }
        if (!profile && actor?.email) {
            const { data: byEmail, error: byEmailError } = await this.supabase.getClient()
                .from('user_profiles')
                .select('collaborator_id, role')
                .eq('email', actor.email)
                .eq('role', 'collaborator')
                .maybeSingle();
            if (byEmailError) {
                throw new Error(`Failed to fetch collaborator profile by email: ${byEmailError.message}`);
            }
            profile = byEmail;
        }
        if (!profile?.collaborator_id) {
            throw new common_1.NotFoundException('Collaborator profile not found');
        }
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
        if (!collaborator.collaborators_qr_code) {
            throw new common_1.NotFoundException('QR code not generated yet. Please contact admin.');
        }
        return {
            qr_code: collaborator.collaborators_qr_code,
            qr_code_image: collaborator.collaborators_qr_code,
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
    async updateCollaborator(actor, collaboratorId, dto) {
        await this.assertOwnerOrAdmin(actor, collaboratorId);
        const { data: collaborator, error: fetchError } = await this.supabase.getClient()
            .from('collaborators')
            .select('*')
            .eq('id', collaboratorId)
            .single();
        if (fetchError || !collaborator) {
            throw new common_1.NotFoundException('Collaborator not found');
        }
        const { collaborators_password: _password, ...safeDto } = dto;
        const { data, error } = await this.supabase.getClient()
            .from('collaborators')
            .update(safeDto)
            .eq('id', collaboratorId)
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to update collaborator: ${error.message}`);
        }
        return this.withoutPassword(data);
    }
    async deleteCollaborator(actor, collaboratorId) {
        await this.assertOwnerOrAdmin(actor, collaboratorId);
        const { data: collaborator, error: fetchError } = await this.supabase.getClient()
            .from('collaborators')
            .select('*')
            .eq('id', collaboratorId)
            .single();
        if (fetchError || !collaborator) {
            throw new common_1.NotFoundException('Collaborator not found');
        }
        const { error } = await this.supabase.getClient()
            .from('collaborators')
            .delete()
            .eq('id', collaboratorId);
        if (error) {
            throw new Error(`Failed to delete collaborator: ${error.message}`);
        }
        return { success: true };
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
    async approve(id) {
        const { data: collaborator, error: fetchError } = await this.supabase.getClient()
            .from('collaborators')
            .select('*')
            .eq('id', id)
            .single();
        if (fetchError || !collaborator) {
            throw new common_1.NotFoundException('Collaborator not found');
        }
        const qrData = {
            code: collaborator.collaborators_code,
            name: collaborator.collaborators_name,
            phone: collaborator.collaborators_phone,
            email: collaborator.collaborators_email,
            type: 'collaborator',
        };
        let qrCodeBase64;
        try {
            qrCodeBase64 = await QRCode.toDataURL(JSON.stringify(qrData), {
                errorCorrectionLevel: 'H',
                type: 'image/png',
                width: 300,
                margin: 1,
            });
        }
        catch (qrError) {
            console.error('Failed to generate QR code:', qrError);
            throw new Error('Failed to generate QR code');
        }
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
            }
        }
        return this.withoutPassword(data);
    }
    async resolveByQrToken(qrToken) {
        const { data: collaborator, error } = await this.supabase.getClient()
            .from('collaborators')
            .select('*')
            .eq('collaborators_qr_code', qrToken)
            .eq('collaborators_verified', true)
            .single();
        if (error || !collaborator) {
            throw new common_1.NotFoundException('Invalid or unverified QR token');
        }
        return {
            collaboratorId: collaborator.id,
            displayName: collaborator.collaborators_name,
            code: collaborator.collaborators_code,
            verified: collaborator.collaborators_verified,
        };
    }
    async reject(id) {
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
        return data;
    }
    async create(dto) {
        const qrCode = (0, crypto_1.randomBytes)(16).toString('hex');
        const { collaborators_password, ...restDto } = dto;
        const { data, error } = await this.supabase.getClient()
            .from('collaborators')
            .insert({
            ...restDto,
            collaborators_password: null,
            qr_code: qrCode,
            collaborators_code: this.generateCollaboratorCode(),
            collaborators_verified: false,
            collaborators_status: 'pending',
        })
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to create collaborator: ${error.message}`);
        }
        if (data.collaborators_email && collaborators_password) {
            await this.userProfilesService.createOrUpdate({
                email: data.collaborators_email, role: 'collaborator', merchant_id: null,
                collaborator_id: data.id, password: collaborators_password, status: 'pending',
            });
        }
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
    async update(id, dto) {
        const { collaborators_password: _password, ...safeDto } = dto;
        const { data, error } = await this.supabase.getClient()
            .from('collaborators')
            .update(safeDto)
            .eq('id', id)
            .select()
            .single();
        if (error || !data) {
            throw new common_1.NotFoundException('Failed to update collaborator');
        }
        return this.withoutPassword(data);
    }
    async generateQRCodeImage(id) {
        const collaborator = await this.findOne(id);
        if (!collaborator.collaborators_verified) {
            throw new common_1.ForbiddenException('Collaborator must be verified to generate QR code');
        }
        const qrData = collaborator.collaborators_code;
        try {
            const qrCodeBase64 = await QRCode.toDataURL(qrData, {
                errorCorrectionLevel: 'H',
                type: 'image/png',
                width: 400,
                margin: 1,
            });
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
        user_profiles_service_1.UserProfilesService])
], CollaboratorsService);
//# sourceMappingURL=collaborators.service.js.map