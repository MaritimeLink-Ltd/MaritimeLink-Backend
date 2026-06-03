import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { KycRiskLevel } from '../generated/client/index.js';
import {
  createRecruiterAccountNote,
  kycNotesInclude,
} from '../services/adminAccountNotesService.js';
import {
  notifyAccountStage1Decision,
  notifyKycResubmissionRequested,
  notifyKycStatusChange,
  safeNotify,
} from '../services/eventNotificationService.js';

const resolveRecruiterRiskLevel = (recruiter: {
  organizationRiskLevel?: KycRiskLevel | null;
  kyc: { riskLevel: KycRiskLevel } | null;
}) =>
  recruiter.kyc?.riskLevel === KycRiskLevel.HIGH ||
  recruiter.organizationRiskLevel === KycRiskLevel.HIGH
    ? KycRiskLevel.HIGH
    : (recruiter.kyc?.riskLevel ??
      recruiter.organizationRiskLevel ??
      KycRiskLevel.LOW);

const resolveRecruiterMismatch = (recruiter: {
  organizationVerified?: boolean | null;
  kyc: { mismatchDetected: boolean } | null;
}) =>
  Boolean(recruiter.kyc?.mismatchDetected) ||
  recruiter.organizationVerified === false;

export const getRecruiters = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const { status, tier } = req.query;

    const where: any = { role: 'RECRUITMENT_AGENT' }; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (status) where.status = status as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (tier) where.tier = tier as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    const recruiters = await prisma.recruiter.findMany({
      where,
      skip,
      take: limit,
      include: {
        kyc: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const total = await prisma.recruiter.count({ where });

    const recruitersWithRisk = recruiters.map((recruiter) => ({
      ...recruiter,
      riskLevel: resolveRecruiterRiskLevel(recruiter),
      hasCompanyMismatch: resolveRecruiterMismatch(recruiter),
    }));

    res.status(200).json({
      status: 'success',
      results: recruitersWithRisk.length,
      total,
      data: {
        recruiters: recruitersWithRisk,
      },
    });
  },
);

export const getRecruiterStats = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const roleParam = req.query.role as string | undefined;
    const baseWhere = {
      role: (roleParam || 'RECRUITMENT_AGENT') as
        | 'RECRUITMENT_AGENT'
        | 'TRAINING_AGENT',
    };

    const total = await prisma.recruiter.count({ where: baseWhere });
    const pending = await prisma.recruiter.count({
      where: { ...baseWhere, status: 'PENDING' },
    });
    const approved = await prisma.recruiter.count({
      where: { ...baseWhere, status: 'APPROVED' },
    });
    const rejected = await prisma.recruiter.count({
      where: { ...baseWhere, status: 'REJECTED' },
    });
    const flagged = await prisma.recruiter.count({
      where: { ...baseWhere, status: 'FLAGGED' },
    });
    const verified = await prisma.recruiter.count({
      where: { ...baseWhere, isVerified: true },
    });

    res.status(200).json({
      status: 'success',
      data: {
        total,
        pending,
        approved,
        rejected,
        flagged,
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
      include: {
        kyc: {
          include: kycNotesInclude,
        },
        jobs: true,
      },
    });

    if (!recruiter) {
      return next(new AppError('Recruiter not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: {
        recruiter: {
          ...recruiter,
          riskLevel: resolveRecruiterRiskLevel(recruiter),
          hasCompanyMismatch: resolveRecruiterMismatch(recruiter),
        },
      },
    });
  },
);

export const addRecruiterNote = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { content } = req.body;
    const adminId = req.user?.id;

    if (!adminId) {
      return next(new AppError('Admin authentication required', 401));
    }

    const note = await createRecruiterAccountNote(id, adminId, content);

    res.status(201).json({
      status: 'success',
      data: { note },
    });
  },
);

export const updateRecruiterStatus = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { status, rejectionReason } = req.body; // APPROVED or REJECTED

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return next(new AppError('Invalid status', 400));
    }

    const recruiter = await prisma.recruiter.update({
      where: { id },
      data: { status },
    });

    safeNotify('account-stage1', () =>
      notifyAccountStage1Decision({
        recruiterId: id,
        status,
        rejectionReason:
          typeof rejectionReason === 'string' ? rejectionReason : undefined,
      }),
    );

    res.status(200).json({
      status: 'success',
      message: `Recruiter login status updated to ${status}`,
      data: {
        recruiter,
      },
    });
  },
);

/**
 * Get all recruiters with pending KYC
 */
export const getPendingKYCs = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const kycs = await prisma.recruiterKyc.findMany({
      where: { status: 'PENDING' },
      include: {
        recruiter: {
          select: {
            email: true,
            organizationName: true,
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
 * Update KYC status (Approve/Reject)
 */
export const updateKYCStatus = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params; // recruiterKyc id or recruiterId? Let's use recruiterId for convenience
    const { status, rejectionReason, resubmissionNotes } = req.body;

    if (!['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
      return next(new AppError('Invalid status', 400));
    }

    const existingKyc = await prisma.recruiterKyc.findUnique({
      where: { recruiterId: id },
      select: { status: true },
    });

    const kyc = await prisma.recruiterKyc.update({
      where: { recruiterId: id },
      data: { status },
    });

    if (
      status === 'PENDING' &&
      existingKyc?.status &&
      existingKyc.status !== 'PENDING'
    ) {
      safeNotify('kyc-resubmission', () =>
        notifyKycResubmissionRequested({
          audience: 'RECRUITER',
          userId: id,
          notes:
            typeof resubmissionNotes === 'string'
              ? resubmissionNotes
              : typeof rejectionReason === 'string'
                ? rejectionReason
                : undefined,
        }),
      );
    } else if (status === 'APPROVED' || status === 'REJECTED') {
      safeNotify('kyc-status', () =>
        notifyKycStatusChange({
          audience: 'RECRUITER',
          userId: id,
          status,
          rejectionReason:
            typeof rejectionReason === 'string' ? rejectionReason : undefined,
          io: req.app.get('io'),
        }),
      );
    }

    res.status(200).json({
      status: 'success',
      message: `KYC status updated to ${status}`,
      data: {
        kyc,
      },
    });
  },
);
