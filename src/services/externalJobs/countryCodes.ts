/**
 * JSearch's `country` parameter takes an ISO 3166-1 alpha-2 code, unlike
 * SerpApi's `location`, which is a free-text place name. This maps the same
 * human-readable country names used in `MARITIME_COUNTRIES` (refresh.ts) to
 * the code JSearch expects, so both providers can be driven off one list.
 */
const COUNTRY_TO_ALPHA2: Record<string, string> = {
  'United Kingdom': 'gb',
  Philippines: 'ph',
  India: 'in',
  China: 'cn',
  Indonesia: 'id',
  Ukraine: 'ua',
  Russia: 'ru',
  Poland: 'pl',
  Croatia: 'hr',
  Greece: 'gr',
  Turkey: 'tr',
  Nigeria: 'ng',
  Ghana: 'gh',
  Bangladesh: 'bd',
  Vietnam: 'vn',
  Romania: 'ro',
  'United Arab Emirates': 'ae',
  Singapore: 'sg',
  'United States': 'us',
  Canada: 'ca',
  Ethiopia: 'et',
  Germany: 'de',
};

/** Null when a country has no known mapping — caller should skip it for JSearch rather than guess. */
export const toAlpha2CountryCode = (countryName: string): string | null =>
  COUNTRY_TO_ALPHA2[countryName] ?? null;
