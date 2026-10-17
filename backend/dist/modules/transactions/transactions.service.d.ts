import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { TransactionReportQuery } from './transactions.dto';
export declare class TransactionsService {
    private readonly supabase;
    constructor(supabase: SupabaseService);
    private profile;
    private decimal4;
    private format4;
    private applyReportFilters;
    private summarizeFiltered;
    private buildReport;
    report(filter: TransactionReportQuery): Promise<{
        items: ({
            error: true;
        } & "Received a generic string")[];
        page: number;
        page_size: number;
        total: number;
        page_count: number;
        summary: {
            transaction_count: number;
            document_total: string;
            document_discount_amount: string;
            commission_amount: string;
            payment_statuses: Record<string, number>;
            lifecycle_statuses: Record<string, number>;
            source_statuses: Record<string, number>;
        };
    }>;
    reportForActor(userId: string, filter: TransactionReportQuery): Promise<{
        items: ({
            error: true;
        } & "Received a generic string")[];
        page: number;
        page_size: number;
        total: number;
        page_count: number;
        summary: {
            transaction_count: number;
            document_total: string;
            document_discount_amount: string;
            commission_amount: string;
            payment_statuses: Record<string, number>;
            lifecycle_statuses: Record<string, number>;
            source_statuses: Record<string, number>;
        };
    }>;
    findForActor(userId: string): Promise<({
        error: true;
    } & "Received a generic string")[]>;
    findAll(): Promise<({
        error: true;
    } & "Received a generic string")[]>;
    upsertImported(rows: Record<string, unknown>[]): Promise<void>;
}
