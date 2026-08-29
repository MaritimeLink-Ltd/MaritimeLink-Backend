/**
 * Deterministic daily rotation over a fixed grid — used to spread a metered
 * provider's queries across many days without persisting any state, just
 * today's date. Shared by every rotated provider (SerpApi, JSearch) so each
 * one's slice picking is identical in shape, only the grid/budget differ.
 */

/** Rotation day 0 — do not change casually, it re-shuffles which slice runs on which day. */
export const ROTATION_START = new Date('2026-08-22T00:00:00Z');

/**
 * Which day of the rotation "today" is, anchored to a fixed date (not the
 * Unix epoch) so day 0 lands on the front of the grid — i.e. the
 * highest-priority entries actually get queried first, rather than wherever
 * an epoch-relative offset happens to fall on a given day.
 */
export const rotationDayIndex = (now: Date = new Date()): number =>
  Math.max(
    0,
    Math.floor(
      (now.getTime() - ROTATION_START.getTime()) / (24 * 60 * 60 * 1000),
    ),
  );

/**
 * Picks today's slice of `grid` — `budget` entries starting after wherever
 * the previous days' slices left off, wrapping around once the grid is
 * exhausted. Pure and stateless: the same (grid, dayIndex, budget) always
 * yields the same slice, so the caller only needs to track today's date.
 */
export const pickRotationSlice = <T>(
  grid: readonly T[],
  dayIndex: number,
  budget: number,
): T[] => {
  if (budget <= 0 || grid.length === 0) return [];

  const offset = (dayIndex * budget) % grid.length;
  return Array.from(
    { length: Math.min(budget, grid.length) },
    (_, i) => grid[(offset + i) % grid.length],
  );
};
