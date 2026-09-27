import {
  BACKFILL_WINDOW_MS,
  recencyTimestamps,
  UNKNOWN_AGE_ASSUMED_MS,
} from '../services/externalJobs/recency.js';
import { ExternalJob } from '../services/externalJobs/types.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-24T14:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

const job = (
  overrides: Partial<ExternalJob> & { id: string },
): ExternalJob => ({
  title: 'Deck Officer',
  company: null,
  location: null,
  description: '',
  salary: null,
  postedAt: null,
  applyLink: null,
  via: null,
  thumbnail: null,
  category: null,
  employmentType: null,
  source: 'external',
  provider: 'serpapi',
  ...overrides,
});

const newestFirst = (pool: ExternalJob[]) => {
  const recency = recencyTimestamps(pool);
  return [...pool]
    .sort((a, b) => (recency.get(b.id) ?? 0) - (recency.get(a.id) ?? 0))
    .map((j) => j.id);
};

describe('recencyTimestamps', () => {
  it('uses a real posted date whenever there is one', () => {
    const recency = recencyTimestamps([
      job({ id: 'a', postedAt: iso(NOW - 2 * DAY), fetchedAt: iso(NOW) }),
    ]);
    expect(recency.get('a')).toBe(NOW - 2 * DAY);
  });

  it('falls back to last-confirmed for an undated search listing', () => {
    const recency = recencyTimestamps([
      job({
        id: 'a',
        provider: 'serpapi',
        fetchedAt: iso(NOW),
        firstSeenAt: iso(NOW - 20 * DAY),
      }),
    ]);
    expect(recency.get('a')).toBe(NOW);
  });

  it('ranks a company board’s initial backlog below a job posted today', () => {
    // The live case: V.Group's undated board added this afternoon took
    // positions 1-343, above North Star's "Cook - ERRV" posted the same day.
    const vgroupBacklog = Array.from({ length: 3 }, (_, i) =>
      job({
        id: `pinpoint:vgroup:${i}`,
        provider: 'pinpoint',
        fetchedAt: iso(NOW),
        firstSeenAt: iso(NOW - i * 60 * 1000),
      }),
    );
    const postedToday = job({
      id: 'teamtailor:northstarshipping:cook',
      provider: 'teamtailor',
      postedAt: iso(NOW - 4 * 60 * 60 * 1000),
      fetchedAt: iso(NOW),
      firstSeenAt: iso(NOW),
    });

    expect(newestFirst([...vgroupBacklog, postedToday])[0]).toBe(
      'teamtailor:northstarshipping:cook',
    );
    expect(recencyTimestamps(vgroupBacklog).get('pinpoint:vgroup:0')).toBe(
      NOW - UNKNOWN_AGE_ASSUMED_MS,
    );
  });

  it('still ranks the backlog above genuinely old dated listings', () => {
    const order = newestFirst([
      job({ id: 'old', provider: 'lever', postedAt: iso(NOW - 400 * DAY) }),
      job({
        id: 'pinpoint:vgroup:1',
        provider: 'pinpoint',
        firstSeenAt: iso(NOW),
      }),
    ]);
    expect(order).toEqual(['pinpoint:vgroup:1', 'old']);
  });

  it('ranks a posting that appears on a later run by when it appeared', () => {
    // After the first read, a newly listed posting really is that new.
    const backlog = job({
      id: 'pinpoint:vgroup:1',
      provider: 'pinpoint',
      firstSeenAt: iso(NOW - 5 * DAY),
    });
    const appearedToday = job({
      id: 'pinpoint:vgroup:2',
      provider: 'pinpoint',
      firstSeenAt: iso(NOW),
    });

    const recency = recencyTimestamps([backlog, appearedToday]);

    expect(recency.get('pinpoint:vgroup:2')).toBe(NOW);
    expect(recency.get('pinpoint:vgroup:1')).toBe(
      NOW - 5 * DAY - UNKNOWN_AGE_ASSUMED_MS,
    );
  });

  it('judges the backlog per source, not across all company boards', () => {
    // A board added today has its own backlog even if another board has
    // been watched for weeks.
    const recency = recencyTimestamps([
      job({
        id: 'pinpoint:old-board:1',
        provider: 'pinpoint',
        firstSeenAt: iso(NOW - 30 * DAY),
      }),
      job({
        id: 'pinpoint:new-board:1',
        provider: 'pinpoint',
        firstSeenAt: iso(NOW),
      }),
    ]);
    expect(recency.get('pinpoint:new-board:1')).toBe(
      NOW - UNKNOWN_AGE_ASSUMED_MS,
    );
  });

  it('treats postings seen within the window of the first read as backlog', () => {
    const recency = recencyTimestamps([
      job({
        id: 'pinpoint:vgroup:1',
        provider: 'pinpoint',
        firstSeenAt: iso(NOW),
      }),
      job({
        id: 'pinpoint:vgroup:2',
        provider: 'pinpoint',
        firstSeenAt: iso(NOW + BACKFILL_WINDOW_MS - 1),
      }),
      job({
        id: 'pinpoint:vgroup:3',
        provider: 'pinpoint',
        firstSeenAt: iso(NOW + BACKFILL_WINDOW_MS),
      }),
    ]);
    expect(recency.get('pinpoint:vgroup:2')).toBeLessThan(NOW);
    expect(recency.get('pinpoint:vgroup:3')).toBe(NOW + BACKFILL_WINDOW_MS);
  });
});
