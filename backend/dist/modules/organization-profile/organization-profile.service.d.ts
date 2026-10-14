import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { CreateOrganizationProfileDto, UpdateOrganizationProfileDto } from './organization-profile.dto';
export declare class OrganizationProfileService {
    private readonly supabase;
    constructor(supabase: SupabaseService);
    get(): Promise<any>;
    create(dto: CreateOrganizationProfileDto): Promise<any>;
    update(dto: UpdateOrganizationProfileDto): Promise<any>;
    createOrUpdate(dto: CreateOrganizationProfileDto | UpdateOrganizationProfileDto): Promise<any>;
    delete(): Promise<{
        success: boolean;
    }>;
}
