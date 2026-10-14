import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
export declare class TransactionsService {
    private readonly supabase;
    constructor(supabase: SupabaseService);
    private profile;
    findForActor(userId: string): Promise<({
        error: true;
    } & "Received a generic string")[]>;
    findAll(): Promise<({
        error: true;
    } & "Received a generic string")[]>;
    upsertImported(rows: Record<string, unknown>[]): Promise<void>;
}
