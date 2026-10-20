import { MerchantsService } from './merchants.service';
import { AdminCreateMerchantDto, AdminUpdateMerchantDto, CreateMerchantDto, CreateMerchantMemberDto, UpdateMerchantDto, MerchantDirectoryQuery } from './merchants.dto';
export declare class MerchantsController {
    private readonly service;
    constructor(service: MerchantsService);
    findAll(): Promise<Omit<any, "owner_password">[]>;
    findDirectory(query: MerchantDirectoryQuery): Promise<{
        items: Omit<{
            error: true;
        } & "Received a generic string", "owner_password">[];
        page: number;
        page_size: number;
        total: number;
        page_count: number;
    }>;
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
    operationalDetail(id: string): Promise<{
        merchant: Omit<any, "owner_password">;
        update_requests: {
            id: any;
            legacy_request_id: any;
            legacy_status: any;
            requested_at: any;
            payload: any;
            created_at: any;
            request_status: any;
            request_source: any;
            requested_by: any;
            decided_by: any;
            decided_at: any;
            decision_reason: any;
        }[];
        media: {
            id: any;
            legacy_image_id: any;
            legacy_merchant_image_id: any;
            original_filename: any;
            mime_type: any;
            size_bytes: any;
            is_hero: any;
            display_order: any;
            transfer_status: any;
            publication_status: any;
            publication_version: any;
            effective_from: any;
            effective_until: any;
            approved_by: any;
            approved_at: any;
            created_at: any;
        }[];
        categories: {
            category_id: any;
            category: {
                id: any;
                category_name: any;
                category_name_vi: any;
            }[];
        }[];
    }>;
    updateByAdmin(actor: any, id: string, dto: AdminUpdateMerchantDto): Promise<Omit<any, "owner_password">>;
    findById(actor: {
        id: string;
    }, id: string): Promise<{
        category_ids: any[];
    }>;
    create(dto: CreateMerchantDto): Promise<Omit<any, "owner_password">>;
    update(actor: {
        id: string;
    }, id: string, dto: UpdateMerchantDto): Promise<Omit<any, "owner_password">>;
    approve(actor: any, id: string): Promise<Omit<any, "owner_password">>;
    reject(actor: any, id: string): Promise<Omit<any, "owner_password">>;
    delete(actor: any, id: string): Promise<Omit<any, "owner_password">>;
}
