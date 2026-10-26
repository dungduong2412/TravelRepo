import { CollaboratorsService } from '../collaborators/collaborators.service';
export declare class QrController {
    private readonly collaboratorsService;
    constructor(collaboratorsService: CollaboratorsService);
    resolve(qrToken: string): Promise<{
        collaboratorId: any;
        displayName: any;
        rating: any;
        verified: any;
    }>;
}
