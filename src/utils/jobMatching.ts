const normalizeText = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase();

const STOP_WORDS = new Set([
  'and',
  'any',
  'are',
  'for',
  'from',
  'have',
  'here',
  'job',
  'looking',
  'needed',
  'need',
  'position',
  'required',
  'role',
  'seeking',
  'test',
  'the',
  'this',
  'that',
  'with',
  'your',
  'our',
  'over',
  'under',
  'more',
  'most',
  'less',
  'into',
  'onto',
  'than',
  'then',
  'will',
  'shall',
  'can',
  'could',
  'should',
  'would',
  'about',
  'after',
  'before',
  'during',
  'today',
  'yesterday',
  'tomorrow',
]);

const tokenizeSearchableText = (value: unknown) =>
  normalizeText(value)
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !STOP_WORDS.has(part));

export const collectSearchKeywords = (...values: unknown[]) =>
  [...new Set(values.flatMap((value) => tokenizeSearchableText(value)))].slice(
    0,
    24,
  );

type MatchableJob = {
  title?: string | null;
  description?: string | null;
  location?: string | null;
  category?: string | null;
};

type MatchableProfessional = {
  id?: string;
  fullname?: string | null;
  email?: string;
  profession?: string | null;
  status?: string | null;
  isVerified?: boolean | null;
  resume?: {
    category?: string | null;
    subcategory?: string | null;
    summary?: string | null;
    skills?: Array<{ skillName?: string | null }>;
    seaService?: Array<{
      companyName?: string | null;
      role?: string | null;
      vesselName?: string | null;
      vesselType?: string | null;
    }>;
  } | null;
};

/**
 * Minimum score at which the platform treats a professional as matched to a job.
 * Shared so the matches list and Flex resume access agree on "matched".
 */
export const JOB_MATCH_SCORE_THRESHOLD = 35;

export const scoreProfessionalForJob = (
  job: MatchableJob,
  professional: MatchableProfessional,
) => {
  const jobTerms = collectSearchKeywords(
    job.title,
    job.description,
    job.location,
    job.category,
  );

  const skillNames =
    professional.resume?.skills
      ?.map((skill) => skill.skillName)
      .filter(Boolean) || [];
  const seaServiceTerms =
    professional.resume?.seaService?.flatMap((log) => [
      log.companyName,
      log.role,
      log.vesselName,
      log.vesselType,
    ]) || [];

  const candidateTerms = collectSearchKeywords(
    professional.fullname,
    professional.email,
    professional.profession,
    professional.resume?.category,
    professional.resume?.subcategory,
    professional.resume?.summary,
    ...skillNames,
    ...seaServiceTerms,
  );

  const jobText = normalizeText(
    [job.title, job.description, job.location, job.category]
      .filter(Boolean)
      .join(' '),
  );

  let score = 0;
  const criteria: string[] = [];

  // Guard on a non-empty category: a job with no category must not "match" a
  // professional with no profession just because both normalize to "".
  // Platform jobs always carry a category (required in schema), so this only
  // affects externally-sourced listings, which may have none.
  const jobCategory = normalizeText(job.category);
  const exactCategoryMatch =
    Boolean(jobCategory) &&
    (normalizeText(professional.profession) === jobCategory ||
      normalizeText(professional.resume?.category) === jobCategory);

  if (exactCategoryMatch) {
    score += 40;
    criteria.push('Category match');
  }

  const keywordMatches = jobTerms.filter((term) =>
    candidateTerms.some(
      (candidateTerm) =>
        candidateTerm === term ||
        candidateTerm.includes(term) ||
        term.includes(candidateTerm),
    ),
  );

  if (keywordMatches.length > 0) {
    score += Math.min(keywordMatches.length * 8, 30);
    criteria.push(`Keyword match (${keywordMatches.slice(0, 3).join(', ')})`);
  }

  const skillMatches = skillNames.filter((skill) => {
    const normalized = normalizeText(skill);
    return normalized && jobText.includes(normalized);
  });

  if (skillMatches.length > 0) {
    score += Math.min(skillMatches.length * 8, 24);
    criteria.push(`Skill match (${skillMatches.slice(0, 3).join(', ')})`);
  }

  const seaMatches =
    professional.resume?.seaService?.filter((log) =>
      [log.companyName, log.role, log.vesselName, log.vesselType].some(
        (entry) => {
          const normalized = normalizeText(entry);
          return normalized && jobText.includes(normalized);
        },
      ),
    ) || [];

  if (seaMatches.length > 0) {
    score += Math.min(seaMatches.length * 5, 15);
    criteria.push('Sea service match');
  }

  if (professional.isVerified) {
    score += 5;
  }

  if (normalizeText(professional.status) === 'verified') {
    score += 5;
  }

  return {
    score,
    criteria,
    exactCategoryMatch,
    keywordMatches,
    skillMatches,
    seaMatches,
  };
};

export const matchesProfessionalForJob = (
  job: MatchableJob,
  professional: MatchableProfessional,
  minimumScore = 35,
) => scoreProfessionalForJob(job, professional).score >= minimumScore;
