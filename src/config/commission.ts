/**
 * Platform commission on course bookings.
 *
 * Single source of truth. This rate was previously duplicated as bare `0.18`/`0.82`
 * literals across the booking, payout and admin-reporting controllers while the UI
 * advertised a different number, so the platform charged one rate and displayed
 * another. Change it here only; the web app mirrors it in
 * `src/constants/commission.js` for its disclosure copy.
 */
export const COURSE_COMMISSION_RATE_PERCENT = 9.6;

/** Commission as a multiplier, e.g. 0.13. */
export const COURSE_COMMISSION_RATE = COURSE_COMMISSION_RATE_PERCENT / 100;

/** Trainer's share as a multiplier, e.g. 0.87. */
export const TRAINER_PAYOUT_RATE = 1 - COURSE_COMMISSION_RATE;

/**
 * Commission for a booking amount, for use when the booking has no stored
 * `platformFee`. Bookings that already recorded a fee keep it — they were charged
 * at whatever rate applied at the time, and rewriting history would misstate past
 * payouts.
 */
export const commissionFor = (amountPaid: number): number =>
  amountPaid * COURSE_COMMISSION_RATE;

/** Trainer payout for a booking amount, used the same way as `commissionFor`. */
export const payoutFor = (amountPaid: number): number =>
  amountPaid * TRAINER_PAYOUT_RATE;
