import { Module } from '@nestjs/common';
import { AuthEmailHookModule } from '../auth-email-hook/auth-email-hook.module';
import { ActivationService } from './activation.service';

@Module({
  imports: [AuthEmailHookModule],
  providers: [ActivationService],
  exports: [ActivationService],
})
export class ActivationModule {}
