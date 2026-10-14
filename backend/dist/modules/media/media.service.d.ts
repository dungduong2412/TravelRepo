import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
export declare class MediaService {
    private readonly supabase;
    constructor(supabase: SupabaseService);
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
    upsertImported(rows: Record<string, unknown>[]): Promise<void>;
}
