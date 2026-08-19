import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.setGlobalPrefix('api');
  // Sans ca, derriere un reverse proxy en production, req.ip vaudrait toujours
  // l'IP du proxy pour toutes les requetes : le rate limiting par IP (voir
  // ThrottlerModule) bloquerait alors tout le monde des qu'une seule personne
  // atteint la limite.
  app.set('trust proxy', 1);
  await app.listen(3000);
}

bootstrap();
