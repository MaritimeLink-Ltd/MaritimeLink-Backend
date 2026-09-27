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
  // "chief officer" is deliberately NOT a term: it's also a common public
  // sector / corporate title ("Chief Officer of Human Resources", Kenyan
  // county "Chief Officer Public Works", UK council "Deputy Chief Officer").
  // Measured against every stored listing: dropping it removed 30, ~25 of
  // them that kind of noise, while 48 genuine ship chief officer postings
  // still passed on another word in their text ("vessel", "container ship",
  // "offshore", ...).
  // Certificated ranks the rank searches ask for by name. Each is a
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
  // Ratings and catering ranks the rank searches target directly (see
  // queryGrid.ts). Each is maritime-only in ordinary usage, unlike the ranks
  // deliberately left out — a bare "steward" or "cook" also describes hotel
  // and shop-floor work, so those still have to earn their place through
  // another term in the listing.
  'messman',
  'motorman',
  'merchant navy',
  'seagoing',
  'deck cadet',
  'engine cadet',
  // The 3 rank terms added when the 3rd SerpApi key widened the daily
  // budget (queryGrid.ts). "electro-technical officer" is specific enough on
  // its own; "superyacht" needs its own entry because it's one word, so the
  // "yacht" pattern's \b boundary never matches inside it.
  'electro-technical officer',
  'electrotechnical',
  'superyacht',
  // "bosun" and "merchant navy" above already cover 2 of the 3 ranks in the
  // rank searches; "radio officer" is unambiguous (no non-maritime
  // usage) so it earns a direct entry too. "purser" is deliberately excluded
  // — airlines use the same title for cabin crew leads — so a purser listing
  // still has to earn scope through another term actually in its text (e.g.
  // "cruise" or "ship"), same precedent as the bare "steward"/"cook" omission
  // above.
  'radio officer',
  // Titles and vessel types the client's keyword list searches for
  // (queryGrid.ts) whose postings can otherwise carry no other maritime word
  // in the title. Deliberately NOT added, because each is also an ordinary
  // title elsewhere and would let those listings through: "engine rating"
  // (pilots' multi-engine rating), "bulker" (UK cement-bulker HGV driving),
  // "towage" (road vehicle recovery), "cable layer" (telecoms/utility
  // groundworks), "certificate of competency" (gas/boiler/mining tickets),
  // "chief cook", "steward", "fitter", "machinist". Postings for the
  // ship-board versions of those still pass through a word in their text
  // ("vessel", "ship", "STCW", ...).
  'officer of the watch',
  'oow',
  'eoow',
  'watchkeeping engineer',
  'boatswain',
  'pumpman',
  'deck crew',
  'engine crew',
  'reefer engineer',
  'electro technical officer',
  'lng carrier',
  'lpg carrier',
  'gas carrier',
  'ro-ro',
  'roro',
  'ropax',
  'osv',
  'ahts',
  'anchor handler',
  'anchor handling',
  'dredger',
  // Crew shorthand on company boards, measured live: North Star Shipping's
  // UK board titles its posts "3rd Engineer - ERRV", "Fast Rescue Craft
  // Coxswain", "Daughter Craft Coxswain", "Cook - ERRV" — none of which
  // matched a term, so its genuinely seagoing board scored 9% maritime
  // titles. ERRV (emergency response and rescue vessel) and the craft names
  // are maritime-only; numbered ranks are how many fleets write them.
  'errv',
  'coxswain',
  'rescue craft',
  'daughter craft',
  '2nd engineer',
  '3rd engineer',
  '4th engineer',
  '2nd officer',
  '3rd officer',
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
 * Below this share of in-scope results on a full first page, a second page
 * isn't worth its search unit.
 *
 * Measured on a live run: "chief officer" filled its first page in every
 * market — mostly corporate "Chief <X> Officer" roles — and its bonus pages
 * came back just as noisy (Ethiopia: 10 returned, 0 in scope; Nigeria 20/3;
 * South Africa 16/2). Those bonus pages ate the budget planned for the day's
 * secondary searches, half of which then never ran. A page that is mostly
 * maritime ("deck crew" UK: 18 returned, 17 in scope) is the signal a second
 * page is worth it.
 */
