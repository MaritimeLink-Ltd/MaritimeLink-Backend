import { XMLParser } from 'fast-xml-parser';
import { politeGet } from '../politeFetcher.js';
import { toIsoDate, toPlainText } from '../textUtils.js';
import { ExternalJob } from '../types.js';

/**
 * Teamtailor's public per-company RSS feed — no auth: `{company}.teamtailor
 * .com/jobs.rss`. Confirmed live for North Star Shipping (`northstarshipping`,
 * UK ERRV crew out of Aberdeen) and Stena (`stena`). Every item carries a
 * real publish date, full description and the company's own job-page link.
 */

type TeamtailorLocation = { 'tt:city'?: string; 'tt:country'?: string };

type TeamtailorItem = {
  title?: string;
  description?: string;
  pubDate?: string;
  link?: string;
  guid?: string | { '#text'?: string };
  'tt:locations'?: {
    'tt:location'?: TeamtailorLocation | TeamtailorLocation[];
  };
  'tt:department'?: string;
};

const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const locationOf = (item: TeamtailorItem): string | null => {
  const places = asArray(item['tt:locations']?.['tt:location'])
    .map((place) =>
      [place['tt:city'], place['tt:country']].filter(Boolean).join(', '),
    )
    .filter(Boolean);
  return places.length ? [...new Set(places)].join(' / ') : null;
};

export const fetchTeamtailorJobs = async (
  company: string,
  label?: string,
): Promise<ExternalJob[]> => {
  const xml = await politeGet(
    `https://${encodeURIComponent(company)}.teamtailor.com/jobs.rss`,
  );
  const parsed = parser.parse(xml) as {
    rss?: {
      channel?: { title?: string; item?: TeamtailorItem | TeamtailorItem[] };
    };
  };
  const channel = parsed.rss?.channel;

  return asArray(channel?.item)
    .filter((item) => item.title && item.link)
    .map((item) => {
      const guid =
        typeof item.guid === 'object' ? item.guid['#text'] : item.guid;
      return {
        id: `teamtailor:${company}:${guid ?? item.link}`,
        title: String(item.title),
        company: label ?? channel?.title ?? company,
        location: locationOf(item),
        description: toPlainText(item.description ?? ''),
        salary: null,
        postedAt: toIsoDate(item.pubDate),
        applyLink: String(item.link),
        via: 'Teamtailor',
        thumbnail: null,
        category: item['tt:department'] || null,
        employmentType: null,
        source: 'external' as const,
        provider: 'teamtailor' as const,
      };
    });
};
