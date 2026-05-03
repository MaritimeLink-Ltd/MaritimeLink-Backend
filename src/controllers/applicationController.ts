import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { logActivity } from '../services/activityLogger.js';
import { CustomRequest } from '../types/index.js';
import {
  ApplicationStatus,
  ActorType,
  Prisma,
  RecruiterStatus,
} from '../generated/client/index.js';
import {
  calculateTotalSeaTime,
  getExperienceSummary,
} from '../utils/experienceUtils.js';

const APPLICATION_STATUS_ALIASES: Record<string, ApplicationStatus> = {
  APPLIED: ApplicationStatus.APPLIED,
  UNDER_REVIEW: ApplicationStatus.UNDER_REVIEW,
  REVIEWING: ApplicationStatus.UNDER_REVIEW,
  SHORTLISTED: ApplicationStatus.SHORTLISTED,
  INTERVIEW: ApplicationStatus.INTERVIEW,
  INTERVIEWED: ApplicationStatus.INTERVIEW,
  OFFER: ApplicationStatus.OFFER,
  ACCEPTED: ApplicationStatus.OFFER,
  HIRED: ApplicationStatus.HIRED,
  REJECTED: ApplicationStatus.REJECTED,
  WITHDRAWN: ApplicationStatus.WITHDRAWN,
};

const FREE_APPLICATION_LIMIT = 10;
const ACTIVE_APPLICATION_STATUSES = [
  ApplicationStatus.APPLIED,
  ApplicationStatus.UNDER_REVIEW,
  ApplicationStatus.SHORTLISTED,
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.OFFER,
];

const normalizeApplicationStatus = (status: unknown) => {
  if (typeof status !== 'string') return null;

  return APPLICATION_STATUS_ALIASES[status.trim().toUpperCase()] ?? null;
};

export const applyToJob = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id: jobId } = req.params;
    const { coverLetter, coverLetterUrl, cvUrl, documentIds } = req.body;
    const userId = req.user?.id;

    if (!userId) return next(new AppError('Unauthorized', 401));

    // 1. Fetch Professional and their full Resume for the snapshot
    const professional = await prisma.professional.findUnique({
      where: { id: userId },
      select: {
        tier: true,
        cvUrl: true,
        lastCoverLetter: true,
        resume: {
          include: {
            skills: true,
            licenses: true,
            seaService: true,
            education: true,
            stcwCertificates: true,
            medicalCertificates: true,
            travelDocuments: true,
            nextOfKin: true,
            referees: true,
          },
        },
      },
    });

    if (!professional) return next(new AppError('Professional not found', 404));

    // 2. Only persist what was explicitly submitted for this application.
    // We do not fall back to profile CV / cover letter here because that can leak
    // unrelated files into recruiter/admin application review.
    const finalCoverLetter =
      typeof coverLetter === 'string' && coverLetter.trim()
        ? coverLetter.trim()
        : null;
    const finalCvUrl =
      typeof cvUrl === 'string' && cvUrl.trim() ? cvUrl.trim() : null;

    // 3. Check if Job exists
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return next(new AppError('Job not found', 404));

    // 4. Check if already applied
    const existingApplication = await prisma.jobApplication.findUnique({
      where: {
        jobId_professionalId: {
          jobId,
          professionalId: userId,
        },
      },
    });

    if (existingApplication) {
      return next(new AppError('You have already applied to this job', 400));
    }

    if (professional.tier !== 'PRO') {
      const activeApplicationsCount = await prisma.jobApplication.count({
        where: {
          professionalId: userId,
          status: { in: ACTIVE_APPLICATION_STATUSES },
        },
      });

      if (activeApplicationsCount >= FREE_APPLICATION_LIMIT) {
        return next(
          new AppError(
            `Free accounts can only have ${FREE_APPLICATION_LIMIT} active job applications. Upgrade to PRO for unlimited applications.`,
            403,
          ),
        );
      }
    }

    // 5. Create Application with Snapshot
    const application = await prisma.jobApplication.create({
      data: {
        jobId,
        professionalId: userId,
        coverLetter: finalCoverLetter,
        coverLetterUrl: coverLetterUrl || null,
        cvUrl: finalCvUrl,
        resumeSnapshot: professional.resume as Prisma.InputJsonValue, // Captures full profile at time of application
        status: ApplicationStatus.APPLIED,
        ...(documentIds &&
          Array.isArray(documentIds) &&
          documentIds.length > 0 && {
            attachedDocuments: {
              connect: documentIds.map((id: string) => ({ id })),
            },
          }),
      },
    });

    // 6. Mark Invitation as ACCEPTED if it exists
    await prisma.jobInvitation.updateMany({
      where: {
        jobId,
        professionalId: userId,
        status: 'PENDING',
      },
      data: {
        status: 'ACCEPTED',
      },
    });

    // 7. Log Activity
    await logActivity({
      action: 'JOB_APPLY',
      actorId: userId,
      actorType: ActorType.PROFESSIONAL,
      targetId: application.id,
      targetType: 'JobApplication',
      status: 'SUCCESS',
      metadata: { jobId: job.id, jobTitle: job.title },
    });

    res.status(201).json({
      status: 'success',
      data: { application },
    });
  },
);

