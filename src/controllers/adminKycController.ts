import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';
import { AppError } from '../utils/AppError.js';

/**
 * @desc    Get all KYC submissions (Professionals + Recruiters)
 * @route   GET /api/admin/kyc-submissions
 * @access  Private (Admin)
 */
export const getAllKYCSubmissions = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const { status, userType, riskLevel, timeframe, search } = req.query;

    const whereClause: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (status) whereClause.status = status as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (riskLevel) whereClause.riskLevel = riskLevel as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    if (timeframe) {
      const now = new Date();
      if (timeframe === 'TODAY') {
        now.setHours(0, 0, 0, 0);
        whereClause.createdAt = { gte: now };
      } else if (timeframe === '7D') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        whereClause.createdAt = { gte: weekAgo };
      } else if (timeframe === '30D') {
        const monthAgo = new Date();
        monthAgo.setDate(monthAgo.getDate() - 30);
        whereClause.createdAt = { gte: monthAgo };
      }
    }

    let proKycs: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    let recKycs: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

    if (!userType || userType === 'PROFESSIONAL') {
      const proWhere = { ...whereClause };
      if (search) {
        proWhere.professional = {
          OR: [
            { fullname: { contains: search as string, mode: 'insensitive' } },
            { email: { contains: search as string, mode: 'insensitive' } },
          ],
        };
      }
      proKycs = await prisma.professionalKyc.findMany({
        where: proWhere,
        include: {
          professional: {
            select: {
              fullname: true,
              email: true,
              lastActive: true,
              subcategory: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });
    }

    if (
      !userType ||
      userType === 'RECRUITER' ||
      userType === 'TRAINING_PROVIDER'
    ) {
      const recWhere = { ...whereClause };
      if (userType === 'TRAINING_PROVIDER') {
        recWhere.recruiter = { role: 'TRAINING_AGENT' };
      } else if (userType === 'RECRUITER') {
        recWhere.recruiter = { role: 'RECRUITMENT_AGENT' };
      }

      if (search) {
        recWhere.recruiter = {
          ...recWhere.recruiter,
          OR: [
            {
              organizationName: {
                contains: search as string,
                mode: 'insensitive',
              },
            },
            { email: { contains: search as string, mode: 'insensitive' } },
          ],
        };
      }

      recKycs = await prisma.recruiterKyc.findMany({
        where: recWhere,
        include: {
          recruiter: {
            select: {
              organizationName: true,
              email: true,
              lastActive: true,
              role: true,
              company: {
                select: { name: true },
              },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });
    }

    const allSubmissions = [
      ...proKycs.map((k) => ({
        id: k.id,
        userId: k.professionalId,
        userType: 'PROFESSIONAL',
        roleLabel: k.professional.subcategory || 'Professional',
        name: k.professional.fullname,
        email: k.professional.email,
        companyName: 'Individual',
        status: k.status,
        riskLevel: k.riskLevel,
        reviewStep: k.reviewStep,
        mismatchDetected: k.mismatchDetected,
        ocrConfidence: k.ocrConfidence,
        submittedAt: k.createdAt,
        updatedAt: k.updatedAt,
        slaStatus: getSLAStatus(k.createdAt, k.updatedAt, k.status),
      })),
      ...recKycs.map((k) => ({
        id: k.id,
        userId: k.recruiterId,
        userType:
          k.recruiter.role === 'TRAINING_AGENT'
            ? 'TRAINING_PROVIDER'
            : 'RECRUITER',
        roleLabel:
          k.recruiter.role === 'TRAINING_AGENT'
            ? 'Training Provider'
            : 'Recruitment Agent',
        name: k.recruiter.organizationName || k.recruiter.email,
        email: k.recruiter.email,
        companyName: k.recruiter.company?.name || 'N/A',
        status: k.status,
        riskLevel: k.riskLevel,
        reviewStep: k.reviewStep,
        mismatchDetected: k.mismatchDetected,
        ocrConfidence: k.ocrConfidence,
        submittedAt: k.createdAt,
        updatedAt: k.updatedAt,
        slaStatus: getSLAStatus(k.createdAt, k.updatedAt, k.status),
      })),
    ].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    const total = allSubmissions.length;
    const paginatedSubmissions = allSubmissions.slice(skip, skip + limit);

    res.status(200).json({
      status: 'success',
      results: paginatedSubmissions.length,
      total,
      data: {
        submissions: paginatedSubmissions,
      },
    });
  },
);

/**
 * @desc    Get detailed KYC record (Detail Page)
 * @route   GET /api/admin/kyc-submissions/:id
 */
export const getKycDetails = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { userType } = req.query;

    let kyc: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any

    if (userType === 'PROFESSIONAL') {
      kyc = await prisma.professionalKyc.findUnique({
        where: { id },
        include: {
          professional: true,
          notes: {
            include: { admin: { select: { email: true } } },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    } else {
      kyc = await prisma.recruiterKyc.findUnique({
        where: { id },
        include: {
          recruiter: { include: { company: true } },
          notes: {
            include: { admin: { select: { email: true } } },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    }

    if (!kyc) return next(new AppError('KYC record not found', 404));

    res.status(200).json({
      status: 'success',
      data: { kyc },
    });
  },
);

/**
 * @desc    Update KYC Status / Verification
 * @route   PATCH /api/admin/kyc-submissions/:id/status
 */
export const updateKycVerification = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { id } = req.params;
    const { userType, status, reviewStep, riskLevel, mismatchDetails } =
      req.body;

    const data: any = { status }; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (reviewStep) data.reviewStep = reviewStep;
    if (riskLevel) data.riskLevel = riskLevel;
    if (mismatchDetails) {
      data.mismatchDetected = true;
      data.mismatchDetails = mismatchDetails;
    }

    let updated: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any

    if (userType === 'PROFESSIONAL') {
      updated = await prisma.professionalKyc.update({
        where: { id },
        data,
      });

      // If approved, update professional profile
      if (status === 'APPROVED') {
        await prisma.professional.update({
          where: { id: updated.professionalId },
          data: { isVerified: true, status: 'VERIFIED' },
        });
      }
    } else {
      updated = await prisma.recruiterKyc.update({
        where: { id },
        data,
      });

      if (status === 'APPROVED') {
        await prisma.recruiter.update({
          where: { id: updated.recruiterId },
          data: { isVerified: true, status: 'APPROVED' },
        });
      }
    }

    res.status(200).json({
      status: 'success',
      data: { updated },
    });
  },
);

/**
 * @desc    Add Note to KYC record
 * @route   POST /api/admin/kyc-submissions/:id/notes
 */
export const addKycNote = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { id } = req.params;
    const { userType, content } = req.body;
    const adminId = req.user?.id;

    const noteData = {
      content,
      adminId: adminId as string,
      professionalKycId: userType === 'PROFESSIONAL' ? id : undefined,
      recruiterKycId: userType === 'RECRUITER' ? id : undefined,
    };

    const note = await prisma.kycNote.create({
      data: noteData,
      include: { admin: { select: { email: true } } },
    });

    res.status(201).json({
      status: 'success',
      data: { note },
    });
  },
);

/**
 * @desc    Get KYC stats for dashboard
 */
export const getKYCStats = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      proPending,
      proVerified,
      proRejected,
      proHighRisk,
      recPending,
      recVerified,
      recRejected,
      recHighRisk,
      proToday,
      recToday,
    ] = await Promise.all([
      prisma.professionalKyc.count({ where: { status: 'PENDING' } }),
      prisma.professionalKyc.count({ where: { status: 'APPROVED' } }),
      prisma.professionalKyc.count({ where: { status: 'REJECTED' } }),
      prisma.professionalKyc.count({ where: { riskLevel: 'HIGH' } }),
      prisma.recruiterKyc.count({ where: { status: 'PENDING' } }),
      prisma.recruiterKyc.count({ where: { status: 'APPROVED' } }),
      prisma.recruiterKyc.count({ where: { status: 'REJECTED' } }),
      prisma.recruiterKyc.count({ where: { riskLevel: 'HIGH' } }),
      prisma.professionalKyc.count({ where: { createdAt: { gte: today } } }),
      prisma.recruiterKyc.count({ where: { createdAt: { gte: today } } }),
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        pendingReview: {
          count: proPending + recPending,
          today: proToday + recToday,
        },
        verified: proVerified + recVerified,
        rejected: proRejected + recRejected,
        highRisk: proHighRisk + recHighRisk,
      },
    });
  },
);

// Helper to determine SLA status. Pending items count against now; resolved
// items count against the admin action timestamp stored in updatedAt.
function getSLAStatus(createdAt: Date, updatedAt: Date, status: string) {
  const isPending = status === 'PENDING';
  const actionAt = isPending ? new Date() : new Date(updatedAt);
  const hoursSince =
    (actionAt.getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60);

  if (!isPending) {
    return hoursSince <= 48 ? 'Within SLA' : 'SLA Breached';
  }

  if (hoursSince < 24) return 'Within SLA';
  if (hoursSince < 48) return 'Breaching soon';
  return 'SLA Breached';
}

import { NextFunction } from 'express';
