import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { JobStatus } from '../generated/client/index.js';

/**
 * @desc    Get recruiter dashboard stats
 * @route   GET /api/recruiter/dashboard/stats
 * @access  Private (Recruiter)
 */
export const getRecruiterDashboardStats = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    const timeframe = (req.query.timeframe as string) || '7d';

    if (!recruiterId) {
      return next(new AppError('User not authenticated', 401));
    }

    // 1. Timeframe logic
    const now = new Date();
    const startDate = new Date();
    if (timeframe === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (timeframe === '7d') {
      startDate.setDate(now.getDate() - 7);
    } else if (timeframe === '1m') {
      startDate.setMonth(now.getMonth() - 1);
    } else {
      startDate.setDate(now.getDate() - 7); // Default to 7 days
    }

    // 2. Active Jobs
    const activeJobsCount = await prisma.job.count({
      where: { recruiterId, status: JobStatus.ACTIVE },
    });

    // 3. New Applications since timeframe
    const newApplicationsCount = await prisma.jobApplication.count({
      where: {
        job: { recruiterId },
        createdAt: { gte: startDate },
      },
    });

    // 4. Matched Professionals (Not yet applied)
    // Heuristic: Professionals with a profession category matching any of the recruiter's active jobs
    const recruiterJobCategories = (
      await prisma.job.findMany({
        where: { recruiterId, status: JobStatus.ACTIVE },
        select: { category: true },
        distinct: ['category'],
      })
    ).map((j) => j.category);

    const matchedProfessionalsCount =
      recruiterJobCategories.length > 0
        ? await prisma.professional.count({
            where: {
              profession: { in: recruiterJobCategories },
              applications: {
                none: {
                  job: { recruiterId },
                },
              },
            },
          })
        : 0;

    // 5. Jobs Needing Attention
    // Drafts or expiring within 3 days
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(now.getDate() + 3);

    const jobsNeedingAttentionCount = await prisma.job.count({
      where: {
        recruiterId,
        OR: [
          { status: JobStatus.DRAFT },
          {
            status: JobStatus.ACTIVE,
            closingDate: { lte: threeDaysFromNow, gte: now },
          },
        ],
      },
    });

    res.status(200).json({
      status: 'success',
      data: {
        stats: {
          activeJobsCount,
          newApplicationsCount,
          matchedProfessionalsCount,
          jobsNeedingAttentionCount,
        },
      },
    });
  },
);

/**
 * @desc    Get items requiring recruiter action
 * @route   GET /api/recruiter/dashboard/action-items
 * @access  Private (Recruiter)
 */
export const getActionRequiredItems = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) return next(new AppError('User not authenticated', 401));

    const actionItems: {
      type: string;
      message: string;
      action: string;
      jobId?: string;
      category?: string;
    }[] = [];

    // 1. New applicants awaiting review
    const jobsWithNewApplicants = await prisma.job.findMany({
      where: { recruiterId, status: JobStatus.ACTIVE },
      include: {
        _count: {
          select: {
            applications: {
              where: { status: 'APPLIED' },
            },
          },
        },
      },
    });

    jobsWithNewApplicants.forEach((job) => {
      if (job._count.applications > 0) {
        actionItems.push({
          type: 'NEW_APPLICANTS',
          message: `${job._count.applications} new applicants awaiting review for ${job.title}`,
          action: 'VIEW_APPLICANTS',
          jobId: job.id,
        });
      }
    });

    // 2. Matched professionals ready to invite
    // This is more complex, for now we can provide a general message if matched professionals exist
    // Implementation can be refined later
    const recruiterJobCategories = (
      await prisma.job.findMany({
        where: { recruiterId, status: JobStatus.ACTIVE },
        select: { category: true },
        distinct: ['category'],
      })
    ).map((j) => j.category);

    for (const category of recruiterJobCategories) {
      const count = await prisma.professional.count({
        where: {
          profession: category,
          applications: { none: { job: { recruiterId } } },
        },
      });
      if (count > 0) {
        const job = jobsWithNewApplicants.find((j) => j.category === category);
        actionItems.push({
          type: 'MATCHED_PROFESSIONALS',
          message: `${count} matched professionals ready to invite for ${job?.title || category}`,
          action: 'VIEW_MATCHES',
          category,
        });
      }
    }

    // 3. Jobs expiring soon
    const now = new Date();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(now.getDate() + 3);

    const expiringJobs = await prisma.job.findMany({
      where: {
        recruiterId,
        status: JobStatus.ACTIVE,
        closingDate: { lte: threeDaysFromNow, gte: now },
      },
    });

    expiringJobs.forEach((job) => {
      const daysLeft = Math.ceil(
        (job.closingDate!.getTime() - now.getTime()) / (1000 * 3600 * 24),
      );
      actionItems.push({
        type: 'JOB_EXPIRING',
        message: `Job '${job.title}' expires in ${daysLeft} days`,
        action: 'EDIT_JOB',
        jobId: job.id,
      });
    });

    // 4. Jobs with zero applicants
    const zeroApplicantJobs = await prisma.job.findMany({
      where: {
        recruiterId,
        status: JobStatus.ACTIVE,
        applications: { none: {} },
      },
    });

    zeroApplicantJobs.forEach((job) => {
      actionItems.push({
        type: 'ZERO_APPLICANTS',
        message: `Job '${job.title}' has zero applicants`,
        action: 'VIEW_JOB',
        jobId: job.id,
      });
    });

    res.status(200).json({
      status: 'success',
      results: actionItems.length,
      data: { actionItems },
    });
  },
);

