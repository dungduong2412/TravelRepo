import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { User } from '../../common/auth/user.decorator';
import { TransactionsService } from './transactions.service';

@Controller('transactions')
@UseGuards(JwtGuard)
export class TransactionsController {
  constructor(private readonly service: TransactionsService) {}

  @Get('me')
  findMine(@User() actor: { id: string }) {
    return this.service.findForActor(actor.id);
  }

  @Get()
  @UseGuards(AdminGuard)
  findAll() {
    return this.service.findAll();
  }
}
