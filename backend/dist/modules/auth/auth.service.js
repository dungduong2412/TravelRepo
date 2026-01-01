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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const supabase_service_1 = require("../../infrastructure/supabase/supabase.service");
const supabase_js_1 = require("@supabase/supabase-js");
const bcrypt = __importStar(require("bcryptjs"));
let AuthService = class AuthService {
    constructor(supabase) {
        this.supabase = supabase;
    }
    // Create a fresh Supabase client for authentication to avoid any cached/scoped issues
    getAuthClient() {
        return (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });
    }
    async login(email, password, userType) {
        if (userType === 'collaborator') {
            return this.loginCollaborator(email, password);
        }
        else if (userType === 'merchant') {
            return this.loginMerchant(email, password);
        }
        throw new common_1.UnauthorizedException('Invalid user type');
    }
    async loginCollaborator(email, password) {
        // Use fresh client to avoid any scope/cache issues
        const authClient = this.getAuthClient();
        // STEP 1: Find user_profile by email
        const { data: profile, error: profileError } = await authClient
            .from('user_profiles')
            .select('*')
            .eq('email', email)
            .eq('role', 'collaborator')
            .single();
        if (profileError || !profile) {
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        // STEP 2: Check if collaborator_id exists
        if (!profile.collaborator_id) {
            throw new common_1.UnauthorizedException('Collaborator profile not found. Please contact admin.');
        }
        // STEP 3: Get collaborator details
        const { data: collaborator, error: collabError } = await authClient
            .from('collaborators')
            .select('*')
            .eq('id', profile.collaborator_id)
            .maybeSingle();
        if (collabError || !collaborator) {
            throw new common_1.UnauthorizedException('Collaborator details not found. Please contact admin.');
        }
        // STEP 4: Check if verified
        if (!collaborator.collaborators_verified) {
            throw new common_1.UnauthorizedException('Account not verified yet. Please wait for admin approval.');
        }
        // STEP 5: Verify password
        if (!collaborator.collaborators_password) {
            throw new common_1.UnauthorizedException('Password not set for this account');
        }
        const isValidPassword = await bcrypt.compare(password, collaborator.collaborators_password);
        if (!isValidPassword) {
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        // STEP 6: Try to sign in with Supabase using the auth user
        let session = await authClient.auth.signInWithPassword({
            email: email,
            password: password,
        });
        if (session.error) {
            // If Supabase auth fails, try to sync the password
            try {
                // Update Supabase auth user password to match the one user registered with
                await authClient.auth.admin.updateUserById(profile.user_id, {
                    password: password,
                });
                // Retry sign in
                session = await authClient.auth.signInWithPassword({
                    email: email,
                    password: password,
                });
                if (session.error) {
                    throw new Error(session.error.message);
                }
            }
            catch (syncError) {
                throw new common_1.UnauthorizedException('Login failed. Please contact support.');
            }
        }
        return {
            user: {
                id: profile.user_id,
                email: profile.email,
                role: 'collaborator',
                collaborator_id: collaborator.id,
                name: collaborator.collaborators_name,
            },
            collaborator: {
                id: collaborator.id,
                code: collaborator.collaborators_code,
                name: collaborator.collaborators_name,
                verified: collaborator.collaborators_verified,
            },
            access_token: session.data.session?.access_token,
            refresh_token: session.data.session?.refresh_token,
        };
    }
    async loginMerchant(email, password) {
        // STEP 1: Find user_profile by email
        const { data: profile, error: profileError } = await this.supabase.getClient()
            .from('user_profiles')
            .select('*')
            .eq('email', email)
            .eq('role', 'merchant')
            .single();
        if (profileError || !profile) {
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        // STEP 2: Check if merchant_id exists
        if (!profile.merchant_id) {
            throw new common_1.UnauthorizedException('Merchant profile not found. Please contact admin.');
        }
        // STEP 3: Get merchant details
        const { data: merchant, error: merchantError } = await this.supabase.getClient()
            .from('merchant_details')
            .select('*')
            .eq('id', profile.merchant_id)
            .maybeSingle();
        if (merchantError || !merchant) {
            throw new common_1.UnauthorizedException('Merchant details not found. Please contact admin.');
        }
        // STEP 4: Check if verified
        if (!merchant.merchant_verified) {
            throw new common_1.UnauthorizedException('Account not verified yet. Please wait for admin approval.');
        }
        // STEP 5: Verify password
        if (!merchant.owner_password) {
            throw new common_1.UnauthorizedException('Password not set for this account');
        }
        const isValidPassword = await bcrypt.compare(password, merchant.owner_password);
        if (!isValidPassword) {
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        // STEP 6: Try to sign in with Supabase using the auth user
        let session = await this.supabase.getClient().auth.signInWithPassword({
            email: email,
            password: password,
        });
        if (session.error) {
            // If Supabase auth fails, try to sync the password
            console.log('Supabase auth failed, attempting to sync password:', session.error.message);
            try {
                // Update Supabase auth user password to match the one user registered with
                await this.supabase.getClient().auth.admin.updateUserById(profile.user_id, {
                    password: password,
                });
                console.log('Password synced successfully, retrying login');
                // Retry sign in
                session = await this.supabase.getClient().auth.signInWithPassword({
                    email: email,
                    password: password,
                });
                if (session.error) {
                    throw new Error(session.error.message);
                }
            }
            catch (syncError) {
                console.error('Failed to sync password:', syncError);
                throw new common_1.UnauthorizedException('Login failed. Please contact support.');
            }
        }
        return {
            user: {
                id: profile.user_id,
                email: profile.email,
                role: 'merchant',
                merchant_id: merchant.id,
                name: merchant.merchant_name,
            },
            merchant: {
                id: merchant.id,
                code: merchant.merchant_code,
                name: merchant.merchant_name,
                verified: merchant.merchant_verified,
            },
            access_token: session.data.session?.access_token,
            refresh_token: session.data.session?.refresh_token,
        };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], AuthService);
//# sourceMappingURL=auth.service.js.map