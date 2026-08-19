import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { GuestDto } from './dto/guest.dto';
import { LoginDto } from './dto/login.dto';
import { ClaimDto } from './dto/claim.dto';
import { SessionGuard } from './session.guard';
import { CurrentUser } from './current-user.decorator';
import { readSessionCookie, type PublicUser } from './session.util';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('guest')
  guest(@Body() body: GuestDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.guest(body.pseudo, res);
  }

  @Post('login')
  login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(body.email, body.password, res);
  }

  @UseGuards(SessionGuard)
  @Post('claim')
  claim(@Body() body: ClaimDto, @CurrentUser() user: PublicUser) {
    return this.auth.claim(user, body.email, body.password);
  }

  @UseGuards(SessionGuard)
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readSessionCookie(req.cookies);
    if (token) await this.auth.logout(token, res);
  }

  @UseGuards(SessionGuard)
  @Get('me')
  me(@CurrentUser() user: PublicUser) {
    return this.auth.me(user);
  }
}
