import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { UploadMediaDto } from './media.dto';
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
        is_hero: any;
        display_order: any;
        transfer_status: any;
        created_at: any;
    }[]>;
    upload(userId: string, dto: UploadMediaDto): Promise<any>;
    upsertImported(rows: Record<string, unknown>[]): Promise<void>;
}
