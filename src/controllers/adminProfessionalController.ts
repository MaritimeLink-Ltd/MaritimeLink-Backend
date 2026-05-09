import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import {
  DocumentCategory,
  KycRiskLevel,
  VerificationStatus,
} from '../generated/client/index.js';

/** Matches admin dashboard expiring-compliance card (past expired + forward window). */
const ADMIN_COMPLIANCE_EXPIRED_LOOKBACK_DAYS = 365;

const resolveProfessionalRiskLevel = (
  kyc: { riskLevel: KycRiskLevel } | null | undefined,
  mismatchDocCount: number,
) => {
  if (mismatchDocCount > 0) {
    return KycRiskLevel.HIGH;
  }

  return kyc?.riskLevel ?? KycRiskLevel.LOW;
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

    const complianceAttention =
      String(req.query.complianceAttention ?? '').toLowerCase() === 'true' ||
      req.query.complianceAttention === '1';

    const requestedTimeframe =
      typeof req.query.timeframe === 'string' ? req.query.timeframe : '30d';
    const tf = String(requestedTimeframe).toLowerCase();
    const daysByTimeframe: Record<string, number> = {
      today: 1,
      '7d': 7,
      '30d': 30,
      '60d': 60,
      '90d': 90,
    };
    const complianceForwardDays = daysByTimeframe[tf] || 30;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const complianceWindowEnd = new Date(todayStart);
    complianceWindowEnd.setDate(
      complianceWindowEnd.getDate() + complianceForwardDays,
    );
    complianceWindowEnd.setHours(23, 59, 59, 999);

    const complianceExpiredLookbackStart = new Date(todayStart);
    complianceExpiredLookbackStart.setDate(
      complianceExpiredLookbackStart.getDate() -
        ADMIN_COMPLIANCE_EXPIRED_LOOKBACK_DAYS,
    );

    const complianceDocWhere = {
      expiryDate: {
        not: null,
        gte: complianceExpiredLookbackStart,
        lte: complianceWindowEnd,
      },
      verificationStatus: { not: VerificationStatus.REJECTED },
      category: {
        notIn: [DocumentCategory.CV_RESUME, DocumentCategory.COVER_LETTER],
      },
    };

    const mismatchDocFilter = {
      verificationStatus: VerificationStatus.MISMATCH,
    };

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (tier) where.tier = tier;
    if (search) {
      where.OR = [
        { fullname: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }
    if (complianceAttention) {
      where.documents = { some: complianceDocWhere };
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
        _count: {
          select: {
            documents: { where: mismatchDocFilter },
          },
        },
        documents: complianceAttention
          ? {
              where: complianceDocWhere,
              select: {
                id: true,
                expiryDate: true,
                category: true,
                name: true,
              },
              orderBy: { expiryDate: 'asc' },
              take: 1,
            }
          : {
              where: mismatchDocFilter,
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
      const { documents, _count, resume, kyc, ...rest } = professional;
      const mismatchDocCount = _count.documents;
      const firstDoc = documents[0];
      const complianceHead =
        complianceAttention &&
        firstDoc &&
        'expiryDate' in firstDoc &&
        firstDoc.expiryDate
          ? firstDoc
          : null;

      return {
        ...rest,
        kyc,
        country: resume?.country ?? null,
        resume: { country: resume?.country ?? null },
        riskLevel: resolveProfessionalRiskLevel(kyc, mismatchDocCount),
        hasDocumentMismatch: mismatchDocCount > 0,
        nearestComplianceExpiry: complianceHead?.expiryDate
          ? complianceHead.expiryDate.toISOString()
          : undefined,
        nearestComplianceDocumentName: complianceHead?.name,
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
        kyc: {
          include: {
            notes: {
              include: { admin: { select: { id: true, email: true } } },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
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
        documents: {
          orderBy: { createdAt: 'desc' },
        },
        bookings: {
          include: {
            course: true,
            sessions: true,
            attachedDocuments: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        savedJobs: {
          include: { job: true },
          orderBy: { createdAt: 'desc' },
        },
        savedCourses: {
          include: { course: true },
          orderBy: { createdAt: 'desc' },
        },
        applications: {
          include: {
            job: true,
            attachedDocuments: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        alerts: {
          orderBy: { createdAt: 'desc' },
        },
        invitations: {
          include: { job: true },
          orderBy: { createdAt: 'desc' },
        },
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
