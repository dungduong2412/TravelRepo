import { CollaboratorsService } from './collaborators.service';
import { CreateCollaboratorDto, UpdateCollaboratorDto } from './collaborators.dto';
export declare class CollaboratorsController {
    private readonly service;
    constructor(service: CollaboratorsService);
    create(actor: any, dto: CreateCollaboratorDto): Promise<Omit<any, "collaborators_password">>;
    listAll(): Promise<Omit<any, "collaborators_password">[]>;
    getMe(actor: any): Promise<Omit<any, "collaborators_password">>;
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
    resolveByCode(code: string): Promise<{
        collaboratorId: any;
        displayName: any;
        rating: any;
        verified: any;
    }>;
    approve(id: string): Promise<Omit<any, "collaborators_password">>;
    reject(id: string): Promise<any>;
    update(actor: any, id: string, dto: UpdateCollaboratorDto): Promise<Omit<any, "collaborators_password">>;
    remove(actor: any, id: string): Promise<{
        success: boolean;
    }>;
}
