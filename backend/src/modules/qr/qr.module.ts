import { Module } from '@nestjs/common';
import { QrController } from './qr.controller';
import { CollaboratorsModule } from '../collaborators/collaborators.module';

@Module({
  imports: [CollaboratorsModule],
  controllers: [QrController],
})
export class QrModule {}
