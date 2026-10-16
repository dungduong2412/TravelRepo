import { MerchantsService } from './merchants.service';
import { AdminCreateMerchantDto, AdminUpdateMerchantDto, CreateMerchantDto, CreateMerchantMemberDto, UpdateMerchantDto } from './merchants.dto';
export declare class MerchantsController {
    private readonly service;
    constructor(service: MerchantsService);
    findAll(): Promise<Omit<any, "owner_password">[]>;
    findVerified(): Promise<Omit<any, "owner_password">[]>;
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
    }, dto: CreateMerchantMemberDto): Promise<any>;
    createByAdmin(actor: any, dto: AdminCreateMerchantDto): Promise<Omit<any, "owner_password">>;
    updateByAdmin(actor: any, id: string, dto: AdminUpdateMerchantDto): Promise<Omit<any, "owner_password">>;
    findById(actor: {
        id: string;
    }, id: string): Promise<Omit<any, "owner_password">>;
    create(dto: CreateMerchantDto): Promise<Omit<any, "owner_password">>;
    update(actor: {
        id: string;
    }, id: string, dto: UpdateMerchantDto): Promise<Omit<any, "owner_password">>;
    approve(actor: any, id: string): Promise<Omit<any, "owner_password">>;
    reject(actor: any, id: string): Promise<Omit<any, "owner_password">>;
    delete(actor: any, id: string): Promise<Omit<any, "owner_password">>;
}
