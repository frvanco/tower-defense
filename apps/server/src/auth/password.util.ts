import * as bcrypt from 'bcrypt';

const BCRYPT_COST = 12;

// argon2 ships native bindings that don't always have a build toolchain
// available; fall back to bcrypt (explicitly allowed by the spec) when the
// native module fails to load instead of hard-requiring it.
let argon2: typeof import('argon2') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  argon2 = require('argon2');
} catch {
  argon2 = null;
}

export async function hashPassword(password: string): Promise<string> {
  if (argon2) return argon2.hash(password, { type: argon2.argon2id });
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (argon2 && hash.startsWith('$argon2')) return argon2.verify(hash, password);
  if (hash.startsWith('$2')) return bcrypt.compare(password, hash);
  return false;
}
