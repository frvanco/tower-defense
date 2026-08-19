import type { PublicUser } from '../auth/session.util';

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}
