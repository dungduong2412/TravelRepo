import { Controller, Post, Body, UnauthorizedException, ValidationPipe, UsePipes } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import { IsEmail, IsString, IsIn } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;
  
  @IsString()
  password!: string;
  
  @IsIn(['merchant', 'collaborator'])
  userType!: 'merchant' | 'collaborator';
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto) {
    console.log('Controller received:', dto);
    return this.authService.login(dto.email, dto.password, dto.userType);
  }
}
