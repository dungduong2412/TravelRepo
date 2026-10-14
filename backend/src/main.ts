import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Increase body size limit for base64 images (10MB images = ~13MB base64)
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ limit: '15mb', extended: true }));

  const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3001')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  // Allow only explicitly configured frontend origins in deployed environments.
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  const port = Number(process.env.PORT) || 3100;
  await app.listen(port);

  console.log(`🚀 Backend API running on http://localhost:${port}`);
}

bootstrap();
