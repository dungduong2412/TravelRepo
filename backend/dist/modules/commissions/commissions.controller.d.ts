import { CommissionsService } from './commissions.service';
export declare class CommissionsController {
    private readonly service;
    constructor(service: CommissionsService);
    mine(actor: {
        id: string;
    }): Promise<{
        transaction_count: any;
        commission_amount: string;
        document_total: string;
        payment_statuses: any;
    }>;
    all(): Promise<{
        transaction_count: any;
        commission_amount: string;
        document_total: string;
        payment_statuses: any;
    }>;
}
