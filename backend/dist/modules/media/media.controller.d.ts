import { MediaService } from './media.service';
import { UploadMediaDto } from './media.dto';
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
        is_hero: any;
        display_order: any;
        transfer_status: any;
        created_at: any;
    }[]>;
    upload(actor: {
        id: string;
    }, dto: UploadMediaDto): Promise<any>;
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
    }[]>;
}
