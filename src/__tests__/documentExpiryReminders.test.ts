import {
  EXPIRED_STAGE,
  REMINDER_MILESTONES,
  daysUntil,
  formatExpiryDate,
  resolveReminderStage,
} from '../utils/documentExpiry.js';

const NOW = new Date('2026-01-15T09:30:00.000Z');

const inDays = (days: number) =>
  new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);

describe('document expiry reminder milestones', () => {
  describe('daysUntil', () => {
    it('counts whole days ahead', () => {
      expect(daysUntil(inDays(30), NOW)).toBe(30);
      expect(daysUntil(inDays(1), NOW)).toBe(1);
    });

    it('returns negative days once expired', () => {
      expect(daysUntil(inDays(-5), NOW)).toBe(-5);
    });
  });

  describe('resolveReminderStage', () => {
    it('returns null beyond the widest milestone', () => {
      expect(resolveReminderStage(inDays(120), NOW)).toBeNull();
      expect(resolveReminderStage(inDays(91), NOW)).toBeNull();
    });

    /**
     * A document sits in the milestone it most recently crossed: 75 days out
     * it is still in the "90" bucket and moves to "60" only on day 60.
     */
    it('maps each window to the milestone it has crossed', () => {
      expect(resolveReminderStage(inDays(90), NOW)).toBe('90');
      expect(resolveReminderStage(inDays(75), NOW)).toBe('90');
      expect(resolveReminderStage(inDays(61), NOW)).toBe('90');
      expect(resolveReminderStage(inDays(60), NOW)).toBe('60');
      expect(resolveReminderStage(inDays(45), NOW)).toBe('60');
      expect(resolveReminderStage(inDays(31), NOW)).toBe('60');
      expect(resolveReminderStage(inDays(30), NOW)).toBe('30');
      expect(resolveReminderStage(inDays(20), NOW)).toBe('30');
      expect(resolveReminderStage(inDays(8), NOW)).toBe('30');
      expect(resolveReminderStage(inDays(7), NOW)).toBe('7');
      expect(resolveReminderStage(inDays(1), NOW)).toBe('7');
      expect(resolveReminderStage(inDays(0), NOW)).toBe('7');
    });

    it('treats a past expiry date as expired', () => {
      expect(resolveReminderStage(inDays(-1), NOW)).toBe(EXPIRED_STAGE);
      expect(resolveReminderStage(inDays(-400), NOW)).toBe(EXPIRED_STAGE);
    });

    it('only ever reports a stage that exists in the milestone list', () => {
      const valid = new Set<string>([
        ...REMINDER_MILESTONES.map(String),
        EXPIRED_STAGE,
      ]);

      for (let day = -10; day <= 120; day += 1) {
        const stage = resolveReminderStage(inDays(day), NOW);
        if (stage !== null) expect(valid.has(stage)).toBe(true);
      }
    });

    /**
     * The de-duplication contract: walking a document from 120 days out to
     * expiry must produce one reminder per milestone, never one per day.
     */
    it('changes stage exactly once per milestone crossed', () => {
      const expiry = inDays(120);
      const stagesSent: string[] = [];
      let lastStage: string | null = null;

      for (let dayOffset = 0; dayOffset <= 130; dayOffset += 1) {
        const today = new Date(NOW.getTime() + dayOffset * 24 * 60 * 60 * 1000);
        const stage = resolveReminderStage(expiry, today);
        if (stage && stage !== lastStage) {
          stagesSent.push(stage);
          lastStage = stage;
        }
      }

      expect(stagesSent).toEqual(['90', '60', '30', '7', EXPIRED_STAGE]);
    });
  });

  describe('formatExpiryDate', () => {
    it('formats for display in the digest', () => {
      expect(formatExpiryDate(new Date('2026-08-12T00:00:00.000Z'))).toBe(
        '12 Aug 2026',
      );
    });
  });
});
