import { Controller, Post, Body, UnauthorizedException, ValidationPipe, UsePipes } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import { IsEmail, IsString, IsOptional } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;
  
  @IsString()
  password!: string;
  
  @IsOptional()
  userType?: 'merchant' | 'collaborator';
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto) {
    console.log('Controller received:', dto);
    // Auto-detect user type if not provided
    return this.authService.loginAuto(dto.email, dto.password, dto.userType);
  }
}
