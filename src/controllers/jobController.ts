import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import {
  Prisma,
  JobCategory,
  JobType,
  JobStatus,
} from '../generated/client/index.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { logActivity } from '../services/activityLogger.js';
import { ActorType, ActionStatus } from '../generated/client/index.js';
import { getClientIp } from '../utils/requestMetadata.js';
import {
  notifyJobPublished,
  safeNotify,
} from '../services/eventNotificationService.js';
import {
  createJobSchema,
  updateJobSchema,
  updateJobStatusSchema,
} from '../validations/jobValidation.js';
import { RECRUITER_FREE_ACTIVE_JOB_LIMIT } from '../utils/recruiterCapabilities.js';

const normalizeFieldValue = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.trim();
  return value ?? null;
};

const PLATFORM_ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'] as const;

const isPlatformAdminRole = (role?: string) =>
  PLATFORM_ADMIN_ROLES.includes(
    (role || '') as (typeof PLATFORM_ADMIN_ROLES)[number],
  );

/** Recruiters own recruiterId rows; platform admins manage MaritimeLink (adminId) listings. */
const canManageJob = (
  job: { adminId: string | null; recruiterId: string | null },
  userId: string,
  userRole?: string,
): boolean => {
  if (isPlatformAdminRole(userRole)) {
    if (job.adminId) return true;
    if (!job.recruiterId) return true;
    return false;
  }
  return job.recruiterId === userId;
};

const resolveEffectiveJobStatus = <
  T extends { status: JobStatus; closingDate?: Date | null },
>(
  job: T,
): T & { status: JobStatus } => {
  if (
    job.status === JobStatus.ACTIVE &&
    job.closingDate &&
    new Date(job.closingDate).getTime() < Date.now()
  ) {
    return {
      ...job,
      status: JobStatus.EXPIRED,
    };
  }

  return {
    ...job,
    status: job.status,
  };
};

/**
 * Non-Premium recruiters may only have one ACTIVE job listing at a time
 * (Free and Flex tiers both cap at 1 — Flex only unlocks per-listing features,
 * not additional concurrent listings). `excludeJobId` lets updateJobStatus
 * re-check without counting the job being activated against itself.
 */
const assertRecruiterCanActivateJob = async (
  recruiterId: string,
  excludeJobId?: string,
) => {
  const recruiter = await prisma.recruiter.findUnique({
    where: { id: recruiterId },
    select: { tier: true },
  });

  if (recruiter?.tier === 'PREMIUM') return;

  const activeJobCount = await prisma.job.count({
    where: {
      recruiterId,
      status: JobStatus.ACTIVE,
      ...(excludeJobId ? { id: { not: excludeJobId } } : {}),
    },
  });

  if (activeJobCount >= RECRUITER_FREE_ACTIVE_JOB_LIMIT) {
    throw new AppError(
      'Your plan allows only 1 active job listing at a time. Upgrade to Premium Recruiter for unlimited active listings.',
      403,
      'RECRUITER_JOB_LIMIT',
    );
  }
};

/**
 * Create a new job post
 */
export const createJob = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const validatedData = createJobSchema.parse(req.body);
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!userId || !userRole) {
      return next(new AppError('User context missing', 400));
    }

    const isAdmin = isPlatformAdminRole(userRole);

    if (!isAdmin && validatedData.status === JobStatus.ACTIVE) {
      await assertRecruiterCanActivateJob(userId);
    }

    const { closingDate, ...jobData } = validatedData;
    const job = await prisma.job.create({
      data: {
        ...jobData,
        closingDate: closingDate ? new Date(closingDate) : null,
        adminId: isAdmin ? userId : null,
        recruiterId: !isAdmin ? userId : null,
      },
    });

    await logActivity({
      action: 'JOB_CREATED',
      actorId: userId,
      actorType: isAdmin ? ActorType.ADMIN : ActorType.RECRUITER,
      targetId: job.id,
      targetType: 'Job',
      status: ActionStatus.SUCCESS,
      ipAddress: getClientIp(req),
      userAgent: req.get('user-agent') || undefined,
      metadata: {
        jobTitle: job.title,
        jobCategory: job.category,
        jobType: job.contractType,
        location: job.location,
      },
    });

    if (job.status === JobStatus.ACTIVE && job.recruiterId) {
      safeNotify('job-published', () => notifyJobPublished(job.id));
    }

    res.status(201).json({
      status: 'success',
      data: { job },
    });
  },
);

