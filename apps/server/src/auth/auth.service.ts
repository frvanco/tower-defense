import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from './password.util';
import {
  SESSION_TTL_MS,
  clearSessionCookie,
  generateSessionToken,
  hashSessionToken,
  setSessionCookie,
  toPublicUser,
  type PublicUser,
} from './session.util';

const GENERIC_LOGIN_ERROR = 'Invalid email or password';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  private async openSession(userId: string, res: Response): Promise<void> {
    const token = generateSessionToken();
    await this.prisma.session.create({
      data: {
        tokenHash: hashSessionToken(token),
        userId,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    setSessionCookie(res, token);
  }

  async guest(pseudo: string, res: Response): Promise<PublicUser> {
    const user = await this.prisma.user.create({ data: { pseudo, isGuest: true } });
    await this.openSession(user.id, res);
    return toPublicUser(user);
  }

  async login(email: string, password: string, res: Response): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }
    await this.openSession(user.id, res);
    return toPublicUser(user);
  }

  async claim(current: PublicUser, email: string, password: string): Promise<PublicUser> {
    const existing = await this.prisma.user.findUnique({ where: { id: current.id } });
    if (existing?.email) throw new ConflictException('account already has an email');

    const passwordHash = await hashPassword(password);
    try {
      const updated = await this.prisma.user.update({
        where: { id: current.id },
        data: { email, passwordHash, isGuest: false },
      });
      return toPublicUser(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('email already in use');
      }
      throw err;
    }
  }

  async logout(token: string, res: Response): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
    clearSessionCookie(res);
  }

  me(current: PublicUser): PublicUser {
    return current;
  }
}
