import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { CollaboratorsService } from './collaborators.service';
import { CreateCollaboratorDto, UpdateCollaboratorDto, CreateCollaboratorSchema, UpdateCollaboratorSchema } from './collaborators.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller('collaborators')
export class CollaboratorsController {
  constructor(private readonly service: CollaboratorsService) {}

  @Get()
  async findAll() {
    return this.service.findAll();
  }

  @Get('verified')
  async findVerified() {
    return this.service.findVerified();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Get(':id/qr-code')
  async getQRCode(@Param('id') id: string) {
    return this.service.generateQRCodeImage(id);
  }

  @Get('qr/:qrCode')
  async findByQrCode(@Param('qrCode') qrCode: string) {
    return this.service.findByQrCode(qrCode);
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreateCollaboratorSchema)) dto: CreateCollaboratorDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCollaboratorSchema)) dto: UpdateCollaboratorDto,
  ) {
    return this.service.update(id, dto);
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string) {
    return this.service.approve(id);
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string) {
    return this.service.reject(id);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
