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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MerchantsService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const supabase_service_1 = require("../../infrastructure/supabase/supabase.service");
const user_profiles_service_1 = require("../user-profiles/user-profiles.service");
let MerchantsService = class MerchantsService {
    constructor(supabase, userProfilesService) {
        this.supabase = supabase;
        this.userProfilesService = userProfilesService;
    }
    generateMerchantCode() {
        return 'MCH' + (0, crypto_1.randomBytes)(4).toString('hex').toUpperCase().slice(0, 5);
    }
    withoutPassword(row) {
        if (!row)
            return row;
        const { owner_password: _password, ...safe } = row;
        return safe;
    }
    async findAll() {
        const { data, error } = await this.supabase.getClient()
            .from('merchant_details')
            .select('*')
            .order('merchant_registered_date', { ascending: false });
        if (error) {
            throw new Error(`Failed to fetch merchants: ${error.message}`);
        }
        return (data || []).map((row) => this.withoutPassword(row));
    }
    async findById(id) {
        const { data, error } = await this.supabase.getClient()
            .from('merchant_details')
            .select('*')
            .eq('merchant_system_id', id)
            .single();
        if (error) {
            throw new Error(`Failed to fetch merchant: ${error.message}`);
        }
        return this.withoutPassword(data);
    }
    async findByIdForActor(userId, id) {
        const { data: profile } = await this.supabase.getClient().from('user_profiles')
            .select('role,user_profiles_status,merchant_id').eq('user_id', userId).maybeSingle();
        if (!profile || profile.user_profiles_status !== 'active' ||
            (profile.role !== 'admin' && !(profile.role === 'merchant' && profile.merchant_id === id))) {
            throw new common_1.ForbiddenException('Merchant access denied');
        }
        return this.findById(id);
    }
    async findByEmail(email) {
        const { data, error } = await this.supabase.getClient()
            .from('merchant_details')
            .select('*')
            .eq('owner_email', email)
            .maybeSingle();
        if (error) {
            throw new Error(`Failed to fetch merchant: ${error.message}`);
        }
        return data;
    }
    async findVerified() {
        const { data, error } = await this.supabase.getClient()
            .from('merchant_details')
            .select('*')
            .eq('merchant_verified', true)
            .order('merchant_registered_date', { ascending: false });
        if (error) {
            throw new Error(`Failed to fetch verified merchants: ${error.message}`);
        }
        return (data || []).map((row) => this.withoutPassword(row));
    }
    async create(dto) {
        const merchantCode = this.generateMerchantCode();
        const { data, error } = await this.supabase.getClient()
            .from('merchant_details')
            .insert({
            merchant_code: merchantCode,
            owner_email: dto.owner_email,
            owner_password: null,
            merchant_name: dto.merchant_name,
            merchant_description: dto.merchant_description,
            merchant_phone: dto.merchant_phone,
            merchant_email: dto.merchant_email,
            merchant_contact_phone: dto.merchant_contact_phone,
            new_address_city: dto.new_address_city,
            new_address_ward: dto.new_address_ward,
            new_address_line: dto.new_address_line,
            merchant_commission_type: dto.merchant_commission_type,
            merchant_commission_value: dto.merchant_commission_value,
            merchant_discount_type: dto.merchant_discount_type,
            merchant_discount_value: dto.merchant_discount_value,
            merchant_verified: false,
            merchants_status: 'pending',
        })
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to create merchant: ${error.message}`);
        }
        await this.userProfilesService.createOrUpdate({
            email: dto.owner_email,
            role: 'merchant',
            merchant_id: data.merchant_system_id,
            collaborator_id: null,
            password: dto.owner_password,
            status: 'pending',
        });
        return this.withoutPassword(data);
    }
    async update(id, dto) {
        const { data, error } = await this.supabase.getClient()
            .from('merchant_details')
            .update(dto)
            .eq('merchant_system_id', id)
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to update merchant: ${error.message}`);
        }
        return this.withoutPassword(data);
    }
    async updateForActor(userId, id, dto) {
        const { data: profile } = await this.supabase.getClient().from('user_profiles')
            .select('role,user_profiles_status,merchant_id').eq('user_id', userId).maybeSingle();
        if (!profile || profile.user_profiles_status !== 'active' ||
            (profile.role !== 'admin' && !(profile.role === 'merchant' && profile.merchant_id === id))) {
            throw new common_1.ForbiddenException('Merchant update access denied');
        }
        return this.update(id, dto);
    }
    async delete(id) {
        const { error } = await this.supabase.getClient()
            .from('merchant_details')
            .delete()
            .eq('merchant_system_id', id);
        if (error) {
            throw new Error(`Failed to delete merchant: ${error.message}`);
        }
        return { success: true };
    }
    async approve(id) {
        const merchant = await this.findById(id);
        if (!merchant) {
            console.error(`[MerchantsService] Merchant not found: ${id}`);
            throw new Error('Merchant not found');
        }
        if (!merchant.owner_email) {
            console.error(`[MerchantsService] Missing owner_email for merchant ${id}`);
            throw new Error('Cannot approve merchant: owner_email is required');
        }
        const { data, error } = await this.supabase.getClient()
            .from('merchant_details')
            .update({
            merchant_verified: true,
            merchants_status: 'active',
        })
            .eq('merchant_system_id', id)
            .select()
            .single();
        if (error) {
            console.error(`[MerchantsService] Failed to update merchant:`, error);
            throw new Error(`Failed to approve merchant: ${error.message}`);
        }
        try {
            await this.userProfilesService.createOrUpdate({
                email: merchant.owner_email,
                role: 'merchant',
                merchant_id: merchant.merchant_system_id,
                collaborator_id: null,
                status: 'active',
            });
            return this.withoutPassword(data);
        }
        catch (profileError) {
            console.error('[MerchantsService] Failed to create user profile:', profileError);
            throw new Error(`Merchant approved but failed to create user profile: ${profileError.message}`);
        }
    }
    async reject(id) {
        const { data, error } = await this.supabase.getClient()
            .from('merchant_details')
            .update({
            merchant_verified: false,
            merchants_status: 'blocked',
        })
            .eq('merchant_system_id', id)
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to reject merchant: ${error.message}`);
        }
        return this.withoutPassword(data);
    }
};
exports.MerchantsService = MerchantsService;
exports.MerchantsService = MerchantsService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)((0, common_1.forwardRef)(() => user_profiles_service_1.UserProfilesService))),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService,
        user_profiles_service_1.UserProfilesService])
], MerchantsService);
//# sourceMappingURL=merchants.service.js.map