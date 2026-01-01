import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // For now, allow all requests (authentication can be added later)
    // TODO: Implement proper JWT validation
    const request = context.switchToHttp().getRequest();
    
    // Mock user for development
    request.user = {
      id: 'mock-user-id',
      email: 'mock@example.com',
    };

    return true;
  }
}