/**
 * @desc    Get recruiter's jobs with metrics
 * @route   GET /api/recruiter/dashboard/jobs
 * @access  Private (Recruiter)
 */
export const getRecruiterJobs = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) return next(new AppError('User not authenticated', 401));

    const jobs = await prisma.job.findMany({
      where: { recruiterId },
      include: {
        _count: {
          select: { applications: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch match counts per job (heuristic)
    const enrichedJobs = await Promise.all(
      jobs.map(async (job) => {
        const matchedCount = await prisma.professional.count({
          where: {
            profession: job.category,
            applications: { none: { job: { recruiterId } } },
          },
        });
        return {
          ...job,
          applicantCount: job._count.applications,
          matchedCount,
        };
      }),
    );

    res.status(200).json({
      status: 'success',
      results: enrichedJobs.length,
      data: { jobs: enrichedJobs },
    });
  },
);

/**
 * @desc    Get popular searches (trending jobs)
 * @route   GET /api/recruiter/dashboard/popular-searches
 * @access  Private (Recruiter)
 */
export const getPopularSearches = catchAsync(
  async (req: CustomRequest, res: Response) => {
    res.status(200).json({
      status: 'success',
      data: { popularSearches: [] },
    });
  },
);

export const getRecruiterNotifications = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) return next(new AppError('User not authenticated', 401));

    const now = new Date();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(now.getDate() + 3);

    const [newApplications, expiringJobs, zeroApplicantJobs, draftJobs] =
      await Promise.all([
        prisma.jobApplication.count({
          where: { job: { recruiterId }, status: 'APPLIED' },
        }),
        prisma.job.findMany({
          where: {
            recruiterId,
            status: JobStatus.ACTIVE,
            closingDate: { lte: threeDaysFromNow, gte: now },
          },
          take: 5,
          orderBy: { closingDate: 'asc' },
        }),
        prisma.job.count({
          where: {
            recruiterId,
            status: JobStatus.ACTIVE,
            applications: { none: {} },
          },
        }),
        prisma.job.count({ where: { recruiterId, status: JobStatus.DRAFT } }),
      ]);

    const notifications = [
      {
        id: 'recruiter-announcement',
        type: 'announcement',
        severity: 'info',
        title: 'Recruiter Dashboard Update',
        message:
          'Candidate matching, job action items, and notifications are connected to your live jobs.',
        createdAt: new Date(),
      },
      newApplications > 0
        ? {
            id: 'new-applications',
            type: 'success',
            severity: 'success',
            title: 'New Applications',
            message: `${newApplications} applicants are waiting for review.`,
            createdAt: new Date(),
          }
        : null,
      zeroApplicantJobs > 0
        ? {
            id: 'zero-applicant-jobs',
            type: 'warning',
            severity: 'warning',
            title: 'Jobs Need Attention',
            message: `${zeroApplicantJobs} active jobs have no applicants yet.`,
            createdAt: new Date(),
          }
        : null,
      draftJobs > 0
        ? {
            id: 'draft-jobs',
            type: 'info',
            severity: 'info',
            title: 'Draft Jobs',
            message: `${draftJobs} draft jobs are ready to complete or publish.`,
            createdAt: new Date(),
          }
        : null,
      ...expiringJobs.map((job) => ({
        id: `expiring-${job.id}`,
        type: 'warning',
        severity: 'warning',
        title: 'Job Expiring Soon',
        message: `"${job.title}" expires soon. Renew it to keep receiving applications.`,
        createdAt: new Date(),
      })),
    ].filter(Boolean);

    res.status(200).json({
      status: 'success',
      results: notifications.length,
      data: { notifications },
    });
  },
);
