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
exports.OrganizationProfileService = void 0;
const common_1 = require("@nestjs/common");
const supabase_service_1 = require("../../infrastructure/supabase/supabase.service");
let OrganizationProfileService = class OrganizationProfileService {
    constructor(supabase) {
        this.supabase = supabase;
    }
    async get() {
        const { data, error } = await this.supabase.getClient()
            .from('organization_profile')
            .select('*')
            .limit(1)
            .maybeSingle();
        if (error) {
            throw new Error(`Failed to fetch organization profile: ${error.message}`);
        }
        return data;
    }
    async create(dto) {
        const existing = await this.get();
        if (existing) {
            throw new Error('Organization profile already exists. Use update instead.');
        }
        const { data, error } = await this.supabase.getClient()
            .from('organization_profile')
            .insert(dto)
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to create organization profile: ${error.message}`);
        }
        return data;
    }
    async update(dto) {
        const existing = await this.get();
        if (!existing) {
            throw new Error('Organization profile does not exist. Create one first.');
        }
        const { data, error } = await this.supabase.getClient()
            .from('organization_profile')
            .update(dto)
            .eq('id', existing.id)
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to update organization profile: ${error.message}`);
        }
        return data;
    }
    async createOrUpdate(dto) {
        const existing = await this.get();
        if (existing) {
            return this.update(dto);
        }
        else {
            return this.create(dto);
        }
    }
    async delete() {
        const existing = await this.get();
        if (!existing) {
            throw new Error('Organization profile does not exist.');
        }
        const { error } = await this.supabase.getClient()
            .from('organization_profile')
            .delete()
            .eq('id', existing.id);
        if (error) {
            throw new Error(`Failed to delete organization profile: ${error.message}`);
        }
        return { success: true };
    }
};
exports.OrganizationProfileService = OrganizationProfileService;
exports.OrganizationProfileService = OrganizationProfileService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], OrganizationProfileService);
//# sourceMappingURL=organization-profile.service.js.map