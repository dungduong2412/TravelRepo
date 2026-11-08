import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { ActivationModule } from '../activation/activation.module';

@Module({
  imports: [SupabaseModule, ActivationModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
