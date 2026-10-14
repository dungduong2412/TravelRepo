import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const actor = request.user;

    if (!actor?.id) {
      throw new ForbiddenException('Admin access required');
    }

    const { data, error } = await this.supabase.getClient()
      .from('user_profiles')
      .select('role, user_profiles_status')
      .eq('user_id', actor.id)
      .maybeSingle();

    if (
      error ||
      !data ||
      data.role !== 'admin' ||
      data.user_profiles_status !== 'active'
    ) {
      throw new ForbiddenException('Admin access required');
    }

    request.user = { ...actor, role: data.role };
    return true;
  }
}
