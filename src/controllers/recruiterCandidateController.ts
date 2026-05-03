import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import {
  InvitationStatus,
  JobStatus,
  RecruiterStatus,
} from '../generated/client/index.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import {
  calculateTotalSeaTime,
  formatDuration,
} from '../utils/experienceUtils.js';

const normalizeText = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase();

const parseQueryValues = (value: string | string[] | undefined): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      String(item)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    );
  }

  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
};

const buildCandidateAvatar = (name: string, seed = '') => {
  const initials =
    (name || 'Candidate')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'C';

  const palette = ['0D8ABC', '1E5A8F', '2563EB', '0F766E', '7C3AED', 'B45309'];
  const index =
    `${name}:${seed}`
      .split('')
      .reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length;
  const fill = palette[index];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect fill="#${fill}" width="40" height="40"/><text x="50%" y="50%" dy=".35em" fill="white" font-family="Arial" font-size="16" text-anchor="middle">${initials}</text></svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const matchesExperienceBucket = (years: number, selectedBuckets: string[]) => {
  if (selectedBuckets.length === 0) return true;

  return selectedBuckets.some((bucket) => {
    const normalized = normalizeText(bucket);
    if (normalized === '0-2 years') return years >= 0 && years <= 2;
    if (normalized === '3-5 years') return years >= 3 && years <= 5;
    if (normalized === '6-10 years') return years >= 6 && years <= 10;
    if (normalized === '10+ years') return years >= 10;
    return false;
  });
};

type SearchCandidateWhere = {
  isVerified: boolean;
  status: 'VERIFIED';
  OR?: Array<{
    fullname?: { contains: string; mode: 'insensitive' };
    email?: { contains: string; mode: 'insensitive' };
  }>;
};

const buildComplianceMeta = (prof: {
  kyc?: { status?: string | null } | null;
  documents?: Array<{ expiryDate?: Date | null }> | null;
}) => {
  const docs = Array.isArray(prof.documents) ? prof.documents : [];
  if (prof.kyc?.status !== RecruiterStatus.APPROVED) {
    return {
      compliance: 'Not Deployable',
      complianceSubtext: 'KYC not approved',
    };
  }

  if (docs.length === 0) {
    return {
      compliance: 'Not Deployable',
      complianceSubtext: 'Missing critical certs',
    };
  }

  const hasExpiredDocs = docs.some(
    (doc) => doc.expiryDate && new Date(doc.expiryDate) < new Date(),
  );

  if (hasExpiredDocs) {
    return {
      compliance: 'Expiring Soon',
      complianceSubtext: 'Renewals needed',
    };
  }

  return {
    compliance: 'Ready',
    complianceSubtext: 'Ready to deploy',
  };
};

/**
 * Get matching candidates for a specific job
 */
export const getMatchingCandidates = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id: jobId } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(
      userRole || '',
    );

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        recruiter: { select: { organizationName: true } },
      },
    });

    if (!job) {
      return next(new AppError('Job not found', 404));
    }

    if (!isAdmin && job.recruiterId !== userId) {
      return next(
        new AppError('Not authorized to view matches for this job', 403),
      );
    }

    if (job.status !== JobStatus.ACTIVE) {
      return res.status(200).json({
        status: 'success',
        results: 0,
        data: { candidates: [] },
      });
    }

    const appliedOrInvited = await prisma.professional.findMany({
      where: {
        OR: [
          { applications: { some: { jobId } } },
          {
            invitations: { some: { jobId, status: InvitationStatus.PENDING } },
          },
        ],
      },
      select: { id: true },
    });
    const excludedProfessionalIds = new Set(
      appliedOrInvited.map((item) => item.id),
    );

    // 1. Fetch professionals relevant to this job category
    const professionals = await prisma.professional.findMany({
      where: {
        isVerified: true,
        OR: [
          { profession: job.category },
          {
            resume: {
              is: {
                category: job.category,
              },
            },
          },
        ],
      },
      include: {
        resume: {
          include: {
            skills: true,
            seaService: true,
          },
        },
        kyc: true,
        documents: true,
      },
    });

    // 2. Matching Logic
    const jobDescription = normalizeText(job.description);
    const jobTitle = normalizeText(job.title);

    const candidates = professionals
      .filter((prof) => !excludedProfessionalIds.has(prof.id))
      .map((prof) => {
        let matchScore = 0;
        const matchCriteria: string[] = [];
        const resumeCategory = normalizeText(prof.resume?.category);
        const resumeSubcategory = normalizeText(prof.resume?.subcategory);
        const profession = normalizeText(prof.profession);

        // Category Match (Base matching)
        if (
          profession === normalizeText(job.category) ||
          resumeCategory === normalizeText(job.category)
        ) {
          matchScore += 40;
          matchCriteria.push('Category Match');
        }

        // Subcategory Match
        if (
          resumeSubcategory &&
          (jobDescription.includes(resumeSubcategory) ||
            jobTitle.includes(resumeSubcategory))
        ) {
          matchScore += 20;
          matchCriteria.push('Specialization Match');
        }

        // Skills Match
        const profSkills =
          prof.resume?.skills.map((s) => normalizeText(s.skillName)) || [];
        const skillMatches = profSkills.filter((skill) =>
          jobDescription.includes(skill),
        );

        if (skillMatches.length > 0) {
          matchScore += Math.min(skillMatches.length * 10, 40); // Max 40 points for skills
          matchCriteria.push(`Matches ${skillMatches.length} expected skills`);
        }

        const { compliance, complianceSubtext } = buildComplianceMeta(prof);

        if (
          Array.isArray(prof.resume?.seaService) &&
          prof.resume.seaService.length > 0
        ) {
          matchScore += 5;
          matchCriteria.push('Sea service history available');
        }

        // Latest Rank / Ship (from Sea Service)
        const latestExp = prof.resume?.seaService?.sort((a, b) => {
          const dateA = a.joiningDate ? new Date(a.joiningDate).getTime() : 0;
          const dateB = b.joiningDate ? new Date(b.joiningDate).getTime() : 0;
          return dateB - dateA;
        })[0];

        // Experience calculation
        const { years } = calculateTotalSeaTime(prof.resume?.seaService || []);

        return {
          id: prof.id,
          professionalId: prof.id,
          fullname: prof.fullname,
          rank: latestExp?.role || prof.resume?.subcategory || 'N/A',
          avatarUrl: prof.profilePhotoUrl,
          location: prof.resume?.country || prof.kyc?.issueCountry || 'Global',
          totalYearsExperience: years,
          availability: latestExp?.vesselName || 'Available Now',
          availabilitySubtext:
            latestExp?.role ||
            prof.resume?.subcategory ||
            prof.profession ||
            '',
          compliance,
          complianceSubtext,
          matchPercentage: Math.min(matchScore, 100),
          matchCriteria,
          cvUrl: prof.cvUrl,
          documents: prof.documents,
        };
      })
      .filter((candidate) => candidate.matchPercentage > 0);

    // Sort by match percentage
    candidates.sort((a, b) => b.matchPercentage - a.matchPercentage);

    res.status(200).json({
      status: 'success',
      results: candidates.length,
      data: { candidates },
    });
  },
);

