import { MediaService } from './media.service';
export declare class MediaController {
    private readonly service;
    constructor(service: MediaService);
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
