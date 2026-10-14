import { OrganizationProfileService } from './organization-profile.service';
import { CreateOrganizationProfileDto, UpdateOrganizationProfileDto } from './organization-profile.dto';
export declare class OrganizationProfileController {
    private readonly service;
    constructor(service: OrganizationProfileService);
    get(): Promise<any>;
    create(dto: CreateOrganizationProfileDto): Promise<any>;
    update(dto: UpdateOrganizationProfileDto): Promise<any>;
    createOrUpdate(dto: CreateOrganizationProfileDto): Promise<any>;
    delete(): Promise<{
        success: boolean;
    }>;
}
