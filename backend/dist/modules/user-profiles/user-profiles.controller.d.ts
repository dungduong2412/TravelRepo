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
    createUser(dto: any): Promise<any>;
}
//# sourceMappingURL=user-profiles.controller.d.ts.map