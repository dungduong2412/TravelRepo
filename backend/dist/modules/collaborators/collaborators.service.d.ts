import { CreateCollaboratorDto, UpdateCollaboratorDto } from './collaborators.dto';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { UserProfilesService } from '../user-profiles/user-profiles.service';
export declare class CollaboratorsService {
    private readonly supabase;
    private readonly userProfilesService;
    constructor(supabase: SupabaseService, userProfilesService: UserProfilesService);
    createCollaborator(actor: any, dto: CreateCollaboratorDto): Promise<Omit<any, "collaborators_password">>;
    private withoutPassword;
    private assertOwnerOrAdmin;
    getMyCollaborator(actor: any): Promise<Omit<any, "collaborators_password">>;
    getMyQrCode(actor: any): Promise<{
        qr_code: any;
        qr_code_image: any;
        code: any;
        collaborator_code: any;
        name: any;
        collaborator_name: any;
        collaborator_phone: any;
        verified: any;
    }>;
    private generateCollaboratorCode;
    updateCollaborator(actor: any, collaboratorId: string, dto: UpdateCollaboratorDto): Promise<Omit<any, "collaborators_password">>;
    deleteCollaborator(actor: any, collaboratorId: string): Promise<{
        success: boolean;
    }>;
    resolveByCode(code: string): Promise<{
        collaboratorId: any;
        displayName: any;
        rating: any;
        verified: any;
    }>;
    listAll(): Promise<Omit<any, "collaborators_password">[]>;
    findPending(): Promise<Omit<any, "collaborators_password">[]>;
    approve(id: string): Promise<Omit<any, "collaborators_password">>;
    resolveByQrToken(qrToken: string): Promise<{
        collaboratorId: any;
        displayName: any;
        code: any;
        verified: any;
    }>;
    reject(id: string): Promise<any>;
    create(dto: CreateCollaboratorDto): Promise<Omit<any, "collaborators_password">>;
    findOne(id: string): Promise<Omit<any, "collaborators_password">>;
    update(id: string, dto: UpdateCollaboratorDto): Promise<Omit<any, "collaborators_password">>;
    generateQRCodeImage(id: string): Promise<{
        qr_code_image: string;
        collaborator_code: any;
        collaborator_name: any;
        verified: any;
    }>;
}
