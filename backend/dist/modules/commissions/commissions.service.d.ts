import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
export declare class CommissionsService {
    private readonly supabase;
    constructor(supabase: SupabaseService);
    private decimal4;
    private format4;
    private summarize;
    private rows;
    forActor(userId: string): Promise<{
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
