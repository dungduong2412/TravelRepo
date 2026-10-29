import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { User } from '../../common/auth/user.decorator';
import { TransactionsService } from './transactions.service';
import {
  CreateUatSimulationTransaction,
  CreateUatSimulationTransactionSchema,
  TransactionReportQuery,
  TransactionReportQuerySchema,
} from './transactions.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller('transactions')
@UseGuards(JwtGuard)
export class TransactionsController {
  constructor(private readonly service: TransactionsService) {}

  @Get('me/report')
  reportMine(
    @User() actor: { id: string },
    @Query(new ZodValidationPipe(TransactionReportQuerySchema)) query: TransactionReportQuery,
  ) {
    return this.service.reportForActor(actor.id, query);
  }

  @Get('report')
  @UseGuards(AdminGuard)
  report(
    @Query(new ZodValidationPipe(TransactionReportQuerySchema)) query: TransactionReportQuery,
  ) {
    return this.service.report(query);
  }

  @Get('me')
  findMine(@User() actor: { id: string }) {
    return this.service.findForActor(actor.id);
  }

  @Post('simulation')
  createSimulation(
    @User() actor: { id: string },
    @Body(new ZodValidationPipe(CreateUatSimulationTransactionSchema)) dto: CreateUatSimulationTransaction,
  ) {
    return this.service.createUatSimulation(actor.id, dto);
  }

  @Get()
  @UseGuards(AdminGuard)
  findAll() {
    return this.service.findAll();
  }
}
