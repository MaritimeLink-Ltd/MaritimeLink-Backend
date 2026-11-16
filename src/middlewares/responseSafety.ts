import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import {
  collectStorageUrls,
  isStorageUrlSigningEnabled,
  parseStorageUrl,
  replaceStrings,
  signStorageUrls,
  toCanonicalStorageUrl,
} from '../services/storageUrlService.js';

/**
 * Account secrets that must never leave the server, whatever query loaded the
 * row (e.g. a handler that spreads a whole Professional record). No client
 * reads any of these, so dropping them changes nothing visible.
 */
export const SECRET_RESPONSE_KEYS = new Set([
  'password',
  'otpCode',
  'otpExpiresAt',
  'phoneOtpCode',
  'phoneOtpExpiresAt',
  'passwordResetToken',
  'passwordResetExpires',
  'tokenHash',
]);

/** Signing must never hold a response up for long; past this, send it as is. */
const SIGNING_TIMEOUT_MS = 2000;

const ADMIN_ROLES = new Set([
  'SUPER_ADMIN',
  'ADMIN',
  'MODERATOR',
  'OPERATIONS_MANAGER',
]);

const UUID_IN_PATH =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Copy of `value` without secret keys (copies only the parts that change). */
export const stripSecretFields = (value: unknown, depth = 0): unknown => {
  if (depth > 40) return value;
  if (Array.isArray(value)) {
    let changed = false;
    const copy = value.map((item) => {
      const next = stripSecretFields(item, depth + 1);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? copy : value;
  }
  if (isPlainObject(value)) {
    let changed = false;
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (SECRET_RESPONSE_KEYS.has(key)) {
        changed = true;
        continue;
      }
      const next = stripSecretFields(value[key], depth + 1);
      if (next !== value[key]) changed = true;
      copy[key] = next;
    }
    return changed ? copy : value;
  }
  return value;
};

/** Account id (and role) from a valid session token, if the request has one. */
const sessionFrom = (req: Request): { id: string; role?: string } | null => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  try {
    const decoded = jwt.verify(header.slice(7).trim(), env.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as { id?: unknown; role?: unknown };
    if (typeof decoded?.id !== 'string') return null;
    return {
      id: decoded.id,
      role: typeof decoded.role === 'string' ? decoded.role : undefined,
    };
  } catch {
    return null;
  }
};

/**
 * Every stored file path is either `<ownerId>/…`, `<prefix>/<ownerId>-…`,
 * `<prefix>/<ownerId>/…` or carries no account id at all. A file link sent IN
 * a request may only point at the sender's own files — otherwise someone who
 * once saw another user's file link could save it into their own record and
 * keep receiving fresh signed links to it.
 */
export const storagePathBelongsTo = (
  path: string,
  allowedOwnerIds: Set<string>,
): boolean => {
  const ids = path.match(UUID_IN_PATH);
  if (!ids || ids.length === 0) return true;
  return ids.some((id) => allowedOwnerIds.has(id.toLowerCase()));
};

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(null))
      .finally(() => clearTimeout(timer));
  });

/**
 * 1. Request: a signed file link the client received earlier (e.g. the CV
 *    link from an upload, passed to "apply") is turned back into the stored
 *    form before any handler sees it, so the database keeps storing the same
 *    values as before. A link to someone else's file is refused.
 * 2. Response: strips account secrets and swaps stored file links for signed,
 *    expiring links (see storageUrlService).
 */
export const responseSafety = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (req.body && typeof req.body === 'object') {
    const session = sessionFrom(req);
    const isAdmin = !!session?.role && ADMIN_ROLES.has(session.role);
    // With a session, only the session's own account counts. Without one
    // (signup wizard), the account the step is for.
    const body = req.body as Record<string, unknown>;
    const allowedOwnerIds = new Set(
      (session ? [session.id] : [body.professionalId, body.recruiterId])
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.toLowerCase()),
    );

    let foreignFileLink = false;
    req.body = replaceStrings(req.body, (s) => {
      const ref = parseStorageUrl(s);
      if (!ref) return undefined;
      if (!isAdmin && !storagePathBelongsTo(ref.path, allowedOwnerIds)) {
        foreignFileLink = true;
      }
      return toCanonicalStorageUrl(s);
    });
    if (foreignFileLink) {
      return next(
        new AppError(
          'One of the file links in this request belongs to another account.',
          400,
        ),
      );
    }
  }

  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    const safeBody = stripSecretFields(body);

    if (!isStorageUrlSigningEnabled()) {
      return originalJson(safeBody);
    }

    const urls = collectStorageUrls(safeBody);
    if (urls.size === 0) {
      return originalJson(safeBody);
    }

    withTimeout(signStorageUrls(urls), SIGNING_TIMEOUT_MS).then((signed) => {
      if (res.headersSent) return;
      originalJson(
        signed ? replaceStrings(safeBody, (s) => signed.get(s)) : safeBody,
      );
    });
    return res;
  }) as Response['json'];

  next();
};
