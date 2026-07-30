/**
 * Pure expiry-milestone rules for the document wallet.
 *
 * Kept free of prisma/email imports so the scheduling logic can be reasoned
 * about (and tested) without touching the database or SMTP.
 */

/**
 * Reminder milestones in days before expiry, widest first. A document is
 * emailed once per milestone it crosses — not once per day — so a certificate
 * expiring in 90 days triggers at most 5 emails over its remaining life.
 */
export const REMINDER_MILESTONES = [90, 60, 30, 7] as const;

/** Widest milestone; also the lookahead window for the daily query. */
export const EXPIRY_LOOKAHEAD_DAYS = REMINDER_MILESTONES[0];

export const EXPIRED_STAGE = 'EXPIRED';

export const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Whole days until expiry; negative once the document has expired. */
export function daysUntil(expiryDate: Date, now: Date): number {
  return Math.ceil((expiryDate.getTime() - now.getTime()) / MS_PER_DAY);
}

/**
 * The milestone a document currently sits in, or null when it is further out
 * than the widest milestone (nothing to send yet).
 */
export function resolveReminderStage(
  expiryDate: Date,
  now: Date,
): string | null {
  const days = daysUntil(expiryDate, now);
  if (days < 0) return EXPIRED_STAGE;

  const milestone = [...REMINDER_MILESTONES]
    .sort((a, b) => a - b)
    .find((m) => days <= m);

  return milestone ? String(milestone) : null;
}

export function formatExpiryDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