/**
 * Search professionals for recruiter candidate discovery.
 */
export const searchCandidates = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit as string) || 10, 1);
    const skip = (page - 1) * limit;

    const search = normalizeText(req.query.search);
    const sortBy = String(req.query.sortBy || 'Best Matches');
    const rankFilters = parseQueryValues(
      req.query.rankPosition as string | string[] | undefined,
    );
    const experienceFilters = parseQueryValues(
      req.query.experienceLevel as string | string[] | undefined,
    );
    const vesselFilters = parseQueryValues(
      req.query.vesselType as string | string[] | undefined,
    );

    const where: SearchCandidateWhere = {
      isVerified: true,
      status: 'VERIFIED',
    };

    if (search) {
      where.OR = [
        { fullname: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const professionals = await prisma.professional.findMany({
      where,
      include: {
        resume: {
          include: {
            seaService: true,
          },
        },
        kyc: {
          select: {
            issueCountry: true,
          },
        },
      },
    });

    const candidates = professionals
      .map((prof) => {
        const seaService = Array.isArray(prof.resume?.seaService)
          ? prof.resume.seaService
          : [];
        const { years, months } = calculateTotalSeaTime(seaService);
        const latestService = [...seaService].sort((a, b) => {
          const aTime = a.joiningDate ? new Date(a.joiningDate).getTime() : 0;
          const bTime = b.joiningDate ? new Date(b.joiningDate).getTime() : 0;
          return bTime - aTime;
        })[0];

        const rank = latestService?.role || prof.resume?.subcategory || 'N/A';
        const rankCandidates = [
          rank,
          prof.resume?.subcategory,
          latestService?.role,
        ]
          .map((value) => normalizeText(value))
          .filter(Boolean);
        const vesselTypes = Array.from(
          new Set(
            seaService
              .map((entry) => String(entry.vesselType || '').trim())
              .filter(Boolean),
          ),
        );
        const location =
          prof.resume?.country || prof.kyc?.issueCountry || 'Global';
        const experienceText = formatDuration(years, months);
        const image =
          prof.profilePhotoUrl ||
          buildCandidateAvatar(prof.fullname || prof.email, prof.id);
        const tier = String(prof.tier || 'FREE').toUpperCase();
        const isPremium = tier === 'PRO';

        const searchTerms = [
          prof.fullname,
          prof.email,
          rank,
          location,
          experienceText,
          ...vesselTypes,
        ].map((value) => normalizeText(value));

        const matchesSearch =
          !search || searchTerms.some((term) => term.includes(search));
        const matchesRank =
          rankFilters.length === 0 ||
          rankFilters.some((filter) => {
            const normalizedFilter = normalizeText(filter);
            return rankCandidates.some(
              (candidate) =>
                candidate === normalizedFilter ||
                candidate.includes(normalizedFilter) ||
                normalizedFilter.includes(candidate),
            );
          });
        const matchesExperience = matchesExperienceBucket(
          years,
          experienceFilters,
        );
        const matchesVessel =
          vesselFilters.length === 0 ||
          vesselFilters.some((filter) =>
            vesselTypes.some(
              (type) =>
                normalizeText(type) === normalizeText(filter) ||
                normalizeText(type).includes(normalizeText(filter)),
            ),
          );

        const matchScore = [
          matchesSearch ? 40 : 0,
          matchesRank ? 25 : 0,
          matchesExperience ? 20 : 0,
          matchesVessel ? 15 : 0,
          prof.isVerified ? 5 : 0,
        ].reduce((sum, value) => sum + value, 0);

        return {
          id: prof.id,
          fullname: prof.fullname || 'Unknown candidate',
          rank,
          experience: experienceText,
          experienceYears: years,
          location,
          matchPercentage: Math.min(matchScore, 100),
          verified: Boolean(prof.isVerified),
          tier,
          isPremium,
          image,
          vesselTypes,
          resumeCategory: prof.resume?.subcategory || null,
          availability: latestService?.vesselName || 'Available now',
          availabilitySubtext:
            latestService?.role || prof.resume?.subcategory || '',
        };
      })
      .filter((candidate) => {
        if (search && candidate.matchPercentage === 0) return false;

        const rankMatched =
          rankFilters.length === 0 ||
          rankFilters.some((filter) => {
            const normalizedFilter = normalizeText(filter);
            return [candidate.rank, candidate.resumeCategory]
              .map((value) => normalizeText(value))
              .some(
                (value) =>
                  value === normalizedFilter ||
                  value.includes(normalizedFilter) ||
                  normalizedFilter.includes(value),
              );
          });

        const vesselMatched =
          vesselFilters.length === 0 ||
          vesselFilters.some((filter) =>
            candidate.vesselTypes.some(
              (type) =>
                normalizeText(type) === normalizeText(filter) ||
                normalizeText(type).includes(normalizeText(filter)),
            ),
          );

        return (
          rankMatched &&
          vesselMatched &&
          matchesExperienceBucket(candidate.experienceYears, experienceFilters)
        );
      });

    candidates.sort((a, b) => {
      const premiumDelta =
        Number(Boolean(b.isPremium)) - Number(Boolean(a.isPremium));
      if (premiumDelta !== 0) return premiumDelta;

      switch (sortBy) {
        case 'Experience (High to Low)':
          return b.experienceYears - a.experienceYears;
        case 'Experience (Low to High)':
          return a.experienceYears - b.experienceYears;
        case 'Alphabetical':
          return a.fullname.localeCompare(b.fullname);
        case 'Best Matches':
        default:
          return (
            b.matchPercentage - a.matchPercentage ||
            b.experienceYears - a.experienceYears
          );
      }
    });

    const total = candidates.length;
    const paginated = candidates.slice(skip, skip + limit);

    res.status(200).json({
      status: 'success',
      results: paginated.length,
      total,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
      data: { candidates: paginated },
    });
  },
);

/**
 * Invite a professional to apply for a job
 */
export const inviteProfessional = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id: jobId, professionalId } = req.params;
    const recruiterId = req.user?.id;

    if (!recruiterId)
      return next(new AppError('Recruiter context missing', 400));

    // 1. Check if job exists and belongs to recruiter
    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) return next(new AppError('Job not found', 404));
    if (
      job.recruiterId !== recruiterId &&
      req.user?.role !== 'ADMIN' &&
      req.user?.role !== 'SUPER_ADMIN'
    ) {
      return next(new AppError('Not authorized to invite for this job', 403));
    }

    // 2. Check if already invited or applied
    const existingInvite = await prisma.jobInvitation.findFirst({
      where: { jobId, professionalId },
    });

    if (existingInvite) {
      return next(
        new AppError(
          'Professional has already been invited or invitation is pending',
          400,
        ),
      );
    }

    const applied = await prisma.jobApplication.findFirst({
      where: { jobId, professionalId },
    });

    if (applied) {
      return next(
        new AppError('Professional has already applied for this job', 400),
      );
    }

    // 3. Create Invitation
    const invitation = await prisma.jobInvitation.create({
      data: {
        jobId,
        professionalId,
        recruiterId,
        status: InvitationStatus.PENDING,
      },
    });

    // 4. Create Alert for Professional
    let senderName = 'A recruiter';
    if (req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN') {
      senderName = 'MaritimeLink Admin';
    } else {
      const recruiterData = await prisma.recruiter.findUnique({
        where: { id: recruiterId },
        select: { organizationName: true },
      });
      senderName = recruiterData?.organizationName || 'A recruiter';
    }

    await prisma.alert.create({
      data: {
        professionalId,
        type: 'INVITATION',
        title: 'New Job Invitation',
        message: `${senderName} has invited you to apply for "${job.title}".`,
        metadata: { jobId, invitationId: invitation.id },
      },
    });

    res.status(201).json({
      status: 'success',
      message: 'Invitation sent successfully',
      data: { invitation },
    });
  },
);
