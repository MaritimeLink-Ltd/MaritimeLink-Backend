import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { KycRiskLevel } from '../generated/client/index.js';

const resolveTrainerRiskLevel = (trainer: {
  organizationRiskLevel?: KycRiskLevel | null;
  kyc: { riskLevel: KycRiskLevel } | null;
}) =>
  trainer.kyc?.riskLevel === KycRiskLevel.HIGH ||
  trainer.organizationRiskLevel === KycRiskLevel.HIGH
    ? KycRiskLevel.HIGH
    : (trainer.kyc?.riskLevel ??
      trainer.organizationRiskLevel ??
      KycRiskLevel.LOW);

const resolveTrainerMismatch = (trainer: {
  organizationVerified?: boolean | null;
  kyc: { mismatchDetected: boolean } | null;
}) =>
  Boolean(trainer.kyc?.mismatchDetected) ||
  trainer.organizationVerified === false;

export const getTrainers = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const trainers = await prisma.recruiter.findMany({
      where: { role: 'TRAINING_AGENT' },
      skip,
      take: limit,
      include: { kyc: true },
      orderBy: { createdAt: 'desc' },
    });

    const total = await prisma.recruiter.count({
      where: { role: 'TRAINING_AGENT' },
    });

    const trainersWithRisk = trainers.map((trainer) => ({
      ...trainer,
      riskLevel: resolveTrainerRiskLevel(trainer),
      hasCompanyMismatch: resolveTrainerMismatch(trainer),
    }));

    res.status(200).json({
      status: 'success',
      results: trainersWithRisk.length,
      total,
      data: { trainers: trainersWithRisk },
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

    res.status(200).json({
      status: 'success',
      data: {
        trainer: {
          ...trainer,
          riskLevel: resolveTrainerRiskLevel(trainer),
          hasCompanyMismatch: resolveTrainerMismatch(trainer),
        },
      },
    });
  },
);
