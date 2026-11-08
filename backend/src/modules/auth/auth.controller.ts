import { Controller, Post, Body, HttpCode, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import { IsEmail, IsString, IsOptional } from 'class-validator';
import { clientIp } from '../../common/http/rate-limiter';
import { ActivationService } from '../activation/activation.service';

export class LoginDto {
  @IsEmail()
  email!: string;
  
  @IsString()
  password!: string;
  
  @IsOptional()
  userType?: 'merchant' | 'collaborator' | 'admin';
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly activation: ActivationService) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto) {
    // Auto-detect user type if not provided
    return this.authService.loginAuto(dto.email, dto.password, dto.userType);
  }

  /** Redeems the single-use link from the "account approved" e-mail (token travels in the body, never in a URL). */
  @Public()
  @Post('activate')
  async activate(@Body() body: { token?: unknown }, @Req() req: any) {
    return this.authService.activate(body?.token, clientIp(req));
  }

  /**
   * "Send me a new activation link". Always answers 202 with the same body: it never reveals whether an e-mail is registered, approved
   * or already activated. Rate limited per address and per client; the e-mail itself goes out only for an eligible approved account.
   */
  @Public()
  @Post('activation-link')
  @HttpCode(202)
  requestActivationLink(@Body() body: { email?: unknown }, @Req() req: any) {
    this.activation.requestLink(body?.email, clientIp(req));
    return { accepted: true };
  }
}
