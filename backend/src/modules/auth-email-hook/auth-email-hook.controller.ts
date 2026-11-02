import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { AuthEmailHookService } from './auth-email-hook.service';

// Anonymous by design: authenticated only by the Standard Webhooks signature from Supabase Auth.
@Controller('auth/hooks')
export class AuthEmailHookController {
  constructor(private readonly service: AuthEmailHookService) {}

  @Post('send-email')
  @HttpCode(200)
  handle(@Req() req: any) {
    return this.service.handle({
      'webhook-id': req.headers['webhook-id'], 'webhook-timestamp': req.headers['webhook-timestamp'], 'webhook-signature': req.headers['webhook-signature'],
    }, req.rawBody ?? Buffer.alloc(0));
  }
}
