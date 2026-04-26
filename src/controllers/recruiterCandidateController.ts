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
import { calculateTotalSeaTime } from '../utils/experienceUtils.js';

const normalizeText = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase();

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

    if (isAdmin) {
      if (job.adminId && job.adminId !== userId) {
        return next(
          new AppError('Not authorized to view matches for this job', 403),
        );
      }
    } else if (job.recruiterId !== userId) {
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
