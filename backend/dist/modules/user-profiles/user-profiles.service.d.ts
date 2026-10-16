import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { CreateUserProfileDto, UpdateManagedUserProfileDto } from './user-profiles.dto';
import { AuditActor, AuditService } from '../audit/audit.service';
export declare class UserProfilesService {
    private readonly supabase;
    private readonly audit;
    constructor(supabase: SupabaseService, audit: AuditService);
    findAll(): Promise<any[]>;
    findByEmail(email: string): Promise<any>;
    findById(id: string): Promise<any>;
    assertIdentityAvailable(email: string): Promise<void>;
    updateManagedProfile(actor: AuditActor, id: string, dto: UpdateManagedUserProfileDto): Promise<any>;
    private assertBusinessAssignment;
    createOrUpdate(dto: CreateUserProfileDto & {
        user_id?: string;
        password?: string;
        status?: 'active' | 'pending' | 'inactive';
    }): Promise<any>;
    recordCreation(actor: AuditActor, profile: any): Promise<void>;
    private syncMerchantLink;
    private syncAuthMetadata;
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
