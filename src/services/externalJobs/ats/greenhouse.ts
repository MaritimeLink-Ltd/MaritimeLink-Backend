import { politeGet } from '../politeFetcher.js';
import { toIsoDate, toPlainText } from '../textUtils.js';
import { ExternalJob } from '../types.js';

/**
 * Greenhouse's public job board API — no auth, no rate-limit key, documented
 * at developers.greenhouse.io/job-board.html. `board_token` is the slug in a
 * company's own Greenhouse URL (job-boards.greenhouse.io/{board_token}).
 */

type GreenhouseJob = {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  location?: { name?: string };
  content?: string;
  departments?: { name?: string }[];
};

type GreenhouseResponse = { jobs?: GreenhouseJob[] };

export const fetchGreenhouseJobs = async (
  boardToken: string,
  label?: string,
): Promise<ExternalJob[]> => {
  const raw = await politeGet(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs`,
    { content: 'true' },
    'application/json',
  );
  const parsed = JSON.parse(raw) as GreenhouseResponse;
  const jobs = parsed.jobs ?? [];

  return jobs.map((job) => ({
    id: `greenhouse:${boardToken}:${job.id}`,
    title: job.title,
    company: label ?? boardToken,
    location: job.location?.name ?? null,
    description: toPlainText(job.content ?? ''),
    salary: null,
    postedAt: toIsoDate(job.updated_at),
    applyLink: job.absolute_url,
    via: 'Greenhouse',
    thumbnail: null,
    category: job.departments?.[0]?.name ?? null,
    employmentType: null,
    source: 'external',
    provider: 'greenhouse',
  }));
};
