import { politeGet } from '../politeFetcher.js';
import { toIsoDate, toPlainText } from '../textUtils.js';
import { ExternalJob } from '../types.js';

/**
 * Recruitee's public careers API — no auth: `{company}.recruitee.com/api/
 * offers/` returns every published offer with its description, requirements,
 * publish date and careers-page link. Confirmed live for Windcat (`windcat`,
 * UK offshore-wind crew transfer vessels: Master, Deckhand, Trainee Master).
 */

type RecruiteeOffer = {
  id: number;
  title: string;
  careers_url?: string;
  published_at?: string;
  location?: string;
  department?: string | null;
  description?: string;
  requirements?: string;
  employment_type_code?: string;
  status?: string;
};

type RecruiteeResponse = { offers?: RecruiteeOffer[] };

/** "fulltime_permanent" -> "Fulltime permanent". */
const humanize = (code?: string) =>
  code ? code.charAt(0).toUpperCase() + code.slice(1).replace(/_/g, ' ') : null;

/** Recruitee's timestamps are "2026-09-17 11:38:57 UTC", which Date can't parse as-is. */
const parseRecruiteeDate = (value?: string) =>
  toIsoDate(value?.replace(' UTC', 'Z').replace(' ', 'T'));

export const fetchRecruiteeJobs = async (
  company: string,
  label?: string,
): Promise<ExternalJob[]> => {
  const raw = await politeGet(
    `https://${encodeURIComponent(company)}.recruitee.com/api/offers/`,
    undefined,
    'application/json',
  );
  const offers = (JSON.parse(raw) as RecruiteeResponse).offers ?? [];

  return offers
    .filter(
      (offer) =>
        offer.title &&
        offer.careers_url &&
        (offer.status ?? 'published') === 'published',
    )
    .map((offer) => ({
      id: `recruitee:${company}:${offer.id}`,
      title: offer.title,
      company: label ?? company,
      location: offer.location || null,
      description: toPlainText(
        [offer.description, offer.requirements].filter(Boolean).join('\n'),
      ),
      salary: null,
      postedAt: parseRecruiteeDate(offer.published_at),
      applyLink: offer.careers_url as string,
      via: 'Recruitee',
      thumbnail: null,
      category: offer.department ?? null,
      employmentType: humanize(offer.employment_type_code),
      source: 'external' as const,
      provider: 'recruitee' as const,
    }));
};
