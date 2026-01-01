import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { CreateUserProfileDto } from './user-profiles.dto';
export declare class UserProfilesService {
    private readonly supabase;
    constructor(supabase: SupabaseService);
    findAll(): Promise<any[]>;
    findByEmail(email: string): Promise<any>;
    findById(id: string): Promise<any>;
    createOrUpdate(dto: CreateUserProfileDto & {
        user_id?: string;
        password?: string;
    }): Promise<any>;
    trackLogin(email: string): Promise<any>;
    backfillFromApprovedMerchantsAndCollaborators(): Promise<{
        merchants: {
            created: number;
            skipped: number;
            errors: string[];
        };
        collaborators: {
            created: number;
            skipped: number;
            errors: string[];
        };
    }>;
}
//# sourceMappingURL=user-profiles.service.d.ts.map