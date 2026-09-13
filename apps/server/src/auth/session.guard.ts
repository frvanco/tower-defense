import { Injectable, CanActivate, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { clearSessionCookie, hashSessionToken, readSessionCookie, toPublicUser } from './session.util';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const token = readSessionCookie(request.cookies);
    if (!token) throw new UnauthorizedException();

    const tokenHash = hashSessionToken(token);
    const session = await this.prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });

    if (!session || session.expiresAt < new Date()) {
      if (session) await this.prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      clearSessionCookie(response);
      throw new UnauthorizedException();
    }

    request.user = toPublicUser(session.user);
    return true;
  }
}
