import { Module } from '@nestjs/common';
import { AuthEmailHookController } from './auth-email-hook.controller';
import { AuthEmailHookService } from './auth-email-hook.service';
import { AuthDiagnosticsController } from './auth-diagnostics.controller';
import { ApplicationEmailService } from './application-email.service';

@Module({
  controllers: [AuthEmailHookController, AuthDiagnosticsController],
  providers: [AuthEmailHookService, ApplicationEmailService],
  exports: [ApplicationEmailService],
})
export class AuthEmailHookModule {}
