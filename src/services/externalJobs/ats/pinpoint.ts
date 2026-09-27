import { politeGet } from '../politeFetcher.js';
import { toPlainText } from '../textUtils.js';
import { ExternalJob } from '../types.js';

/**
 * Pinpoint's public job-board feed — no auth: `{company}.pinpointhq.com/
 * postings.json` returns every open posting with its full description.
 * Confirmed live for V.Group (`vgroup`): 360 postings, almost all shipboard
 * crew placed with cruise lines and yacht operators.
 *
 * The feed carries no posted date at all (`deadline_at` is the only date
 * field, and it's empty), so `postedAt` stays null — ranking then uses the
 * date the listing was first seen, not a fabricated one (see
 * externalJobs/index.ts's `postedAtMs`).
 */

type PinpointPosting = {
  id: string;
  title: string;
  url: string;
  description?: string;
  key_responsibilities?: string;
  employment_type_text?: string;
  location?: { name?: string; city?: string; province?: string };
  job?: { department?: { name?: string } };
};

type PinpointResponse = { data?: PinpointPosting[] };

export const fetchPinpointJobs = async (
  company: string,
  label?: string,
): Promise<ExternalJob[]> => {
  const raw = await politeGet(
    `https://${encodeURIComponent(company)}.pinpointhq.com/postings.json`,
    undefined,
    'application/json',
  );
  const postings = (JSON.parse(raw) as PinpointResponse).data ?? [];

  return postings
    .filter((posting) => posting.title && posting.url)
    .map((posting) => ({
      id: `pinpoint:${company}:${posting.id}`,
      title: posting.title,
      company: label ?? company,
      // "Shipboard" is V.Group's own location for every sea post — more
      // accurate for a seafarer than the London office it's attached to.
      location: posting.location?.name || posting.location?.city || null,
      description: toPlainText(
        [posting.description, posting.key_responsibilities]
          .filter(Boolean)
          .join('\n'),
      ),
      salary: null,
      postedAt: null,
      applyLink: posting.url,
      via: 'Pinpoint',
      thumbnail: null,
      category: posting.job?.department?.name ?? null,
      employmentType: posting.employment_type_text ?? null,
      source: 'external' as const,
      provider: 'pinpoint' as const,
    }));
};
