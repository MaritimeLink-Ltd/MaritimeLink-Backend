import { ExternalJob } from './types.js';

/** Same vacancy can surface from several sources; prefer the richer record. */
export const dedupeJobs = (jobs: ExternalJob[]): ExternalJob[] => {
  const byKey = new Map<string, ExternalJob>();

  for (const job of jobs) {
    const key = `${job.title.toLowerCase().trim()}|${(job.company ?? '')
      .toLowerCase()
      .trim()}|${(job.location ?? '').toLowerCase().trim()}`;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, job);
      continue;
    }

    const isRicher =
      Number(Boolean(job.applyLink)) + Number(Boolean(job.description)) >
      Number(Boolean(existing.applyLink)) +
        Number(Boolean(existing.description));
    if (isRicher) byKey.set(key, job);
  }

  return [...byKey.values()];
};
