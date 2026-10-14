import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
export declare class SupabaseService implements OnModuleInit, OnModuleDestroy {
    private client;
    onModuleInit(): Promise<void>;
    onModuleDestroy(): void;
    getClient(): SupabaseClient;
}
