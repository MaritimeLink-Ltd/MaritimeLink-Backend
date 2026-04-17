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

    // 2. Determine final values (prioritize req.body, fallback to profile)
    // Note: If coverLetterUrl is provided, it means they uploaded a file for the cover letter
    const finalCoverLetter = coverLetter || professional.lastCoverLetter;
    const finalCvUrl = cvUrl || professional.cvUrl;

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

    // 6. Update Professional profile for future reuse if new data provided
    if (coverLetter || cvUrl) {
      await prisma.professional.update({
        where: { id: userId },
        data: {
          lastCoverLetter: coverLetter || undefined,
          cvUrl: cvUrl || undefined,
        },
      });
    }

    // 7. Mark Invitation as ACCEPTED if it exists
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

    // 8. Log Activity
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
    // const userId = req.user?.id; // Could be Pro, Recruiter, or Admin

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
                skills: true,
                seaService: true,
              },
            },
          },
        },
      },
    });

    if (!application) return next(new AppError('Application not found', 404));

    // Calculate derived UI data
    const seaService = application.professional.resume?.seaService || [];
    const experienceSummary = getExperienceSummary(seaService);
    const isVerified =
      application.professional.kyc?.status === RecruiterStatus.APPROVED;

    res.status(200).json({
      status: 'success',
      data: {
        application,
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

    // Validate Status Enum
    if (!Object.values(ApplicationStatus).includes(status)) {
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
      data: { status },
    });

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
        metadata: { newStatus: status, jobId: application.jobId },
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
  async (req: CustomRequest, res: Response) => {
    const { id: jobId } = req.params;

    // Filters
    const { status } = req.query;

    const where: Prisma.JobApplicationWhereInput = { jobId };
    if (status) where.status = status as ApplicationStatus;

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
            resume: {
              include: {
                seaService: true,
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

      return {
        ...app,
        professional: {
          ...app.professional,
          totalYearsExperience: years,
          isVerified,
          location: app.professional.resume?.country || 'Global',
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