/**
 * Get Application Status (for Professional)
 */
export const getMyApplicationStatus = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id: jobId } = req.params;
    const userId = req.user?.id;
    if (!userId) return next(new AppError('Unauthorized', 401));

    const application = await prisma.jobApplication.findUnique({
      where: {
        jobId_professionalId: {
          jobId,
          professionalId: userId,
        },
      },
      select: { status: true, createdAt: true, id: true },
    });

    if (!application) {
      return res.status(200).json({
        status: 'success',
        data: { applied: false },
      });
    }

    res.status(200).json({
      status: 'success',
      data: { applied: true, application },
    });
  },
);

/**
 * Get My Applications (Professional)
 */
export const getMyApplications = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const userId = req.user?.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [applications, total] = await Promise.all([
      prisma.jobApplication.findMany({
        where: { professionalId: userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          job: {
            select: {
              id: true,
              title: true,
              location: true,
              contractType: true,
              recruiter: { select: { organizationName: true } },
            },
          },
        },
      }),
      prisma.jobApplication.count({ where: { professionalId: userId } }),
    ]);

    res.status(200).json({
      status: 'success',
      results: applications.length,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      data: { applications },
    });
  },
);

/**
 * Get Application Details (Common)
 */
export const getApplicationDetails = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const isAdminViewer = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(
      userRole || '',
    );

    const application = await prisma.jobApplication.findUnique({
      where: { id },
      include: {
        job: true,
        attachedDocuments: true,
        professional: {
          select: {
            id: true,
            fullname: true,
            email: true,
            profession: true,
            profilePhotoUrl: true,
            cvUrl: true,
            lastCoverLetter: true,
            idPassportUrl: true,
            kyc: {
              select: {
                status: true,
                documentType: true,
                documentNumber: true,
                expiryDate: true,
              },
            },
            documents: true,
            resume: {
              include: {
                education: true,
                licenses: true,
                medicalCertificates: true,
                stcwCertificates: true,
                travelDocuments: true,
                skills: true,
                seaService: true,
                nextOfKin: true,
                referees: true,
              },
            },
          },
        },
      },
    });

    if (!application) return next(new AppError('Application not found', 404));

    if (!isAdminViewer && application.job.recruiterId !== userId) {
      return next(new AppError('Not authorized to view this application', 403));
    }

    // Calculate derived UI data
    const snapshotResume =
      application.resumeSnapshot &&
      typeof application.resumeSnapshot === 'object' &&
      !Array.isArray(application.resumeSnapshot)
        ? (application.resumeSnapshot as Record<string, unknown>)
        : null;
    type ResumeSeaService = NonNullable<
      typeof application.professional.resume
    >['seaService'];
    const snapshotSeaService = Array.isArray(snapshotResume?.seaService)
      ? (snapshotResume.seaService as ResumeSeaService)
      : [];
    const seaService = isAdminViewer
      ? application.professional.resume?.seaService || snapshotSeaService
      : snapshotSeaService;
    const experienceSummary = getExperienceSummary(seaService);
    const isVerified =
      application.professional.kyc?.status === RecruiterStatus.APPROVED;

    const responseApplication = isAdminViewer
      ? application
      : {
          ...application,
          professional: {
            id: application.professional.id,
            fullname: application.professional.fullname,
            email: application.professional.email,
            profession: application.professional.profession,
            profilePhotoUrl: application.professional.profilePhotoUrl,
            idPassportUrl: application.professional.idPassportUrl,
            kyc: application.professional.kyc,
          },
        };

    res.status(200).json({
      status: 'success',
      data: {
        application: responseApplication,
        derived: {
          experienceSummary,
          isVerified,
          totalSeaTime: calculateTotalSeaTime(seaService),
        },
      },
    });
  },
);

/**
 * Withdraw Application (Professional)
 */
export const withdrawApplication = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const userId = req.user?.id;

    const application = await prisma.jobApplication.findUnique({
      where: { id },
    });
    if (!application) return next(new AppError('Application not found', 404));

    if (application.professionalId !== userId)
      return next(new AppError('Unauthorized', 403));

    const updated = await prisma.jobApplication.update({
      where: { id },
      data: { status: ApplicationStatus.WITHDRAWN },
    });

    res.status(200).json({
      status: 'success',
      message: 'Application withdrawn',
      data: { application: updated },
    });
  },
);

/**
 * Update Application Status (Recruiter)
 */
