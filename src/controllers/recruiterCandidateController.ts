import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import {
  InvitationStatus,
  RecruiterStatus,
} from '../generated/client/index.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { calculateTotalSeaTime } from '../utils/experienceUtils.js';

/**
 * Get matching candidates for a specific job
 */
export const getMatchingCandidates = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id: jobId } = req.params;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        recruiter: { select: { organizationName: true } },
      },
    });

    if (!job) {
      return next(new AppError('Job not found', 404));
    }

    // 1. Fetch professionals in the same category
    const professionals = await prisma.professional.findMany({
      where: {
        profession: job.category,
        isVerified: true,
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
    const jobDescription = job.description.toLowerCase();

    const candidates = professionals.map((prof) => {
      let matchScore = 0;
      const matchCriteria = [];

      // Category Match (Base matching)
      if (prof.profession === job.category) {
        matchScore += 40;
        matchCriteria.push('Category Match');
      }

      // Subcategory Match
      if (
        prof.resume?.subcategory &&
        jobDescription.includes(prof.resume.subcategory.toLowerCase())
      ) {
        matchScore += 20;
        matchCriteria.push('Specialization Match');
      }

      // Skills Match
      const profSkills =
        prof.resume?.skills.map((s) => s.skillName.toLowerCase()) || [];
      const skillMatches = profSkills.filter((skill) =>
        jobDescription.includes(skill),
      );

      if (skillMatches.length > 0) {
        matchScore += Math.min(skillMatches.length * 10, 40); // Max 40 points for skills
        matchCriteria.push(`Matches ${skillMatches.length} expected skills`);
      }

      // Compliance / Readiness
      let compliance = 'Missing';
      if (prof.kyc?.status === RecruiterStatus.APPROVED) {
        const hasExpiredDocs = prof.documents.some(
          (doc) => doc.expiryDate && new Date(doc.expiryDate) < new Date(),
        );
        compliance = hasExpiredDocs ? 'Expiring Soon' : 'Ready';
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
        fullname: prof.fullname,
        rank: latestExp?.role || prof.resume?.subcategory || 'N/A',
        avatarUrl: prof.profilePhotoUrl,
        location: prof.resume?.country || prof.kyc?.issueCountry || 'Global',
        totalYearsExperience: years,
        availability: latestExp?.vesselName || 'Available Now',
        compliance,
        matchPercentage: Math.min(matchScore, 100),
        matchCriteria,
        cvUrl: prof.cvUrl,
        documents: prof.documents,
      };
    });

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
