import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { AuditService } from './audit.service';

@Controller('audit-events')
@UseGuards(JwtGuard, AdminGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  recent(@Query('limit') limit?: string) {
    const parsed = Number(limit || 100);
    return this.audit.recent(Number.isFinite(parsed) ? parsed : 100);
  }
}
