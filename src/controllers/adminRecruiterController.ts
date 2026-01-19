import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';

export const getRecruiters = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const recruiters = await prisma.recruiter.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        organizationName: true,
        status: true,
        isVerified: true,
        createdAt: true,
      },
    });

    const total = await prisma.recruiter.count();

    res.status(200).json({
      status: 'success',
      results: recruiters.length,
      total,
      data: {
        recruiters,
      },
    });
  },
);

export const getRecruiterStats = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const total = await prisma.recruiter.count();
    const pending = await prisma.recruiter.count({
      where: { status: 'PENDING' },
    });
    const approved = await prisma.recruiter.count({
      where: { status: 'APPROVED' },
    });
    const rejected = await prisma.recruiter.count({
      where: { status: 'REJECTED' },
    });
    const verified = await prisma.recruiter.count({
      where: { isVerified: true },
    });

    res.status(200).json({
      status: 'success',
      data: {
        total,
        pending,
        approved,
        rejected,
        verified,
      },
    });
  },
);

export const getRecruiterById = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const recruiter = await prisma.recruiter.findUnique({
      where: { id },
    });

    if (!recruiter) {
      return next(new AppError('Recruiter not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: {
        recruiter,
      },
    });
  },
);

export const updateRecruiterStatus = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { status } = req.body; // APPROVED or REJECTED

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return next(new AppError('Invalid status', 400));
    }

    const recruiter = await prisma.recruiter.update({
      where: { id },
      data: { status },
    });

    res.status(200).json({
      status: 'success',
      message: `Recruiter login status updated to ${status}`,
      data: {
        recruiter,
      },
    });
  },
);
