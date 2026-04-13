import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { KycRiskLevel, VerificationStatus } from '../generated/client/index.js';

const resolveProfessionalRiskLevel = (professional: {
  kyc: { riskLevel: KycRiskLevel } | null;
  documents: { id: string }[];
}) => {
  if (professional.documents.length > 0) {
    return KycRiskLevel.HIGH;
  }

  return professional.kyc?.riskLevel ?? KycRiskLevel.LOW;
};

/**
 * Get all professionals with filtering and pagination
 */
export const getProfessionals = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const { status, tier, search } = req.query;

    const where: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (status) where.status = status;
    if (tier) where.tier = tier;
    if (search) {
      where.OR = [
        { fullname: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const professionals = await prisma.professional.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fullname: true,
        email: true,
        status: true,
        tier: true,
        lastActive: true,
        createdAt: true,
        isVerified: true,
        profilePhotoUrl: true,
        kyc: {
          select: {
            riskLevel: true,
            mismatchDetected: true,
            mismatchDetails: true,
          },
        },
        documents: {
          where: {
            verificationStatus: VerificationStatus.MISMATCH,
          },
          select: {
            id: true,
          },
          take: 1,
        },
        resume: {
          select: {
            country: true,
          },
        },
      },
    });

    const total = await prisma.professional.count({ where });

    const professionalsWithRisk = professionals.map((professional) => {
      const { documents, ...professionalData } = professional;

      return {
        ...professionalData,
        riskLevel: resolveProfessionalRiskLevel({ ...professional, documents }),
        hasDocumentMismatch: documents.length > 0,
      };
    });

    res.status(200).json({
      status: 'success',
      results: professionalsWithRisk.length,
      total,
      data: {
        professionals: professionalsWithRisk,
      },
    });
  },
);

/**
 * Get professional statistics for dashboard
 */
export const getProfessionalStats = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const total = await prisma.professional.count();
    const pending = await prisma.professional.count({
      where: { status: 'PENDING' },
    });
    const verified = await prisma.professional.count({
      where: { status: 'VERIFIED' },
    });
    const flagged = await prisma.professional.count({
      where: { status: 'FLAGGED' },
    });
    const blocked = await prisma.professional.count({
      where: { status: 'BLOCKED' },
    });

    res.status(200).json({
      status: 'success',
      data: {
        total,
        pending,
        verified,
        flagged,
        blocked,
      },
    });
  },
);

export const getPendingKYCs = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const kycs = await prisma.professionalKyc.findMany({
      where: { status: 'PENDING' },
      include: {
        professional: {
          select: {
            fullname: true,
            email: true,
            resume: {
              select: {
                country: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      results: kycs.length,
      data: {
        kycs,
      },
    });
  },
);

/**
 * Update Professional KYC status (Approve/Reject)
 */
export const updateKYCStatus = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params; // professionalId
    const { status } = req.body; // APPROVED or REJECTED

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return next(new AppError('Invalid status', 400));
    }

    const kyc = await prisma.professionalKyc.update({
      where: { professionalId: id },
      data: { status },
    });

    // If KYC is approved, update professional status to VERIFIED
    if (status === 'APPROVED') {
      await prisma.professional.update({
        where: { id },
        data: { status: 'VERIFIED', isVerified: true },
      });
    }

    res.status(200).json({
      status: 'success',
      message: `Professional KYC status updated to ${status}`,
      data: {
        kyc,
      },
    });
  },
);

/**
 * Get detailed professional by ID, including complete relations
 */
export const getProfessionalById = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const professional = await prisma.professional.findUnique({
      where: { id },
      include: {
        kyc: true,
        resume: true,
        documents: true,
        bookings: true,
        savedCourses: true,
        applications: true,
      },
    });

    if (!professional) {
      return next(new AppError('Professional not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: {
        professional,
      },
    });
  },
);
