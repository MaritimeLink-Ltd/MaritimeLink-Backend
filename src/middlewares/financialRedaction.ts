import { Response, NextFunction } from 'express';
import { CustomRequest } from '../types/index.js';

/**
 * Response fields that describe money: what was paid, platform commission,
 * trainer payouts, revenue totals and the Stripe ids behind them. Catalog
 * prices (course `price`) are not included — they are public information.
 */
export const FINANCIAL_RESPONSE_KEYS = new Set([
  'amountPaid',
  'platformFee',
  'trainerPayout',
  'stripePaymentIntentId',
  'stripeSessionId',
  'stripeAccountId',
  'stripePriceId',
  'stripeProductId',
  'grossRevenue',
  'payoutRevenue',
  'revenue',
  'totalRevenue',
  'commission',
  'commissionRevenue',
]);

/** Roles that run operations but may not see money. */
export const isFinanciallyRestrictedRole = (role?: string | null): boolean =>
  role === 'OPERATIONS_MANAGER';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Copy of `value` without money fields (copies only what changes). */
export const stripFinancialFields = (value: unknown, depth = 0): unknown => {
  if (depth > 40) return value;
  if (Array.isArray(value)) {
    let changed = false;
    const copy = value.map((item) => {
      const next = stripFinancialFields(item, depth + 1);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? copy : value;
  }
  if (isPlainObject(value)) {
    let changed = false;
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (FINANCIAL_RESPONSE_KEYS.has(key)) {
        changed = true;
        continue;
      }
      const next = stripFinancialFields(value[key], depth + 1);
      if (next !== value[key]) changed = true;
      copy[key] = next;
    }
    return changed ? copy : value;
  }
  return value;
};

/**
 * For admins whose role may not see money, removes money fields from every
 * JSON response of the routes it is mounted on (use after the auth
 * middleware that sets req.user). Everyone else is unaffected.
 */
export const redactFinancialsForRestrictedAdmins = (
  req: CustomRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!isFinanciallyRestrictedRole(req.user?.role)) return next();
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) =>
    originalJson(stripFinancialFields(body))) as Response['json'];
  next();
};
