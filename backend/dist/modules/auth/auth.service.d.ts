import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
type AppRole = 'merchant' | 'collaborator' | 'admin';
export declare class AuthService {
    private readonly supabase;
    constructor(supabase: SupabaseService);
    private getAuthClient;
    loginAuto(email: string, password: string, requestedRole?: AppRole): Promise<{
        user: {
            id: any;
            email: any;
            role: any;
            name: any;
            merchant_id: any;
            collaborator_id: any;
        };
        entity: Record<string, unknown>;
        merchant: Record<string, unknown>;
        collaborator: Record<string, unknown>;
        access_token: string;
        refresh_token: string;
    }>;
    login(email: string, password: string, role: AppRole): Promise<{
        user: {
            id: any;
            email: any;
            role: any;
            name: any;
            merchant_id: any;
            collaborator_id: any;
        };
        entity: Record<string, unknown>;
        merchant: Record<string, unknown>;
        collaborator: Record<string, unknown>;
        access_token: string;
        refresh_token: string;
    }>;
}
export {};
