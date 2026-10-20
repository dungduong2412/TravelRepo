import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { MediaApprovalQuery, MediaChangeRequestDto, UploadMediaDto } from './media.dto';
import { AuditService } from '../audit/audit.service';
export declare function hasExpectedImageSignature(bytes: Buffer, mimeType: string): boolean;
export declare class MediaService {
    private readonly supabase;
    private readonly audit;
    constructor(supabase: SupabaseService, audit: AuditService);
    findAll(): Promise<{
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
    createAuthorizedSignedUrl(userId: string, mediaId: string): Promise<{
        expires_in: number;
        signedUrl: string;
    }>;
    private activeProfile;
    private removeUploadedObject;
    findMine(userId: string): Promise<{
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
    private ownedTarget;
    upload(userId: string, dto: UploadMediaDto): Promise<any>;
    requestChange(userId: string, dto: MediaChangeRequestDto): Promise<any>;
    cancel(userId: string, requestId: string): Promise<{
        request: any;
        object_removed: boolean;
    }>;
    approve(userId: string, requestId: string, reason?: string): Promise<any>;
    reject(userId: string, requestId: string, reason?: string): Promise<any>;
    approvalQueue(filter: MediaApprovalQuery): Promise<{
        items: ({
            error: true;
        } & "Received a generic string")[];
        page: number;
        page_size: number;
        total: number;
        page_count: number;
    }>;
    findEffective(ownerType: string, ownerId: string): Promise<{
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
    upsertImported(rows: Record<string, unknown>[]): Promise<void>;
}
