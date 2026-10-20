import { MediaService } from './media.service';
import { MediaApprovalQuery, MediaChangeRequestDto, MediaDecisionDto, UploadMediaDto } from './media.dto';
export declare class MediaController {
    private readonly service;
    constructor(service: MediaService);
    mine(actor: {
        id: string;
    }): Promise<{
        id: any;
        merchant_id: any;
        collaborator_id: any;
        bucket_id: any;
        object_path: any;
        original_filename: any;
        mime_type: any;
        size_bytes: any;
        sha256_hex: any;
        is_hero: any;
        display_order: any;
        transfer_status: any;
        publication_status: any;
        publication_version: any;
        created_at: any;
        approval_requests: {
            id: any;
            action: any;
            slot: any;
            status: any;
            requested_at: any;
            decided_at: any;
            decision_reason: any;
            target_media_id: any;
            requested_display_order: any;
        }[];
    }[]>;
    upload(actor: {
        id: string;
    }, dto: UploadMediaDto): Promise<any>;
    requestChange(actor: {
        id: string;
    }, dto: MediaChangeRequestDto): Promise<any>;
    cancel(actor: {
        id: string;
    }, id: string): Promise<{
        request: any;
        object_removed: boolean;
    }>;
    approved(ownerType: string, ownerId: string): Promise<{
        signed_url: string;
        expires_in: number;
        id: any;
        bucket_id: any;
        object_path: any;
        original_filename: any;
        mime_type: any;
        size_bytes: any;
        sha256_hex: any;
        is_hero: any;
        display_order: any;
        publication_status: any;
        effective_from: any;
    }[]>;
    approvals(query: MediaApprovalQuery): Promise<{
        items: ({
            error: true;
        } & "Received a generic string")[];
        page: number;
        page_size: number;
        total: number;
        page_count: number;
    }>;
    approve(actor: {
        id: string;
    }, id: string, dto: MediaDecisionDto): Promise<any>;
    reject(actor: {
        id: string;
    }, id: string, dto: MediaDecisionDto): Promise<any>;
    signedUrl(actor: {
        id: string;
    }, id: string): Promise<{
        expires_in: number;
        signedUrl: string;
    }>;
    all(): Promise<{
        id: any;
        merchant_id: any;
        collaborator_id: any;
        bucket_id: any;
        object_path: any;
        mime_type: any;
        size_bytes: any;
        is_hero: any;
        display_order: any;
        transfer_status: any;
        publication_status: any;
        publication_version: any;
        uploaded_by: any;
        approved_by: any;
        approved_at: any;
        effective_from: any;
        effective_until: any;
    }[]>;
}
