import { ExternalJob } from './types.js';

/**
 * Keeps the external feed inside MaritimeLink's domain.
 *
 * General web search will happily return "Chief Engineer" at a software firm
 * or "Steward" at a hotel. Those must not reach the tab, including the
 * unmatched section at the bottom — everything shown should be a job a
 * seafarer could plausibly take.
 */

/** Terms that, on their own, establish a listing as maritime. */
const MARITIME_TERMS = [
  'maritime',
  'marine',
  'seafarer',
  'seaman',
  'seamen',
  'mariner',
  'vessel',
  'ship',
  'ships',
  'shipping',
  'shipboard',
  'shipyard',
  'offshore',
  'onboard',
  'on board',
  'tanker',
  'bulk carrier',
  'container ship',
  'cargo',
  'freight',
  'port',
  'harbour',
  'harbor',
  'dock',
  'dredging',
  'yacht',
  'cruise',
  'ferry',
  'tugboat',
  'tug',
  'barge',
  'boat',
  'naval',
  'navy',
  'nautical',
  'sailing',
  'crewing',
  'deckhand',
  'deck officer',
  'deck rating',
  'engine room',
  'chief mate',
  'chief officer',
  'able seaman',
  'bosun',
  'oiler',
  'wiper',
  'stcw',
  'imo',
  'coast guard',
  'drilling rig',
  'subsea',
  'diver',
  'diving',
];

const boundaryPattern = (term: string) =>
  new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i');

const MARITIME_PATTERNS = MARITIME_TERMS.map(boundaryPattern);

const hasMaritimeSignal = (text: string) =>
  MARITIME_PATTERNS.some((pattern) => pattern.test(text));

/**
 * True when a listing belongs in the maritime feed.
 *
 * Feed-sourced rows come from maritime job boards, so they are in scope by
 * origin. Search-engine rows must show a maritime signal in their own text.
 */
export const isInMaritimeScope = (job: ExternalJob): boolean => {
  if (job.provider === 'feed') return true;

  return hasMaritimeSignal(
    [job.title, job.category, job.company, job.location, job.description]
      .filter(Boolean)
      .join(' '),
  );
};
