import { Module } from '@nestjs/common';
import { AuthEmailHookController } from './auth-email-hook.controller';
import { AuthEmailHookService } from './auth-email-hook.service';
import { ApplicationEmailService } from './application-email.service';

@Module({
  controllers: [AuthEmailHookController],
  providers: [AuthEmailHookService, ApplicationEmailService],
  exports: [ApplicationEmailService],
})
export class AuthEmailHookModule {}
