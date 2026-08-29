import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { env } from '../../config/env.js';
import { politeGet } from './politeFetcher.js';
import { ExternalJob } from './types.js';

/**
 * In-house job source: reads the RSS/Atom feeds that maritime job boards
 * publish for syndication, rather than depending solely on SerpApi.
 *
 * Feeds are the sanctioned machine-readable surface of these sites — no HTML
 * scraping, and every request goes through `politeGet` (robots.txt, throttling,
 * identifying user-agent). Add or replace feeds with EXTERNAL_JOB_FEEDS.
 */

type FeedConfig = { url: string; label: string };

const DEFAULT_FEEDS: FeedConfig[] = [
  {
    // Documented query params: take (count), types 6003/6004/6005, Description (chars).
    url: 'https://www.maritimejobs.com/rss/?take=100&types=6003,6004,6005&Description=600',
    label: 'MaritimeJobs',
  },
  {
    // RDF format (rdf:RDF/item) — parseFeed already handles this shape.
    // robots.txt has no AI-crawler-specific restrictions and its wildcard
    // group doesn't block /rss or /job/*.
    url: 'https://maritime-union.com/rss/all',
    label: 'MaritimeUnion',
  },
];

const hostLabel = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'External feed';
  }
};

/** EXTERNAL_JOB_FEEDS is a comma-separated list of feed URLs. */
const resolveFeeds = (): FeedConfig[] => {
  const configured = String(env.EXTERNAL_JOB_FEEDS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (configured.length === 0) return DEFAULT_FEEDS;
  return configured.map((url) => ({ url, label: hostLabel(url) }));
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

const toArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

/** Feed text is often escaped HTML; reduce it to readable plain text. */
const toPlainText = (value: unknown): string => {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/** Atom links are attribute-bearing objects; RSS links are plain strings. */
const extractLink = (item: Record<string, unknown>): string | null => {
  const raw = item.link ?? item.url ?? item.guid;

  for (const candidate of toArray(raw as unknown)) {
    if (typeof candidate === 'string' && candidate.startsWith('http')) {
      return candidate;
    }
    if (candidate && typeof candidate === 'object') {
      const href = (candidate as Record<string, unknown>)['@_href'];
      if (typeof href === 'string' && href.startsWith('http')) return href;
      const text = (candidate as Record<string, unknown>)['#text'];
      if (typeof text === 'string' && text.startsWith('http')) return text;
    }
  }
  return null;
};

const firstString = (
  item: Record<string, unknown>,
  keys: string[],
): string | null => {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
};

const toIsoDate = (value: string | null): string | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const normalizeItem = (
  item: Record<string, unknown>,
  label: string,
): ExternalJob | null => {
  const title = toPlainText(firstString(item, ['title', 'job:title']) ?? '');
  const link = extractLink(item);
  if (!title || !link) return null;

  const description = toPlainText(
    firstString(item, [
      'description',
      'summary',
      'content',
      'content:encoded',
    ]) ?? '',
  );

  return {
    // Stable across refreshes so the frontend can key on it.
    id: `feed:${crypto.createHash('sha1').update(link).digest('hex')}`,
    title,
    company:
      firstString(item, ['job:company', 'company', 'dc:creator', 'author']) ??
      null,
    location:
      firstString(item, ['job:location', 'location', 'Location']) ?? null,
    description,
    salary: firstString(item, ['job:salary', 'salary', 'Salary']),
    postedAt: toIsoDate(firstString(item, ['pubDate', 'published', 'updated'])),
    applyLink: link,
    via: label,
    thumbnail: null,
    category: firstString(item, ['Category', 'category', 'job:category']),
    employmentType: firstString(item, ['Type', 'job:type', 'employmentType']),
    source: 'external',
    provider: 'feed',
  };
};

const parseFeed = (xml: string, label: string): ExternalJob[] => {
  const parsed = parser.parse(xml) as Record<string, unknown>;

  const dig = (...path: string[]): unknown =>
    path.reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[key]
          : undefined,
      parsed,
    );

  const rssItems = toArray(dig('rss', 'channel', 'item'));
  const rdfItems = toArray(dig('rdf:RDF', 'item'));
  const atomEntries = toArray(dig('feed', 'entry'));

  return [...rssItems, ...rdfItems, ...atomEntries]
    .map((item) => normalizeItem(item as Record<string, unknown>, label))
    .filter((job): job is ExternalJob => job !== null);
};

/**
 * Fetches every configured feed. A failing feed is logged and skipped so one
 * bad source never takes down the tab.
 */
export const fetchFeedJobs = async (): Promise<ExternalJob[]> => {
  const feeds = resolveFeeds();

  const results = await Promise.all(
    feeds.map(async (feed) => {
      try {
        const xml = await politeGet(feed.url);
        return parseFeed(xml, feed.label);
      } catch (error) {
        console.error(
          `External job feed failed (${feed.url}):`,
          error instanceof Error ? error.message : error,
        );
        return [];
      }
    }),
  );

  return results.flat();
};
