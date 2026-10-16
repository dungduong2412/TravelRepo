import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AdminCreateMerchantDto, AdminUpdateMerchantDto, CreateMerchantDto, CreateMerchantMemberDto, UpdateMerchantDto } from './merchants.dto';
import { UserProfilesService } from '../user-profiles/user-profiles.service';
import { AuditActor, AuditService } from '../audit/audit.service';
export declare class MerchantsService {
    private readonly supabase;
    private readonly userProfilesService;
    private readonly audit;
    constructor(supabase: SupabaseService, userProfilesService: UserProfilesService, audit: AuditService);
    private generateMerchantCode;
    private withoutPassword;
    findAll(): Promise<Omit<any, "owner_password">[]>;
    findById(id: string): Promise<Omit<any, "owner_password">>;
    findByIdForActor(userId: string, id: string): Promise<Omit<any, "owner_password">>;
    findByEmail(email: string): Promise<any>;
    findVerified(): Promise<Omit<any, "owner_password">[]>;
    create(dto: CreateMerchantDto): Promise<Omit<any, "owner_password">>;
    createByAdmin(actor: AuditActor, dto: AdminCreateMerchantDto): Promise<Omit<any, "owner_password">>;
    update(id: string, dto: UpdateMerchantDto): Promise<Omit<any, "owner_password">>;
    updateForActor(userId: string, id: string, dto: UpdateMerchantDto): Promise<Omit<any, "owner_password">>;
    updateByAdmin(actor: AuditActor, id: string, dto: AdminUpdateMerchantDto): Promise<Omit<any, "owner_password">>;
    private requireActiveMerchantProfile;
    listMembers(userId: string): Promise<{
        id: any;
        collaborators_name: any;
        collaborators_phone: any;
        collaborators_email: any;
        collaborators_avatar_url: any;
        collaborators_registered_date: any;
        collaborators_verified: any;
        collaborators_status: any;
    }[]>;
    createMember(userId: string, dto: CreateMerchantMemberDto): Promise<any>;
    deactivate(actor: AuditActor, id: string): Promise<Omit<any, "owner_password">>;
    approve(actor: AuditActor, id: string): Promise<Omit<any, "owner_password">>;
    reject(actor: AuditActor, id: string): Promise<Omit<any, "owner_password">>;
}
