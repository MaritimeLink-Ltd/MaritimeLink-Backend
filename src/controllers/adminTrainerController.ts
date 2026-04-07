import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';

export const getTrainers = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const trainers = await prisma.recruiter.findMany({
      where: { role: 'TRAINING_AGENT' },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    const total = await prisma.recruiter.count({
      where: { role: 'TRAINING_AGENT' },
    });

    res.status(200).json({
      status: 'success',
      results: trainers.length,
      total,
      data: { trainers },
    });
  },
);

export const getTrainerById = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const trainer = await prisma.recruiter.findUnique({
      where: { id, role: 'TRAINING_AGENT' },
      include: {
        kyc: true,
        courses: true,
      },
    });

    if (!trainer) {
      return next(new AppError('Trainer not found', 404));
    }

    res.status(200).json({ status: 'success', data: { trainer } });
  },
);
