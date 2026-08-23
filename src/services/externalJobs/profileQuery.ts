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

const clean = (value: unknown) => String(value ?? '').trim();

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