export const BONUS_PAGE_MIN_IN_SCOPE_RATIO = 0.5;

/** Share of a page that passes the maritime filter, 0-1 (0 for an empty page). */
export const inScopeRatio = (page: ExternalJob[]): number =>
  page.length === 0 ? 0 : page.filter(isInMaritimeScope).length / page.length;

/** Whether a search's first page earns it a second (bonus) page. */
export const isWorthABonusPage = (
  firstPage: ExternalJob[],
  pageSize: number,
): boolean =>
  firstPage.length >= pageSize &&
  inScopeRatio(firstPage) >= BONUS_PAGE_MIN_IN_SCOPE_RATIO;

/**
 * True when a listing belongs in the maritime feed.
 *
 * Feed-sourced rows come from maritime job boards, so they are in scope by
 * origin. Search-engine rows must show a maritime signal in their own text.
 */
/**
 * City names in our target markets that start with "Port" — the "port"
 * term would otherwise match the place, not a port job. Measured live: a
 * Port Harcourt (Nigeria) "Chief Operating Officer" passed scope on its
 * location alone. Port Said (Egypt) and Port Elizabeth (South Africa) are in
 * target markets too; Port Talbot is a UK steel town.
 */
const PORT_PLACE_NAMES = /\bport\s+(harcourt|said|elizabeth|talbot)\b/gi;

export const isInMaritimeScope = (job: ExternalJob): boolean => {
  if (job.provider === 'feed') return true;

  return hasMaritimeSignal(
    [job.title, job.category, job.company, job.location, job.description]
      .filter(Boolean)
      .join(' ')
      .replace(PORT_PLACE_NAMES, ' '),
  );
};

/** Maritime signal in what a posting says it *is* — title, category, location — ignoring its description. */
export const hasTitleLevelMaritimeSignal = (job: ExternalJob): boolean =>
  hasMaritimeSignal(
    [job.title, job.category, job.location]
      .filter(Boolean)
      .join(' ')
      .replace(PORT_PLACE_NAMES, ' '),
  );

/**
 * Below this share of maritime titles, a company's board is a corporate
 * board (offices, IT, finance, construction arms) rather than a seagoing one.
 */
export const CORPORATE_BOARD_MARITIME_TITLE_RATIO = 0.5;

/**
 * Below this many postings a board is kept whole: a share of 2-5 titles is
 * noise (Stena's two real openings, "Junior Officers Deck/Engine", carry no
 * scope term and would classify its board as 0% maritime), and a board that
 * small can't leak office roles in any volume anyway. The boilerplate
 * problem is a big-board problem — Boskalis lists 106.
 */
export const MIN_BOARD_SIZE_TO_CLASSIFY = 10;

/**
 * Scope rule for one company's own job board.
 *
 * On a maritime company's board every description carries the same
 * boilerplate ("our fleet of vessels..."), so the description-based check
 * passes everything. Measured live, the boards split cleanly: seagoing
 * boards have 79-99% maritime titles (Svitzer 79%, Columbia 84%, V.Group
 * 99%), while Boskalis's is 20% — accountants, developers and Dutch
 * road-construction. A corporate board keeps only its maritime-titled
 * postings; a seagoing board is kept whole, because its genuine crew posts
 * are often titled with just the rank ("Master", "Captain", "Cook").
 */
export const scopeCompanyBoard = (jobs: ExternalJob[]): ExternalJob[] => {
  if (jobs.length < MIN_BOARD_SIZE_TO_CLASSIFY) return jobs;
  const maritimeTitled = jobs.filter(hasTitleLevelMaritimeSignal);
  return maritimeTitled.length / jobs.length <
    CORPORATE_BOARD_MARITIME_TITLE_RATIO
    ? maritimeTitled
    : jobs;
};