/**
 * Get all job posts (Public with Filters)
 */
export const getJobs = catchAsync(async (req: CustomRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const { category, jobType, datePosted, search, role } = req.query;
  const userRole = req.user?.role;
  const isInternalViewer = [
    'SUPER_ADMIN',
    'ADMIN',
    'MODERATOR',
    'RECRUITER',
  ].includes(userRole || '');

  // Build filters
  const where: Prisma.JobWhereInput = {};

  if (isInternalViewer) {
    where.status = {
      in: [JobStatus.ACTIVE, JobStatus.FILLED, JobStatus.EXPIRED],
    };
  } else {
    where.status = JobStatus.ACTIVE;
    where.AND = [
      {
        OR: [
          { closingDate: null },
          {
            closingDate: {
              gte: new Date(),
            },
          },
        ],
      },
    ];
  }

  if (category) {
    where.category = category as JobCategory;
  }

  if (jobType) {
    where.contractType = jobType as JobType;
  }

  if (datePosted) {
    const now = new Date();
    if (datePosted === '24h') {
      where.createdAt = { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) };
    } else if (datePosted === '7d') {
      where.createdAt = {
        gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      };
    } else if (datePosted === '30d') {
      where.createdAt = {
        gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      };
    }
  }

  if (search || role) {
    const text = String(search || role || '').trim();
    if (text) {
      const textFilters: Prisma.JobWhereInput[] = [
        { title: { contains: text, mode: 'insensitive' } },
        { description: { contains: text, mode: 'insensitive' } },
        {
          recruiter: {
            is: {
              organizationName: { contains: text, mode: 'insensitive' },
            },
          },
        },
        {
          admin: {
            is: {
              email: { contains: text, mode: 'insensitive' },
            },
          },
        },
      ];

      const existingAnd = Array.isArray(where.AND)
        ? where.AND
        : where.AND
          ? [where.AND]
          : [];
      where.AND = [...existingAnd, { OR: textFilters }];
    }
  }

  // Check filters before query

  // Default: Exclude Flagged Jobs from public feed unless requested by Admin?
  // Or filter logic: if not admin, isFlagged: false.
  // We can't easily check 'admin' context here without passing it down or assuming public.
  // Generally, public feeds should NOT show flagged jobs.
  if (!where.isFlagged) {
    where.isFlagged = false;
  }

  const jobs = await prisma.job.findMany({
    where,
    skip,
    take: limit,
    include: {
      recruiter: {
        select: { organizationName: true, email: true, tier: true },
      },
      admin: {
        select: { email: true },
      },
    },
    // Premium Recruiter listings surface first (priority listing perk), then newest first.
    orderBy: [{ recruiter: { tier: 'desc' } }, { createdAt: 'desc' }],
  });

  const jobsWithEffectiveStatus = jobs.map((job) => ({
    ...resolveEffectiveJobStatus(job),
    isPremiumRecruiter: job.recruiter?.tier === 'PREMIUM',
  }));
  const filteredJobs = isInternalViewer
    ? jobsWithEffectiveStatus
    : jobsWithEffectiveStatus.filter(
        (job) =>
          job.status === JobStatus.ACTIVE &&
          (!job.closingDate ||
            new Date(job.closingDate).getTime() >= Date.now()),
      );
  const total = isInternalViewer
    ? await prisma.job.count({ where })
    : await prisma.job.count({ where });

  res.status(200).json({
    status: 'success',
    results: filteredJobs.length,
    total,
    data: { jobs: filteredJobs },
  });
});

