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
exports.UserProfilesService = void 0;
const common_1 = require("@nestjs/common");
const supabase_service_1 = require("../../infrastructure/supabase/supabase.service");
const crypto_1 = require("crypto");
const audit_service_1 = require("../audit/audit.service");
let UserProfilesService = class UserProfilesService {
    constructor(supabase, audit) {
        this.supabase = supabase;
        this.audit = audit;
    }
    async findAll() {
        const { data, error } = await this.supabase.getClient()
            .from('user_profiles')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) {
            throw new Error(`Failed to fetch user profiles: ${error.message}`);
        }
        return data || [];
    }
    async findByEmail(email) {
        const { data, error } = await this.supabase.getClient()
            .from('user_profiles')
            .select('*')
            .eq('email', email)
            .maybeSingle();
        if (error) {
            throw new Error(`Failed to fetch user profile: ${error.message}`);
        }
        return data;
    }
    async findById(id) {
        const { data, error } = await this.supabase.getClient()
            .from('user_profiles')
            .select('*')
            .eq('id', id)
            .single();
        if (error || !data) {
            throw new common_1.NotFoundException('User profile not found');
        }
        return data;
    }
    async assertIdentityAvailable(email) {
        if (await this.findByEmail(email)) {
            throw new common_1.BadRequestException('An account already exists for this email');
        }
        for (let page = 1; page <= 10; page += 1) {
            const { data, error } = await this.supabase.getClient().auth.admin.listUsers({ page, perPage: 1000 });
            if (error)
                throw new common_1.InternalServerErrorException('Unable to verify account availability');
            const users = data.users;
            if (users.some((user) => user.email?.toLowerCase() === email.toLowerCase())) {
                throw new common_1.BadRequestException('An account already exists for this email');
            }
            if (users.length < 1000)
                return;
        }
        throw new common_1.InternalServerErrorException('Unable to verify account availability');
    }
    async updateManagedProfile(actor, id, dto) {
        const existing = await this.findById(id);
        if (existing.user_id === actor.id &&
            (dto.user_profiles_status !== 'active' || dto.role !== existing.role ||
                dto.merchant_id !== existing.merchant_id || dto.collaborator_id !== existing.collaborator_id)) {
            throw new common_1.BadRequestException('An administrator cannot change their own authorization assignment');
        }
        await this.assertBusinessAssignment(dto);
        const client = this.supabase.getClient();
        const { data: oldLinks, error: oldLinksError } = await client
            .from('merchant_user_links')
            .select('merchant_id,user_profile_id,legacy_user_id')
            .eq('user_profile_id', id);
        if (oldLinksError) {
            throw new common_1.InternalServerErrorException('Unable to load current user assignment');
        }
        const oldState = {
            role: existing.role,
            user_profiles_status: existing.user_profiles_status,
            merchant_id: existing.merchant_id,
            collaborator_id: existing.collaborator_id,
        };
        const { data: updated, error: updateError } = await client
            .from('user_profiles')
            .update({
            role: dto.role,
            user_profiles_status: dto.user_profiles_status,
            merchant_id: dto.merchant_id,
            collaborator_id: dto.collaborator_id,
            updated_at: new Date().toISOString(),
        })
            .eq('id', id)
            .select()
            .single();
        if (updateError) {
            throw new common_1.InternalServerErrorException('Unable to update user profile');
        }
        try {
            const { error: deleteError } = await client
                .from('merchant_user_links')
                .delete()
                .eq('user_profile_id', id);
            if (deleteError)
                throw deleteError;
            if (dto.role === 'merchant' && dto.merchant_id) {
                const { error: linkError } = await client.from('merchant_user_links').insert({
                    merchant_id: dto.merchant_id,
                    user_profile_id: id,
                });
                if (linkError)
                    throw linkError;
            }
            const { data: authUser, error: authReadError } = await client.auth.admin.getUserById(existing.user_id);
            if (authReadError || !authUser.user)
                throw authReadError || new Error('Auth user not found');
            const { error: authUpdateError } = await client.auth.admin.updateUserById(existing.user_id, {
                app_metadata: {
                    ...authUser.user.app_metadata,
                    role: dto.role,
                    account_status: dto.user_profiles_status,
                },
            });
            if (authUpdateError)
                throw authUpdateError;
        }
        catch {
            await client.from('user_profiles').update(oldState).eq('id', id);
            await client.from('merchant_user_links').delete().eq('user_profile_id', id);
            if (oldLinks?.length)
                await client.from('merchant_user_links').insert(oldLinks);
            throw new common_1.InternalServerErrorException('Unable to synchronize user authorization state');
        }
        await this.audit.record(actor, 'user_profile.authorization_updated', 'user_profile', id, {
            before: oldState,
            after: dto,
        });
        return updated;
    }
    async assertBusinessAssignment(dto) {
        const client = this.supabase.getClient();
        if (dto.role === 'merchant' && dto.merchant_id) {
            const { data, error } = await client
                .from('merchant_details')
                .select('merchant_system_id')
                .eq('merchant_system_id', dto.merchant_id)
                .maybeSingle();
            if (error || !data)
                throw new common_1.BadRequestException('Assigned merchant does not exist');
        }
        if (dto.role === 'collaborator' && dto.collaborator_id) {
            const { data, error } = await client
                .from('collaborators')
                .select('id')
                .eq('id', dto.collaborator_id)
                .maybeSingle();
            if (error || !data)
                throw new common_1.BadRequestException('Assigned collaborator does not exist');
        }
    }
    async createOrUpdate(dto) {
        const merchantId = dto.merchant_id || null;
        const collaboratorId = dto.collaborator_id || null;
        const validAssignment = (dto.role === 'admin' && !merchantId && !collaboratorId) ||
            (dto.role === 'merchant' && !!merchantId && !collaboratorId) ||
            (dto.role === 'collaborator' && !merchantId && !!collaboratorId);
        if (!validAssignment)
            throw new common_1.BadRequestException('Role and business-entity assignment are inconsistent');
        await this.assertBusinessAssignment({ role: dto.role, merchant_id: merchantId, collaborator_id: collaboratorId });
        const existing = await this.findByEmail(dto.email);
        if (existing) {
            const { data, error } = await this.supabase.getClient()
                .from('user_profiles')
                .update({
                role: dto.role,
                merchant_id: merchantId,
                collaborator_id: collaboratorId,
                user_profiles_status: dto.status || existing.user_profiles_status || 'active',
            })
                .eq('email', dto.email)
                .select()
                .single();
            if (error) {
                throw new Error(`Failed to update user profile: ${error.message}`);
            }
            await this.syncMerchantLink(data.id, dto.role, merchantId);
            await this.syncAuthMetadata(existing.user_id, dto.role, dto.status || existing.user_profiles_status || 'active');
            return data;
        }
        else {
            let userId = dto.user_id;
            if (!userId) {
                const { data: authUsers } = await this.supabase.getClient().auth.admin.listUsers();
                const existingAuthUser = authUsers?.users?.find((u) => u.email === dto.email);
                if (existingAuthUser) {
                    userId = existingAuthUser.id;
                }
                else {
                    const password = dto.password || `${(0, crypto_1.randomBytes)(24).toString('base64url')}Aa1!`;
                    const { data: newAuthUser, error: authError } = await this.supabase.getClient().auth.admin.createUser({
                        email: dto.email,
                        password: password,
                        email_confirm: true,
                        app_metadata: {
                            role: dto.role,
                            account_status: dto.status || 'active',
                            password_reset_required: !dto.password,
                        },
                    });
                    if (authError || !newAuthUser.user) {
                        throw new Error(`Failed to create auth user: ${authError?.message || 'Unknown error'}`);
                    }
                    userId = newAuthUser.user.id;
                }
            }
            const { data, error } = await this.supabase.getClient()
                .from('user_profiles')
                .insert({
                user_id: userId,
                email: dto.email,
                role: dto.role,
                merchant_id: merchantId,
                collaborator_id: collaboratorId,
                login_count: 0,
                user_profiles_status: dto.status || 'active',
            })
                .select()
                .single();
            if (error) {
                throw new Error(`Failed to create user profile: ${error.message}`);
            }
            await this.syncMerchantLink(data.id, dto.role, merchantId);
            await this.syncAuthMetadata(userId, dto.role, dto.status || 'active');
            return data;
        }
    }
    async recordCreation(actor, profile) {
        await this.audit.record(actor, 'user_profile.created', 'user_profile', profile.id, {
            role: profile.role,
            status: profile.user_profiles_status,
            merchant_id: profile.merchant_id,
            collaborator_id: profile.collaborator_id,
        });
    }
    async syncMerchantLink(profileId, role, merchantId) {
        const client = this.supabase.getClient();
        const { error: deleteError } = await client.from('merchant_user_links')
            .delete().eq('user_profile_id', profileId);
        if (deleteError)
            throw new common_1.InternalServerErrorException('Unable to synchronize merchant assignment');
        if (role === 'merchant' && merchantId) {
            const { error } = await client.from('merchant_user_links').insert({
                merchant_id: merchantId,
                user_profile_id: profileId,
            });
            if (error)
                throw new common_1.InternalServerErrorException('Unable to synchronize merchant assignment');
        }
    }
    async syncAuthMetadata(userId, role, status) {
        const client = this.supabase.getClient();
        const { data, error } = await client.auth.admin.getUserById(userId);
        if (error || !data.user)
            throw new common_1.InternalServerErrorException('Unable to load Auth account');
        const { error: updateError } = await client.auth.admin.updateUserById(userId, {
            app_metadata: { ...data.user.app_metadata, role, account_status: status },
        });
        if (updateError)
            throw new common_1.InternalServerErrorException('Unable to synchronize Auth account');
    }
    async trackLogin(email) {
        const profile = await this.findByEmail(email);
        if (!profile) {
            return null;
        }
        const { data, error } = await this.supabase.getClient()
            .from('user_profiles')
            .update({
            last_login_at: new Date().toISOString(),
            login_count: (profile.login_count || 0) + 1,
        })
            .eq('email', email)
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to track login: ${error.message}`);
        }
        return data;
    }
    async backfillFromApprovedMerchantsAndCollaborators() {
        const results = {
            merchants: { created: 0, skipped: 0, errors: [] },
            collaborators: { created: 0, skipped: 0, errors: [] },
        };
        const { data: merchants, error: merchantError } = await this.supabase.getClient()
            .from('merchant_details')
            .select('merchant_system_id, owner_email, merchant_verified')
            .eq('merchant_verified', true);
        if (merchantError) {
            results.merchants.errors.push(`Failed to fetch merchants: ${merchantError.message}`);
        }
        else if (merchants) {
            for (const merchant of merchants) {
                if (!merchant.owner_email) {
                    results.merchants.skipped++;
                    continue;
                }
                try {
                    const existing = await this.findByEmail(merchant.owner_email);
                    if (existing) {
                        results.merchants.skipped++;
                        console.log(`Merchant user profile already exists: ${merchant.owner_email}`);
                    }
                    else {
                        const { data: authUser } = await this.supabase.getClient().auth.admin.listUsers();
                        const existingAuthUser = authUser?.users?.find((u) => u.email === merchant.owner_email);
                        let userId;
                        if (existingAuthUser) {
                            userId = existingAuthUser.id;
                            console.log(`Auth user already exists for ${merchant.owner_email}`);
                        }
                        else {
                            const password = `${(0, crypto_1.randomBytes)(24).toString('base64url')}Aa1!`;
                            const { data: newAuthUser, error: authError } = await this.supabase.getClient().auth.admin.createUser({
                                email: merchant.owner_email,
                                password: password,
                                email_confirm: true,
                                app_metadata: { role: 'merchant', password_reset_required: true },
                            });
                            if (authError || !newAuthUser.user) {
                                throw new Error(`Failed to create auth user: ${authError?.message || 'Unknown error'}`);
                            }
                            userId = newAuthUser.user.id;
                            console.log(`Created auth user for ${merchant.owner_email}`);
                        }
                        const { error: profileError } = await this.supabase.getClient()
                            .from('user_profiles')
                            .insert({
                            user_id: userId,
                            email: merchant.owner_email,
                            role: 'merchant',
                            merchant_id: merchant.merchant_system_id,
                            collaborator_id: null,
                            login_count: 0,
                        });
                        if (profileError) {
                            throw new Error(`Failed to create user profile: ${profileError.message}`);
                        }
                        results.merchants.created++;
                        console.log(`Created user profile for merchant: ${merchant.owner_email}`);
                    }
                }
                catch (err) {
                    results.merchants.errors.push(`${merchant.owner_email}: ${err.message}`);
                }
            }
        }
        const { data: collaborators, error: collaboratorError } = await this.supabase.getClient()
            .from('collaborators')
            .select('id, collaborators_email, collaborators_verified')
            .eq('collaborators_verified', true);
        if (collaboratorError) {
            results.collaborators.errors.push(`Failed to fetch collaborators: ${collaboratorError.message}`);
        }
        else if (collaborators) {
            for (const collaborator of collaborators) {
                if (!collaborator.collaborators_email) {
                    results.collaborators.skipped++;
                    continue;
                }
                try {
                    const existing = await this.findByEmail(collaborator.collaborators_email);
                    if (existing) {
                        results.collaborators.skipped++;
                        console.log(`Collaborator user profile already exists: ${collaborator.collaborators_email}`);
                    }
                    else {
                        const { data: authUser } = await this.supabase.getClient().auth.admin.listUsers();
                        const existingAuthUser = authUser?.users?.find((u) => u.email === collaborator.collaborators_email);
                        let userId;
                        if (existingAuthUser) {
                            userId = existingAuthUser.id;
                            console.log(`Auth user already exists for ${collaborator.collaborators_email}`);
                        }
                        else {
                            const password = `${(0, crypto_1.randomBytes)(24).toString('base64url')}Aa1!`;
                            const { data: newAuthUser, error: authError } = await this.supabase.getClient().auth.admin.createUser({
                                email: collaborator.collaborators_email,
                                password: password,
                                email_confirm: true,
                                app_metadata: { role: 'collaborator', password_reset_required: true },
                            });
                            if (authError || !newAuthUser.user) {
                                throw new Error(`Failed to create auth user: ${authError?.message || 'Unknown error'}`);
                            }
                            userId = newAuthUser.user.id;
                            console.log(`Created auth user for ${collaborator.collaborators_email}`);
                        }
                        const { error: profileError } = await this.supabase.getClient()
                            .from('user_profiles')
                            .insert({
                            user_id: userId,
                            email: collaborator.collaborators_email,
                            role: 'collaborator',
                            merchant_id: null,
                            collaborator_id: collaborator.id,
                            login_count: 0,
                        });
                        if (profileError) {
                            throw new Error(`Failed to create user profile: ${profileError.message}`);
                        }
                        results.collaborators.created++;
                        console.log(`Created user profile for collaborator: ${collaborator.collaborators_email}`);
                    }
                }
                catch (err) {
                    results.collaborators.errors.push(`${collaborator.collaborators_email}: ${err.message}`);
                }
            }
        }
        return results;
    }
};
exports.UserProfilesService = UserProfilesService;
exports.UserProfilesService = UserProfilesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService,
        audit_service_1.AuditService])
], UserProfilesService);
//# sourceMappingURL=user-profiles.service.js.map