export const updateApplicationStatus = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user?.id;
    const normalizedStatus = normalizeApplicationStatus(status);

    // Validate Status Enum
    if (!normalizedStatus) {
      return next(new AppError('Invalid status', 400));
    }

    // Ensure Recruiter owns the job
    const application = await prisma.jobApplication.findUnique({
      where: { id },
      include: { job: true },
    });

    if (!application) return next(new AppError('Application not found', 404));

    // Ensure user has authority to update this application
    const isRecruiter = !['SUPER_ADMIN', 'ADMIN'].includes(
      req.user?.role as string,
    );
    if (isRecruiter && application.job.recruiterId !== userId) {
      return next(new AppError('Not authorized to update this status', 403));
    }

    const updated = await prisma.jobApplication.update({
      where: { id },
      data: { status: normalizedStatus },
    });

    const statusMessages: Record<ApplicationStatus, string> = {
      [ApplicationStatus.APPLIED]: 'Your application was marked as applied.',
      [ApplicationStatus.UNDER_REVIEW]: 'Your application is now under review.',
      [ApplicationStatus.SHORTLISTED]: 'Good news. You have been shortlisted.',
      [ApplicationStatus.INTERVIEW]:
        'Your application has moved to interview stage.',
      [ApplicationStatus.OFFER]: 'You received an offer for this job.',
      [ApplicationStatus.HIRED]:
        'Congratulations. You have been marked as hired.',
      [ApplicationStatus.REJECTED]:
        'Your application was not selected this time.',
      [ApplicationStatus.WITHDRAWN]:
        'Your application was marked as withdrawn.',
    };

    const alert = await prisma.alert.create({
      data: {
        professionalId: application.professionalId,
        type: 'JOB_APPLICATION_STATUS',
        title: 'Application Status Updated',
        message: `${statusMessages[normalizedStatus]} Job: "${application.job.title}".`,
        metadata: {
          applicationId: application.id,
          jobId: application.jobId,
          status: normalizedStatus,
        },
      },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(application.professionalId).emit('professional_alert', {
        alert,
      });
    }

    // Log for Recruiter activity
    if (userId) {
      const actorType = ['SUPER_ADMIN', 'ADMIN'].includes(
        req.user?.role as string,
      )
        ? ActorType.ADMIN
        : ActorType.RECRUITER;

      await logActivity({
        action: 'APPLICATION_STATUS_UPDATE',
        actorId: userId,
        actorType,
        targetId: application.id,
        targetType: 'JobApplication',
        status: 'SUCCESS',
        metadata: {
          requestedStatus: status,
          newStatus: normalizedStatus,
          jobId: application.jobId,
        },
      });
    }

    res.status(200).json({
      status: 'success',
      data: { application: updated },
    });
  },
);

/**
 * Get Job Applicants (Recruiter)
 */
export const getJobApplicants = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id: jobId } = req.params;

    // Filters
    const { status } = req.query;

    const where: Prisma.JobApplicationWhereInput = { jobId };
    if (status) {
      const normalizedStatus = normalizeApplicationStatus(status);
      if (!normalizedStatus) {
        return next(new AppError('Invalid status', 400));
      }
      where.status = normalizedStatus;
    }

    const applicants = await prisma.jobApplication.findMany({
      where,
      include: {
        attachedDocuments: true,
        professional: {
          select: {
            id: true,
            fullname: true,
            email: true,
            profession: true,
            profilePhotoUrl: true,
            idPassportUrl: true, // For avatar
            cvUrl: true,
            kyc: { select: { status: true } },
            documents: {
              select: {
                id: true,
                expiryDate: true,
              },
            },
            resume: {
              include: {
                education: true,
                licenses: true,
                medicalCertificates: true,
                stcwCertificates: true,
                travelDocuments: true,
                skills: true,
                seaService: true,
                nextOfKin: true,
                referees: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const enhancedApplicants = applicants.map((app) => {
      const seaService = app.professional.resume?.seaService || [];
      const { years } = calculateTotalSeaTime(seaService);
      const isVerified =
        app.professional.kyc?.status === RecruiterStatus.APPROVED;
      const docs = Array.isArray(app.professional.documents)
        ? app.professional.documents
        : [];
      const hasExpiredDocs = docs.some(
        (doc) => doc.expiryDate && new Date(doc.expiryDate) < new Date(),
      );
      const compliance =
        !isVerified || docs.length === 0
          ? 'Not Deployable'
          : hasExpiredDocs
            ? 'Expiring Soon'
            : 'Ready';
      const complianceSubtext =
        compliance === 'Ready'
          ? 'Ready to deploy'
          : compliance === 'Expiring Soon'
            ? 'Renewals needed'
            : 'Missing critical certs';

      return {
        ...app,
        professional: {
          ...app.professional,
          totalYearsExperience: years,
          isVerified,
          location: app.professional.resume?.country || 'Global',
          compliance,
          complianceSubtext,
        },
      };
    });

    res.status(200).json({
      status: 'success',
      results: enhancedApplicants.length,
      data: { applicants: enhancedApplicants },
    });
  },
);
