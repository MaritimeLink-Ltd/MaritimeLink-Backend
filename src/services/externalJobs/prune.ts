import { ExternalJob } from './types.js';

/**
 * Providers re-fetched in full on every run — free, unmetered endpoints, so
 * there's no rotation and nothing lost by re-reading the whole source every
 * time. A listing missing from today's full re-fetch is a genuine "no longer
 * listed" signal — but only for a source that actually answered this run.
 */
export const FULL_REFRESH_PROVIDERS = [
  'feed',
  'greenhouse',
  'lever',
  'smartrecruiters',
  'workday',
  'pinpoint',
  'teamtailor',
  'recruitee',
] as const;

export const isFullRefreshProvider = (provider: string): boolean =>
  (FULL_REFRESH_PROVIDERS as readonly string[]).includes(provider);

/**
 * The individual source a full-refresh listing came from, as its id prefix:
 * `lever:csmcy`, `workday:Svitzer`, ... Feed ids carry no per-feed segment
 * (`feed:<hash>`), so all feeds count as one source.
 */
export const fullRefreshSourceOf = (id: string): string => {
  const [provider, company] = id.split(':');
  return provider === 'feed' || company === undefined
    ? provider
    : `${provider}:${company}`;
};

/**
 * The id prefixes whose stale listings this run may prune: only the sources
 * that returned at least one listing (in scope or not).
 *
 * Pruning every full-refresh provider unconditionally — the first version —
 * treated "fetched nothing" the same as "company closed every posting".
 * Observed: all ~265 Lever/Workday listings had been deleted between two
 * local runs — the signature of a run with no ATS config (the production
 * cron's environment doesn't carry ATS_LEVER_COMPANIES /
 * ATS_WORKDAY_CAREER_SITES), which fetches zero company listings and so
 * prunes every one. An outage or a failing board would do the same. A source
 * that answers with nothing keeps its rows until it answers again.
 */
export const prunablePrefixes = (fetchedThisRun: ExternalJob[]): string[] => [
  ...new Set(
    fetchedThisRun
      .filter((job) => isFullRefreshProvider(job.provider))
      .map((job) => `${fullRefreshSourceOf(job.id)}:`),
  ),
];
