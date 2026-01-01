import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
export declare class AuthService {
    private readonly supabase;
    constructor(supabase: SupabaseService);
    private getAuthClient;
    login(email: string, password: string, userType: 'merchant' | 'collaborator'): Promise<{
        user: {
            id: any;
            email: any;
            role: string;
            collaborator_id: any;
            name: any;
        };
        collaborator: {
            id: any;
            code: any;
            name: any;
            verified: any;
        };
        access_token: string;
        refresh_token: string;
    } | {
        user: {
            id: any;
            email: any;
            role: string;
            merchant_id: any;
            name: any;
        };
        merchant: {
            id: any;
            code: any;
            name: any;
            verified: any;
        };
        access_token: string;
        refresh_token: string;
    }>;
    private loginCollaborator;
    private loginMerchant;
}
//# sourceMappingURL=auth.service.d.ts.map