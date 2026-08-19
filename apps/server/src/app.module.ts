import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard, seconds } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // Limite par defaut permissive (n'importe quel endpoint sans @Throttle
    // dedie) ; les routes /api/auth/* sensibles la resserrent explicitement
    // (voir auth.controller.ts). setHeaders:false : les en-tetes
    // X-RateLimit-*/Retry-After reveleraient la limite exacte et le temps
    // restant, ce qu'on veut eviter cote client.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: seconds(60), limit: 60 }],
      setHeaders: false,
    }),
    PrismaModule,
    AuthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
