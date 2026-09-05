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
  // Certificated ranks the ROLE_TERMS searches ask for by name. Each is a
  // marine rank in ordinary usage — "Second Engineer" is a ticket, whereas a
  // shore-side equivalent would read "Engineer II" — so none of them let
  // general engineering or hospitality listings through.
  'second officer',
  'third officer',
  'second mate',
  'third mate',
  'second engineer',
  'third engineer',
  'fourth engineer',
  'able seaman',
  'able bodied seaman',
  'ordinary seaman',
  'bosun',
  'oiler',
  'wiper',
  // Ratings and catering ranks the ROLE_TERMS searches target directly (see
  // refresh.ts). Each is maritime-only in ordinary usage, unlike the ranks
  // deliberately left out — a bare "steward" or "cook" also describes hotel
  // and shop-floor work, so those still have to earn their place through
  // another term in the listing.
  'messman',
  'motorman',
  'merchant navy',
  'seagoing',
  'deck cadet',
  'engine cadet',
  // The 3 ROLE_TERMS added when the 3rd SerpApi key widened the daily
  // budget (queryGrid.ts). "electro-technical officer" is specific enough on
  // its own; "superyacht" needs its own entry because it's one word, so the
  // "yacht" pattern's \b boundary never matches inside it.
  'electro-technical officer',
  'electrotechnical',
  'superyacht',
  // "bosun" and "merchant navy" above already cover 2 of the 3 ranks in the
  // newest ROLE_TERMS entry; "radio officer" is unambiguous (no non-maritime
  // usage) so it earns a direct entry too. "purser" is deliberately excluded
  // — airlines use the same title for cabin crew leads — so a purser listing
  // still has to earn scope through another term actually in its text (e.g.
  // "cruise" or "ship"), same precedent as the bare "steward"/"cook" omission
  // above.
  'radio officer',
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
