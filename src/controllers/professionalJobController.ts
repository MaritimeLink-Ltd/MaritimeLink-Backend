import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';

export const toggleSaveJob = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id: jobId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return next(new AppError('Job not found', 404));
    }

    // Check if already saved
    const existingSave = await prisma.savedJob.findUnique({
      where: {
        professionalId_jobId: {
          professionalId: userId,
          jobId: jobId,
        },
      },
    });

    if (existingSave) {
      // Unsave
      await prisma.savedJob.delete({
        where: {
          id: existingSave.id,
        },
      });

      return res.status(200).json({
        status: 'success',
        message: 'Job unsaved successfully',
        data: { isSaved: false },
      });
    } else {
      // Save
      await prisma.savedJob.create({
        data: {
          professionalId: userId,
          jobId: jobId,
        },
      });

      return res.status(201).json({
        status: 'success',
        message: 'Job saved successfully',
        data: { isSaved: true },
      });
    }
  },
);

export const getSavedJobs = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const userId = req.user?.id;

    const savedJobs = await prisma.savedJob.findMany({
      where: { professionalId: userId },
      include: {
        job: {
          include: {
            recruiter: {
              select: { organizationName: true, email: true },
            },
            admin: {
              select: { email: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      results: savedJobs.length,
      data: {
        jobs: savedJobs.map((sj) => sj.job),
      },
    });
  },
);
