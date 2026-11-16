import crypto from 'node:crypto';

/** 6-digit one-time code from a cryptographically secure source. */
export const generateOtpCode = (): string =>
  crypto.randomInt(100000, 1000000).toString();

/**
 * True when `code` looks like a code a person typed (digits only). Anything
 * else — missing, an object such as `{ "not": "" }`, an array — must be
 * rejected before it reaches a Prisma `where`, where an undefined/object value
 * would turn "code equals X" into "any code".
 */
export const isOtpCodeFormat = (code: unknown): code is string =>
  typeof code === 'string' && /^\d{4,10}$/.test(code);
