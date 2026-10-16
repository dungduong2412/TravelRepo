import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

export interface AuditActor {
  id: string;
  role?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly supabase: SupabaseService) {}

  async record(
    actor: AuditActor,
    action: string,
    entityType: string,
    entityId: string,
    details: Record<string, unknown> = {},
  ) {
    const { error } = await this.supabase.getClient().from('audit_events').insert({
      actor_auth_user_id: actor.id,
      actor_role: actor.role || 'unknown',
      action,
      entity_type: entityType,
      entity_id: entityId,
      source: 'v2-admin-api',
      details,
    });
    if (error) throw new InternalServerErrorException('Unable to write audit event');
  }

  async recent(limit = 100) {
    const boundedLimit = Math.min(Math.max(limit, 1), 250);
    const { data, error } = await this.supabase.getClient().from('audit_events')
      .select('id,occurred_at,actor_auth_user_id,actor_role,action,entity_type,entity_id,source,details')
      .order('occurred_at', { ascending: false })
      .limit(boundedLimit);
    if (error) throw new InternalServerErrorException('Unable to load audit events');
    return data || [];
  }
}
