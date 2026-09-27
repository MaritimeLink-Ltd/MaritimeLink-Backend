import { fullRefreshSourceOf, isFullRefreshProvider } from './prune.js';
import { ExternalJob } from './types.js';

/**
 * How "new" each listing is, for newest-first ranking. Pure — takes the
 * whole pool because one rule below depends on the rest of a listing's
 * source.
 *
 * 1. A real `postedAt` always wins.
 * 2. Search listings without one (SerpApi/JSearch — common for
 *    Kenya/South Africa/Egypt) fall back to `fetchedAt`, the last time the
 *    rotation confirmed them live. Treating a missing date as epoch buried
 *    every undated listing permanently, regardless of how recently it was
 *    confirmed.
 * 3. Company-board listings without one fall back to when they were first
 *    seen. These boards are re-read in full daily, so `fetchedAt` is always
 *    today — an undated one would otherwise rank as the newest job on the
 *    platform every day, forever.
 * 4. Except a source's initial backlog: postings present the first time we
 *    read a board have an unknown age — first-seen says when *we* arrived,
 *    not when they were posted. Measured live when V.Group's undated
 *    Pinpoint board was added: all 343 of its postings took positions 1-343,
 *    above a North Star "Cook - ERRV" posted that same day. The backlog is
 *    assumed UNKNOWN_AGE_ASSUMED_MS old instead; postings that appear on a
 *    later run genuinely are that new and rank by first-seen.
 */

/** Postings first seen within this long of a source's earliest are its initial backlog. */
export const BACKFILL_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Assumed age of a backlog posting with no date — ranks it below this
 * month's genuinely fresh jobs but above old dated ones, roughly where an
 * open posting of unknown age belongs.
 */
export const UNKNOWN_AGE_ASSUMED_MS = 30 * 24 * 60 * 60 * 1000;

const parseMs = (value?: string | null): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

/** Recency timestamp (ms) per listing id — higher is newer. */
export const recencyTimestamps = (pool: ExternalJob[]): Map<string, number> => {
  const earliestSeenBySource = new Map<string, number>();
  for (const job of pool) {
    const seen = parseMs(job.firstSeenAt);
    if (!isFullRefreshProvider(job.provider) || seen === null) continue;
    const source = fullRefreshSourceOf(job.id);
    earliestSeenBySource.set(
      source,
      Math.min(earliestSeenBySource.get(source) ?? seen, seen),
    );
  }

  const recency = new Map<string, number>();
  for (const job of pool) {
    const posted = parseMs(job.postedAt);
    if (posted !== null) {
      recency.set(job.id, posted);
      continue;
    }
    if (!isFullRefreshProvider(job.provider)) {
      recency.set(job.id, parseMs(job.fetchedAt) ?? 0);
      continue;
    }
    const seen = parseMs(job.firstSeenAt);
    if (seen === null) {
      recency.set(job.id, 0);
      continue;
    }
    const earliest =
      earliestSeenBySource.get(fullRefreshSourceOf(job.id)) ?? seen;
    const isBacklog = seen - earliest < BACKFILL_WINDOW_MS;
    recency.set(job.id, isBacklog ? seen - UNKNOWN_AGE_ASSUMED_MS : seen);
  }
  return recency;
};
