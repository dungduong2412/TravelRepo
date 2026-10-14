import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit, OnModuleDestroy {
  private client: SupabaseClient;

  async onModuleInit() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log('[supabase] init', {
      urlConfigured: Boolean(supabaseUrl),
      anonKeyConfigured: Boolean(supabaseAnonKey),
      serviceKeyConfigured: Boolean(supabaseKey),
    });

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase URL or Service Role Key is missing in environment variables');
    }

    this.client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  onModuleDestroy() {
    // Cleanup if needed
  }

  getClient(): SupabaseClient {
    if (!this.client) {
      throw new Error('Supabase client not initialized');
    }
    return this.client;
  }
}
