import { Request, Response } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

/**
 * Brute-force protection for login, one-time codes and password recovery.
 *
 * Limits are counted per ACCOUNT (the email / account id in the request
 * body), not per IP address, so they can't be dodged by faking an IP header
 * and one busy network (an office, a ship's shared connection) never locks out
 * other people. Requests without an account identifier fall back to the IP.
 *
 * The numbers are generous for real people — e.g. 10 wrong passwords within
 * 15 minutes — and a successful login or code entry does not count. Responses
 * keep the usual `{ status, message }` error shape with HTTP 429.
 */

type KeyField = 'email' | 'professionalId' | 'recruiterId' | 'id';

/**
 * The account a request is about. Each limiter names the fields that identify
 * the targeted account for that endpoint, in order — e.g. code verification
 * uses only the account id, so adding a random `email` to each guess can't
 * open a fresh limit.
 */
const accountKeyFrom = (req: Request, fields: KeyField[]): string | null => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  for (const field of fields) {
    const value = body[field];
    if (typeof value !== 'string' || !value.trim()) continue;
    return field === 'email'
      ? `email:${value.trim().toLowerCase()}`
      : `id:${value.trim()}`;
  }
  return null;
};

const createAuthLimiter = ({
  name,
  windowMinutes,
  limit,
  failuresOnly,
  message,
  keyFields,
  failureStatuses,
}: {
  name: string;
  windowMinutes: number;
  limit: number;
  failuresOnly: boolean;
  message: string;
  keyFields: KeyField[];
  failureStatuses?: number[];
}) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    skipSuccessfulRequests: failuresOnly,
    // What counts as a failed attempt: for sign-in only a wrong email/password
    // (401) — a correct password on an unfinished, unverified or suspended
    // account is not a guess and must not lock the person out.
    requestWasSuccessful: (_req: Request, res: Response) =>
      failureStatuses
        ? !failureStatuses.includes(res.statusCode)
        : res.statusCode < 400,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) =>
      `${name}:${accountKeyFrom(req, keyFields) ?? `ip:${ipKeyGenerator(req.ip ?? '')}`}`,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({ status: 'error', message });
    },
    // Keys are account based (see above), so the proxy/IP checks don't apply.
    validate: { trustProxy: false, xForwardedForHeader: false },
  });

/** Wrong passwords: 10 per 15 minutes per account. */
export const loginLimiter = createAuthLimiter({
  name: 'login',
  keyFields: ['email'],
  failureStatuses: [401],
  windowMinutes: 15,
  limit: 10,
  failuresOnly: true,
  message:
    'Too many unsuccessful sign-in attempts. Please wait 15 minutes and try again, or reset your password.',
});

/** Wrong one-time codes (email or phone): 10 per 15 minutes per account. */
export const otpVerifyLimiter = createAuthLimiter({
  name: 'otp-verify',
  keyFields: ['professionalId', 'recruiterId'],
  windowMinutes: 15,
  limit: 10,
  failuresOnly: true,
  message:
    'Too many incorrect codes. Please wait 15 minutes, then request a new code and try again.',
});

/** New codes sent: 6 per 15 minutes per account. */
export const otpResendLimiter = createAuthLimiter({
  name: 'otp-resend',
  keyFields: ['professionalId', 'recruiterId', 'email'],
  windowMinutes: 15,
  limit: 6,
  failuresOnly: false,
  message:
    'Too many codes requested. Please wait 15 minutes before asking for another code.',
});

/** Password reset emails: 5 per hour per account. */
export const forgotPasswordLimiter = createAuthLimiter({
  name: 'forgot-password',
  keyFields: ['email'],
  windowMinutes: 60,
  limit: 5,
  failuresOnly: false,
  message:
    'Too many password reset requests. Please check your inbox or try again in an hour.',
});

/** Sign-ups (each sends an email): 10 per hour per email address. */
export const registerLimiter = createAuthLimiter({
  name: 'register',
  keyFields: ['email'],
  windowMinutes: 60,
  limit: 10,
  failuresOnly: false,
  message: 'Too many sign-up attempts. Please try again in an hour.',
});
