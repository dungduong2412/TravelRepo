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
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const supabase_js_1 = require("@supabase/supabase-js");
const supabase_service_1 = require("../../infrastructure/supabase/supabase.service");
let AuthService = class AuthService {
    constructor(supabase) {
        this.supabase = supabase;
    }
    getAuthClient() {
        const url = process.env.SUPABASE_URL;
        const anonKey = process.env.SUPABASE_ANON_KEY;
        if (!url || !anonKey)
            throw new Error('Supabase public Auth configuration is missing');
        return (0, supabase_js_1.createClient)(url, anonKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });
    }
    async loginAuto(email, password, requestedRole) {
        const { data: session, error: authError } = await this.getAuthClient().auth
            .signInWithPassword({ email, password });
        if (authError || !session.user || !session.session) {
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        const { data: profile, error: profileError } = await this.supabase.getClient()
            .from('user_profiles')
            .select('id,user_id,email,role,full_name,user_profiles_status,merchant_id,collaborator_id,login_count')
            .eq('user_id', session.user.id)
            .maybeSingle();
        if (profileError || !profile || profile.user_profiles_status !== 'active') {
            throw new common_1.UnauthorizedException('Account is not active');
        }
        if (requestedRole && profile.role !== requestedRole) {
            throw new common_1.UnauthorizedException('Account role does not match');
        }
        let entity = null;
        if (profile.role === 'merchant') {
            const { data } = await this.supabase.getClient().from('merchant_details')
                .select('merchant_system_id,merchant_code,merchant_name,merchant_verified,merchants_status')
                .eq('merchant_system_id', profile.merchant_id).maybeSingle();
            if (!data?.merchant_verified || data.merchants_status === 'blocked') {
                throw new common_1.UnauthorizedException('Merchant account is not approved');
            }
            entity = data;
        }
        else if (profile.role === 'collaborator') {
            const { data } = await this.supabase.getClient().from('collaborators')
                .select('id,collaborators_code,collaborators_name,collaborators_verified,collaborators_status')
                .eq('id', profile.collaborator_id).maybeSingle();
            if (!data?.collaborators_verified || data.collaborators_status === 'blocked') {
                throw new common_1.UnauthorizedException('Collaborator account is not approved');
            }
            entity = data;
        }
        else if (profile.role !== 'admin') {
            throw new common_1.UnauthorizedException('Unsupported account role');
        }
        await this.supabase.getClient().from('user_profiles').update({
            login_count: (profile.login_count || 0) + 1,
            last_login_at: new Date().toISOString(),
        }).eq('id', profile.id);
        return {
            user: {
                id: profile.user_id,
                email: profile.email,
                role: profile.role,
                name: profile.full_name,
                merchant_id: profile.merchant_id,
                collaborator_id: profile.collaborator_id,
            },
            entity,
            merchant: profile.role === 'merchant' ? entity : null,
            collaborator: profile.role === 'collaborator' ? entity : null,
            access_token: session.session.access_token,
            refresh_token: session.session.refresh_token,
        };
    }
    login(email, password, role) {
        return this.loginAuto(email, password, role);
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], AuthService);
//# sourceMappingURL=auth.service.js.map