/**
 * Get a single job by ID
 */
export const getJobById = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const isInternalViewer = [
      'SUPER_ADMIN',
      'ADMIN',
      'MODERATOR',
      'RECRUITER',
    ].includes(userRole || '');

    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        recruiter: {
          select: {
            organizationName: true,
            email: true,
            website: true,
            address: true,
            tier: true,
          },
        },
        admin: {
          select: { email: true },
        },
      },
    });

    if (!job) {
      return next(new AppError('Job not found', 404));
    }

    const effectiveJob = {
      ...resolveEffectiveJobStatus(job),
      isPremiumRecruiter: job.recruiter?.tier === 'PREMIUM',
    };
    if (!isInternalViewer && effectiveJob.status !== JobStatus.ACTIVE) {
      return next(new AppError('Job not found', 404));
    }

    // If the viewer is a logged-in professional, include application & saved status
    let hasApplied = false;
    let applicationStatus: string | null = null;
    let applicationRejectionReason: string | null = null;
    let applicationId: string | null = null;
    let isSaved = false;

    if (userId) {
      const [application, savedJob] = await Promise.all([
        prisma.jobApplication.findUnique({
          where: {
            jobId_professionalId: {
              jobId: id,
              professionalId: userId,
            },
          },
          select: { id: true, status: true, rejectionReason: true },
        }),
        prisma.savedJob.findUnique({
          where: {
            professionalId_jobId: {
              professionalId: userId,
              jobId: id,
            },
          },
          select: { id: true },
        }),
      ]);

      if (application) {
        hasApplied = true;
        applicationStatus = application.status;
        applicationRejectionReason = application.rejectionReason || null;
        applicationId = application.id;
      }
      isSaved = !!savedJob;
    }

    res.status(200).json({
      status: 'success',
      data: {
        job: effectiveJob,
        hasApplied,
        applicationStatus,
        applicationRejectionReason,
        applicationId,
        isSaved,
      },
    });
  },
);

/**
 * Get jobs created by current user
 */
