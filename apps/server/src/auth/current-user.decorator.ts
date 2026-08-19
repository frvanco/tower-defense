import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { PublicUser } from './session.util';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): PublicUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user as PublicUser;
});
