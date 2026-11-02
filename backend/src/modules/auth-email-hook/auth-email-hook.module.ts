import { Module } from '@nestjs/common';
import { AuthEmailHookController } from './auth-email-hook.controller';
import { AuthEmailHookService } from './auth-email-hook.service';

@Module({ controllers: [AuthEmailHookController], providers: [AuthEmailHookService] })
export class AuthEmailHookModule {}