export const getMyJobs = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(
      userRole || '',
    );

    const jobs = await prisma.job.findMany({
      where: isAdmin ? { adminId: userId } : { recruiterId: userId },
      include: {
        _count: {
          select: {
            applications: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const jobsWithApplicantCounts = jobs.map((job) => ({
      ...resolveEffectiveJobStatus(job),
      applicantCount: job._count.applications,
      applicantsCount: job._count.applications,
    }));

    res.status(200).json({
      status: 'success',
      results: jobsWithApplicantCounts.length,
      data: { jobs: jobsWithApplicantCounts },
    });
  },
);

/**
 * Update only the status of a job post
 */
export const updateJobStatus = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { status } = updateJobStatusSchema.parse(req.body);
    const userId = req.user?.id;
    const userRole = req.user?.role;

    const job = await prisma.job.findUnique({
      where: { id },
    });

    if (!job) {
      return next(new AppError('Job not found', 404));
    }

    if (!userId || !canManageJob(job, userId, userRole)) {
      return next(new AppError('Unauthorized', 403));
    }

    if (
      !isPlatformAdminRole(userRole) &&
      status === JobStatus.ACTIVE &&
      job.status !== JobStatus.ACTIVE &&
      job.recruiterId
    ) {
      await assertRecruiterCanActivateJob(job.recruiterId, job.id);
    }

    const updatedJob = await prisma.job.update({
      where: { id },
      data: { status },
    });

    if (
      job.status === JobStatus.DRAFT &&
      updatedJob.status === JobStatus.ACTIVE &&
      updatedJob.recruiterId
    ) {
      safeNotify('job-published', () => notifyJobPublished(updatedJob.id));
    }

    res.status(200).json({
      status: 'success',
      data: { job: resolveEffectiveJobStatus(updatedJob) },
    });
  },
);

/**
 * Update a job post
 */
export const updateJob = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const validatedData = updateJobSchema.parse(req.body);
    const userId = req.user?.id;
    const userRole = req.user?.role;

    const job = await prisma.job.findUnique({
      where: { id },
    });

    if (!job) {
      return next(new AppError('Job not found', 404));
    }

    if (!userId || !canManageJob(job, userId, userRole)) {
      return next(new AppError('Unauthorized', 403));
    }

    const { closingDate } = validatedData;
    const changedFields = Object.entries(validatedData).reduce<string[]>(
      (fields, [key, value]) => {
        const previousValue =
          key === 'closingDate'
            ? job.closingDate
            : job[key as keyof typeof job];
        const nextValue =
          key === 'closingDate' && value ? new Date(value) : value;

        if (
          normalizeFieldValue(previousValue) !== normalizeFieldValue(nextValue)
        ) {
          fields.push(key);
        }

        return fields;
      },
      [],
    );

    const updatedJob = await prisma.job.update({
      where: { id },
      data: {
        ...validatedData,
        closingDate: closingDate ? new Date(closingDate) : undefined,
      },
    });

    if (changedFields.length > 0) {
      const applicants = await prisma.jobApplication.findMany({
        where: { jobId: id },
        select: {
          id: true,
          professionalId: true,
        },
      });

      if (applicants.length > 0) {
        const io = req.app.get('io');
        const recruiterName = job.recruiterId
          ? (
              await prisma.recruiter.findUnique({
                where: { id: job.recruiterId },
                select: { organizationName: true },
              })
            )?.organizationName || 'The recruiter'
          : 'MaritimeLink Admin';

        const alerts = await Promise.all(
          applicants.map((application) =>
            prisma.alert.create({
              data: {
                professionalId: application.professionalId,
                type: 'JOB_UPDATED',
                title: 'Job Updated',
                message: `${recruiterName} updated a job you applied for: "${updatedJob.title}".`,
                metadata: {
                  jobId: updatedJob.id,
                  applicationId: application.id,
                  changedFields,
                },
              },
            }),
          ),
        );

        if (io) {
          alerts.forEach((alert) => {
            io.to(alert.professionalId).emit('professional_alert', {
              alert,
            });
          });
        }
      }
    }

    res.status(200).json({
      status: 'success',
      data: { job: updatedJob },
    });
  },
);

/**
 * Delete a job post
 */
export const deleteJob = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    const job = await prisma.job.findUnique({
      where: { id },
    });

    if (!job) {
      return next(new AppError('Job not found', 404));
    }

    if (!userId || !canManageJob(job, userId, userRole)) {
      return next(new AppError('Unauthorized', 403));
    }

    await prisma.job.delete({
      where: { id },
    });

    res.status(204).json({
      status: 'success',
      data: null,
    });
  },
);

/**
 * Admin: Get Flagged Jobs
 */
export const getFlaggedJobs = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const jobs = await prisma.job.findMany({
      where: { isFlagged: true },
      skip,
      take: limit,
      include: {
        recruiter: { select: { organizationName: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const total = await prisma.job.count({ where: { isFlagged: true } });

    res.status(200).json({
      status: 'success',
      results: jobs.length,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      data: { jobs },
    });
  },
);

/**
 * Admin: Toggle Job Flag (Moderation)
 */
export const toggleJobFlag = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) return next(new AppError('Job not found', 404));

    const updatedJob = await prisma.job.update({
      where: { id },
      data: { isFlagged: !job.isFlagged },
    });

    // Log moderation action
    await logActivity({
      action: updatedJob.isFlagged ? 'JOB_FLAGGED' : 'JOB_UNFLAGGED',
      actorId: req.user!.id,
      actorType: ActorType.ADMIN,
      targetId: job.id,
      targetType: 'Job',
      status: 'SUCCESS',
    });

    res.status(200).json({
      status: 'success',
      message: updatedJob.isFlagged
        ? 'Job is now flagged and hidden from main feed.'
        : 'Job unflagged.',
      data: { job: updatedJob },
    });
  },
);
