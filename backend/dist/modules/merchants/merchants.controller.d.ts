import { MerchantsService } from './merchants.service';
import { CreateMerchantDto, UpdateMerchantDto } from './merchants.dto';
export declare class MerchantsController {
    private readonly service;
    constructor(service: MerchantsService);
    findAll(): Promise<Omit<any, "owner_password">[]>;
    findVerified(): Promise<Omit<any, "owner_password">[]>;
    findById(actor: {
        id: string;
    }, id: string): Promise<Omit<any, "owner_password">>;
    create(dto: CreateMerchantDto): Promise<Omit<any, "owner_password">>;
    update(actor: {
        id: string;
    }, id: string, dto: UpdateMerchantDto): Promise<Omit<any, "owner_password">>;
    approve(id: string): Promise<Omit<any, "owner_password">>;
    reject(id: string): Promise<Omit<any, "owner_password">>;
    delete(id: string): Promise<{
        success: boolean;
    }>;
}
