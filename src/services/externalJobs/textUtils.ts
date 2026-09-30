/** Shared normalization helpers for every external-jobs source. */

/** Source text is often escaped HTML; reduce it to readable plain text. */
export const toPlainText = (value: unknown): string => {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const toIsoDate = (
  value: string | number | null | undefined,
): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const UNIT_MS: Record<string, number> = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

/**
 * Turns a provider's relative "posted" text into a real date, anchored on
 * when it was read. Google Jobs only ever says "3 days ago" / "30+ days
 * ago" / "1 month ago"; stored as-is, that text froze — a listing saved as
 * "3 days ago" still said so three weeks later, so nothing (the ranking,
 * the age limit, the UI) could tell how old it really was.
 *
 * Returns an ISO string, or null for text it can't read. Already-absolute
 * dates pass through.
 */
export const relativeToIso = (
  value: string | null | undefined,
  readAt: Date,
): string | null => {
  if (!value) return null;
  const text = value.trim().toLowerCase();

  if (/^(just posted|today|just now)$/.test(text)) return readAt.toISOString();
  if (text === 'yesterday') {
    return new Date(readAt.getTime() - UNIT_MS.day).toISOString();
  }

  const match = text.match(
    /^(\d+)(\+?)\s*(minute|hour|day|week|month)s?\s+ago$/,
  );
  if (match) {
    // "30+ days ago" means MORE than 30: count it as 31, or a listing that
    // old would pass the 30-day limit every time it's re-found (expiry.ts).
    const units = Number(match[1]) + (match[2] ? 1 : 0);
    const amount = units * UNIT_MS[match[3]];
    return new Date(readAt.getTime() - amount).toISOString();
  }

  return /\d{4}-\d{2}-\d{2}/.test(text) ? toIsoDate(value) : null;
};
