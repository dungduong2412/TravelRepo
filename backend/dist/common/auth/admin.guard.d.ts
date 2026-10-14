import { CanActivate, ExecutionContext } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
export declare class AdminGuard implements CanActivate {
    private readonly supabase;
    constructor(supabase: SupabaseService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
