import { Module } from '@nestjs/common';
import { QrController } from './qr.controller';
import { MerchantQrController } from './merchant-qr.controller';
import { QrDiagnosticsController } from './qr-diagnostics.controller';
import { QrService } from './qr.service';
import { CollaboratorsModule } from '../collaborators/collaborators.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [CollaboratorsModule, MediaModule],
  controllers: [QrController, MerchantQrController, QrDiagnosticsController],
  providers: [QrService],
  exports: [QrService],
})
export class QrModule {}
