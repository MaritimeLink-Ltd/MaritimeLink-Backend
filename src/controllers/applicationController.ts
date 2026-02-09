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
} from '../generated/client/index.js';

export const applyToJob = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id: jobId } = req.params;
    const { coverLetter } = req.body;
    const userId = req.user?.id;

    if (!userId) return next(new AppError('Unauthorized', 401));

    // 1. Check if Job exists
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return next(new AppError('Job not found', 404));

    // 2. Check if already applied
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

    // 3. Get Resume Snapshot (Optional: Fetch profile/resume data to snapshot)
    // For now, we just proceed. Ideally we'd fetch `prisma.professionalResume.findUnique...`

    // 4. Create Application
    const application = await prisma.jobApplication.create({
      data: {
        jobId,
        professionalId: userId,
        coverLetter,
        status: ApplicationStatus.APPLIED,
      },
    });

    // 5. Log Activity
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
        professional: {
          select: {
            id: true,
            fullname: true,
            email: true,
            profession: true,
            resume: { select: { summary: true, skills: true } }, // Basic info
          },
        },
      },
    });

    if (!application) return next(new AppError('Application not found', 404));

    // Access Control can be refined here if strict checks needed beyond Auth Middleware
    // E.g., if Recruiter, verify they own the job.

    res.status(200).json({
      status: 'success',
      data: { application },
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

    // If Admin, bypass check. If Recruiter, check ownership.
    // const isRecruiter = req.user?.role && !['SUPER_ADMIN', 'ADMIN'].includes(req.user.role as string);
    // Basic check: if job.recruiterId !== userId (and user is recruiter) -> Error
    // NOTE: Type casting for user role if needed or rely on middleware context
    // Ideally we check:
    /*
    if (user.role === 'RECRUITMENT_AGENT' && application.job.recruiterId !== userId) {
       throw error
    }
    */

    const updated = await prisma.jobApplication.update({
      where: { id },
      data: { status },
    });

    // Log for Recruiter activity
    if (userId) {
      await logActivity({
        action: 'APPLICATION_STATUS_UPDATE',
        actorId: userId,
        actorType: ActorType.RECRUITER, // Simplification, could be Admin
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
        professional: {
          select: {
            id: true,
            fullname: true,
            email: true,
            profession: true,
            idPassportUrl: true, // For avatar
            resume: { select: { summary: true, overallSize: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      results: applicants.length,
      data: { applicants },
    });
  },
);
