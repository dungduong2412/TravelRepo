import { Module } from '@nestjs/common';
import { QrController } from './qr.controller';
import { MerchantQrController } from './merchant-qr.controller';
import { CollaboratorsModule } from '../collaborators/collaborators.module';

@Module({
  imports: [CollaboratorsModule],
  controllers: [QrController, MerchantQrController],
})
export class QrModule {}
