import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PostgresUuidSchema } from '../../common/validation/postgres-uuid';
import { PublicCatalogService } from './public-catalog.service';

const MediaQuerySchema = z.object({ size: z.enum(['thumb', 'card', 'hero', 'original']).default('card') });
const ListQuerySchema = z.object({
  category: PostgresUuidSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  page_size: z.coerce.number().int().min(1).max(60).default(24),
});

// Anonymous, read-only. No JwtGuard on purpose: every response goes through the allow-list projection.
@Controller('public')
export class PublicCatalogController {
  constructor(private readonly service: PublicCatalogService) {}

  @Get('categories')
  @Header('Cache-Control', 'public, max-age=60')
  categories() { return this.service.categories(); }

  @Get('merchants')
  @Header('Cache-Control', 'public, max-age=30')
  list(@Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>) { return this.service.list(query); }

  @Get('merchants/:id')
  @Header('Cache-Control', 'public, max-age=30')
  detail(@Param('id') id: string) { return this.service.detail(id); }

  @Get('media/:assetId')
  async media(@Param('assetId') assetId: string, @Query(new ZodValidationPipe(MediaQuerySchema)) query: z.infer<typeof MediaQuerySchema>, @Res() res: Response) {
    const url = await this.service.signedMediaUrl(assetId, query.size);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.redirect(302, url);
  }
}
