import { randomBytes, createHash } from 'node:crypto';
import type { Response } from 'express';
import type { User } from '@prisma/client';

export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'td_session';

export interface PublicUser {
  id: string;
  pseudo: string;
  joinNumber: number;
  isGuest: boolean;
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, pseudo: user.pseudo, joinNumber: user.joinNumber, isGuest: user.isGuest };
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function readSessionCookie(cookies: Record<string, string | undefined> | undefined): string | undefined {
  return cookies?.[COOKIE_NAME];
}
