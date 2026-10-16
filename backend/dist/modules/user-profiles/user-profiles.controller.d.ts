import { UserProfilesService } from './user-profiles.service';
export declare class UserProfilesController {
    private readonly userProfilesService;
    constructor(userProfilesService: UserProfilesService);
    findAll(): Promise<any[]>;
    backfill(): Promise<{
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
    getMyProfile(actor: any): Promise<any>;
    trackLogin(actor: any): Promise<any>;
    findById(id: string): Promise<any>;
    updateManagedProfile(id: string, actor: any, dto: any): Promise<any>;
    createUser(actor: any, dto: any): Promise<any>;
}
