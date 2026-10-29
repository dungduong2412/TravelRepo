import { CollaboratorsService } from './collaborators.service';
import { CreateCollaboratorDto, AdminCreateCollaboratorDto, CreateCollaboratorMemberDto, AdminUpdateCollaboratorDto, UpdateCollaboratorDto } from './collaborators.dto';
export declare class CollaboratorsController {
    private readonly service;
    constructor(service: CollaboratorsService);
    create(actor: any, dto: CreateCollaboratorDto): Promise<Omit<any, "collaborators_password">>;
    resubmit(actor: {
        id: string;
    }, id: string): Promise<Omit<any, "collaborators_password">>;
    listAll(): Promise<Omit<any, "collaborators_password">[]>;
    createByAdmin(actor: any, dto: AdminCreateCollaboratorDto): Promise<Omit<any, "collaborators_password">>;
    getMe(actor: any): Promise<Omit<any, "collaborators_password">>;
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
    listMembers(actor: {
        id: string;
    }): Promise<{
        id: any;
        collaborators_name: any;
        collaborators_phone: any;
        collaborators_email: any;
        collaborators_avatar_url: any;
        collaborators_registered_date: any;
        collaborators_verified: any;
        collaborators_status: any;
    }[]>;
    createMember(actor: {
        id: string;
    }, dto: CreateCollaboratorMemberDto): Promise<Omit<any, "collaborators_password">>;
    resolveByCode(code: string): Promise<{
        collaboratorId: any;
        displayName: any;
        rating: any;
        verified: any;
    }>;
    approve(actor: any, id: string): Promise<Omit<any, "collaborators_password">>;
    reject(actor: any, id: string): Promise<Omit<any, "collaborators_password">>;
    updateByAdmin(actor: any, id: string, dto: AdminUpdateCollaboratorDto): Promise<Omit<any, "collaborators_password">>;
    update(actor: any, id: string, dto: UpdateCollaboratorDto): Promise<Omit<any, "collaborators_password">>;
    remove(actor: any, id: string): Promise<Omit<any, "collaborators_password">>;
}
