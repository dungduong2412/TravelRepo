import { AdminUpdateCollaboratorDto, AdminCreateCollaboratorDto, CreateCollaboratorDto, CreateCollaboratorMemberDto, UpdateCollaboratorDto } from './collaborators.dto';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { UserProfilesService } from '../user-profiles/user-profiles.service';
import { AuditActor, AuditService } from '../audit/audit.service';
export declare class CollaboratorsService {
    private readonly supabase;
    private readonly userProfilesService;
    private readonly audit;
    constructor(supabase: SupabaseService, userProfilesService: UserProfilesService, audit: AuditService);
    createCollaborator(actor: any, dto: CreateCollaboratorDto): Promise<Omit<any, "collaborators_password">>;
    createByAdmin(actor: AuditActor, dto: AdminCreateCollaboratorDto): Promise<Omit<any, "collaborators_password">>;
    private withoutPassword;
    private assertOwner;
    private requireActiveCollaboratorProfile;
    getMyCollaborator(actor: any): Promise<Omit<any, "collaborators_password">>;
    getMyQrCode(actor: any): Promise<{
        qr_code: string;
        qr_code_image: string;
        qr_payload: any;
        qr_payload_format: string;
        code: any;
        collaborator_code: any;
        name: any;
        collaborator_name: any;
        collaborator_phone: any;
        verified: any;
    }>;
    private generateCollaboratorCode;
    private generateCodeImage;
    private collaboratorCodeFromPayload;
    updateCollaborator(actor: any, collaboratorId: string, dto: UpdateCollaboratorDto): Promise<Omit<any, "collaborators_password">>;
    resubmit(userId: string, collaboratorId: string): Promise<Omit<any, "collaborators_password">>;
    deactivateCollaborator(actor: AuditActor, collaboratorId: string): Promise<Omit<any, "collaborators_password">>;
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
    createMember(userId: string, dto: CreateCollaboratorMemberDto): Promise<Omit<any, "collaborators_password">>;
    resolveByCode(code: string): Promise<{
        collaboratorId: any;
        displayName: any;
        rating: any;
        verified: any;
    }>;
    listAll(): Promise<Omit<any, "collaborators_password">[]>;
    findPending(): Promise<Omit<any, "collaborators_password">[]>;
    approve(actor: AuditActor, id: string): Promise<Omit<any, "collaborators_password">>;
    resolveByQrToken(qrToken: string): Promise<{
        collaboratorId: any;
        displayName: any;
        rating: any;
        verified: any;
    }>;
    resolveQrForMerchant(userId: string, payload: string): Promise<{
        collaborator_id: any;
        collaborator_code: any;
        collaborator_name: any;
        verified: any;
        status: any;
        association: string;
        idempotent: boolean;
        financial_action_created: boolean;
    }>;
    reject(actor: AuditActor, id: string): Promise<Omit<any, "collaborators_password">>;
    updateByAdmin(actor: AuditActor, id: string, dto: AdminUpdateCollaboratorDto): Promise<Omit<any, "collaborators_password">>;
    findOne(id: string): Promise<Omit<any, "collaborators_password">>;
    generateQRCodeImage(id: string): Promise<{
        qr_code_image: string;
        collaborator_code: any;
        collaborator_name: any;
        verified: any;
    }>;
}
