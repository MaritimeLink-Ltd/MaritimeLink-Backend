import { Prisma } from '../../generated/client/index.js';

/**
 * Everything the external-jobs pipeline needs about a professional: the fields
 * that shape the upstream search, plus the resume relations that
 * `scoreProfessionalForJob` reads when ranking results.
 */
export const professionalMatchInclude = {
  resume: {
    include: {
      skills: true,
      seaService: {
        orderBy: { joiningDate: 'desc' as const },
        take: 5,
      },
    },
  },
} satisfies Prisma.ProfessionalInclude;

export type ProfessionalWithResume = Prisma.ProfessionalGetPayload<{
  include: typeof professionalMatchInclude;
}>;

/**
 * Search wording for each platform category, used by the daily refresh to
 * cover professionals whose rank is too sparse or too rare to search on
 * individually.
 */
export const CATEGORY_SEARCH_TERMS: Record<string, string> = {
  OFFICER: 'maritime deck engineer officer',
  RATINGS_AND_CREW: 'seafarer ratings crew',
  CATERING_AND_MEDICAL: 'ship catering steward medical',
};

const clean = (value: unknown) => String(value ?? '').trim();

const MARITIME_HINTS = [
  'maritime',
  'marine',
  'ship',
  'vessel',
  'offshore',
  'seafarer',
  'deck',
  'engine',
  'cruise',
  'port',
  'naval',
  'boat',
  'yacht',
  'tanker',
];

/**
 * Keeps a role search inside the maritime domain — "Fourth Engineer" alone
 * returns shoreside manufacturing roles, "Fourth Engineer maritime" does not.
 *
 * Hints match on word boundaries: "Engineer" must not count as the hint
 * "engine", or every engineering rank would skip scoping.
 */
export const scopeToMaritime = (term: string) => {
  const trimmed = clean(term);
  const alreadyScoped = MARITIME_HINTS.some((hint) =>
    new RegExp(`\\b${hint}s?\\b`, 'i').test(trimmed),
  );
  return alreadyScoped ? trimmed : `${trimmed} maritime`;
};

/**
 * True when the profile carries enough signal for relevance ranking to mean
 * something. Sparse profiles get unranked results instead of an empty tab.
 */
export const hasMatchableProfile = (professional: ProfessionalWithResume) =>
  Boolean(
    clean(professional.subcategory) ||
    clean(professional.resume?.subcategory) ||
    clean(professional.resume?.category) ||
    clean(professional.profession) ||
    (professional.resume?.skills?.length ?? 0) > 0 ||
    (professional.resume?.seaService?.length ?? 0) > 0,
  );
