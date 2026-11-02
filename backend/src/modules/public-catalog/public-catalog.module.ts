import { Module } from '@nestjs/common';
import { PublicCatalogController } from './public-catalog.controller';
import { PublicCatalogService } from './public-catalog.service';

@Module({ controllers: [PublicCatalogController], providers: [PublicCatalogService] })
export class PublicCatalogModule {}
