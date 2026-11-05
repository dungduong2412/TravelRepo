import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { User } from '../../common/auth/user.decorator';
import { TransactionsService } from './transactions.service';
import {
  CreateRealTransaction,
  CreateRealTransactionSchema,
  CreateUatSimulationTransaction,
  CreateUatSimulationTransactionSchema,
  TransactionAction,
  TransactionActionSchema,
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

  @Post('real')
  createReal(
    @User() actor: { id: string },
    @Body(new ZodValidationPipe(CreateRealTransactionSchema)) dto: CreateRealTransaction,
  ) {
    return this.service.createRealTransaction(actor.id, dto);
  }

  @Post(':id/confirm')
  confirm(
    @User() actor: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TransactionActionSchema)) dto: TransactionAction,
  ) {
    return this.service.confirmTransaction(actor.id, id, dto);
  }

  @Post(':id/cancel')
  cancel(
    @User() actor: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TransactionActionSchema)) dto: TransactionAction,
  ) {
    return this.service.cancelTransaction(actor.id, id, dto);
  }

  @Post(':id/reverse')
  @UseGuards(AdminGuard)
  reverse(
    @User() actor: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TransactionActionSchema)) dto: TransactionAction,
  ) {
    return this.service.reverseTransaction(actor.id, id, dto);
  }

  @Get()
  @UseGuards(AdminGuard)
  findAll() {
    return this.service.findAll();
  }
}
