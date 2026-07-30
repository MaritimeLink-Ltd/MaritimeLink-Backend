import { Prisma } from '../generated/client/index.js';

/** Any resume payload that carries the skills and sea-service relations. */
type ResumeWithBasics = Prisma.ProfessionalResumeGetPayload<{
  include: { skills: true; seaService: true };
}>;

/**
 * The resume fields a Free/Flex recruiter may see without a "View Resume" unlock.
 *
 * Deliberately the exact subset the public shareable profile already exposes (see
 * publicProfileController) — country, the self-authored summary, skills and sea
 * service. A gated recruiter therefore sees no more than anyone holding the share
 * link, while the candidate still shows real experience and skills instead of
 * reading as an empty record, which is what drives the upgrade.
 *
 * Everything else on the resume — licences, education, STCW and medical
 * certificates, travel documents, next of kin, referees — stays behind
 * `access.viewResume`, as do the CV file and the document wallet.
 */
export const toPublicResumeBasics = (resume: ResumeWithBasics | null) => {
  if (!resume) return null;

  return {
    country: resume.country,
    summary: resume.summary,
    skills: resume.skills.map((skill) => ({
      skillName: skill.skillName,
      rating: skill.rating,
    })),
    seaService: resume.seaService.map((entry) => ({
      joiningDate: entry.joiningDate,
      tillDate: entry.tillDate,
      vesselType: entry.vesselType,
      vesselName: entry.vesselName,
      role: entry.role,
    })),
  };
};
