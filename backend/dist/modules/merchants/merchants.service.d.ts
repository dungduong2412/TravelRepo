import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AdminCreateMerchantDto, AdminUpdateMerchantDto, CreateMerchantDto, CreateMerchantMemberDto, MerchantDirectoryQuery, UpdateMerchantDto } from './merchants.dto';
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
    findDirectory(filter: MerchantDirectoryQuery): Promise<{
        items: Omit<{
            error: true;
        } & "Received a generic string", "owner_password">[];
        page: number;
        page_size: number;
        total: number;
        page_count: number;
    }>;
    findById(id: string): Promise<Omit<any, "owner_password">>;
    findByIdForActor(userId: string, id: string): Promise<{
        category_ids: any[];
    }>;
    operationalDetail(id: string): Promise<{
        merchant: Omit<any, "owner_password">;
        update_requests: {
            id: any;
            legacy_request_id: any;
            legacy_status: any;
            requested_at: any;
            payload: any;
            created_at: any;
            request_status: any;
            request_source: any;
            requested_by: any;
            decided_by: any;
            decided_at: any;
            decision_reason: any;
        }[];
        media: {
            id: any;
            legacy_image_id: any;
            legacy_merchant_image_id: any;
            original_filename: any;
            mime_type: any;
            size_bytes: any;
            is_hero: any;
            display_order: any;
            transfer_status: any;
            publication_status: any;
            publication_version: any;
            effective_from: any;
            effective_until: any;
            approved_by: any;
            approved_at: any;
            created_at: any;
        }[];
        categories: {
            category_id: any;
            category: {
                id: any;
                category_name: any;
                category_name_vi: any;
            }[];
        }[];
    }>;
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
