import crypto from 'crypto';
import { prisma } from '../config/prisma.js';

/**
 * Short share URLs. Profile and document-pack shares are signed JWTs, which
 * made the URL several hundred characters long — unreadable when pasted into
 * an email. The JWT is now stored behind a short random code and the URL
 * carries only the code; the JWT still does all the validation, so what a
 * link exposes and when it expires is unchanged.
 */

/** No look-alike characters (0/O, 1/l/I), so a code survives being read aloud or retyped. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** 12 characters of a 57-letter alphabet ≈ 70 bits: not guessable. */
export const SHARE_CODE_LENGTH = 12;

const randomCode = (): string => {
  const bytes = crypto.randomBytes(SHARE_CODE_LENGTH * 2);
  let code = '';
  // Rejection sampling keeps every character equally likely.
  for (const byte of bytes) {
    if (byte < 256 - (256 % ALPHABET.length))
      code += ALPHABET[byte % ALPHABET.length];
    if (code.length === SHARE_CODE_LENGTH) return code;
  }
  return code + randomCode().slice(code.length);
};

/** Stores a signed share token and returns the short code that stands in for it. */
export const createShareCode = async ({
  professionalId,
  token,
  expiresAt,
}: {
  professionalId: string;
  token: string;
  expiresAt: Date;
}): Promise<string> => {
  // Housekeeping: this professional's expired links can't be opened any more.
  await prisma.shareLink.deleteMany({
    where: { professionalId, expiresAt: { lt: new Date() } },
  });

  const code = randomCode();
  await prisma.shareLink.create({
    data: { code, token, professionalId, expiresAt },
  });
  return code;
};

/**
 * The signed token behind a share URL segment. Links issued before short
 * codes carried the JWT itself (it always contains dots), so those still open.
 * Returns null for an unknown code; expiry is left to the JWT check.
 */
export const resolveShareToken = async (
  segment: string,
): Promise<string | null> => {
  if (segment.includes('.')) return segment;
  if (segment.length !== SHARE_CODE_LENGTH) return null;
  const link = await prisma.shareLink.findUnique({
    where: { code: segment },
    select: { token: true },
  });
  return link?.token ?? null;
};
