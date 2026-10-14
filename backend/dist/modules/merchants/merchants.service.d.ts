import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { CreateMerchantDto, UpdateMerchantDto } from './merchants.dto';
import { UserProfilesService } from '../user-profiles/user-profiles.service';
export declare class MerchantsService {
    private readonly supabase;
    private readonly userProfilesService;
    constructor(supabase: SupabaseService, userProfilesService: UserProfilesService);
    private generateMerchantCode;
    private withoutPassword;
    findAll(): Promise<Omit<any, "owner_password">[]>;
    findById(id: string): Promise<Omit<any, "owner_password">>;
    findByIdForActor(userId: string, id: string): Promise<Omit<any, "owner_password">>;
    findByEmail(email: string): Promise<any>;
    findVerified(): Promise<Omit<any, "owner_password">[]>;
    create(dto: CreateMerchantDto): Promise<Omit<any, "owner_password">>;
    update(id: string, dto: UpdateMerchantDto): Promise<Omit<any, "owner_password">>;
    updateForActor(userId: string, id: string, dto: UpdateMerchantDto): Promise<Omit<any, "owner_password">>;
    delete(id: string): Promise<{
        success: boolean;
    }>;
    approve(id: string): Promise<Omit<any, "owner_password">>;
    reject(id: string): Promise<Omit<any, "owner_password">>;
}
