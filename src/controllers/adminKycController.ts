import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';

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
    const { status, userType } = req.query;

    let proKycs: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    let recKycs: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

    if (!userType || userType === 'PROFESSIONAL') {
      proKycs = await prisma.professionalKyc.findMany({
        where: status ? { status: status as any } : {}, // eslint-disable-line @typescript-eslint/no-explicit-any
        include: {
          professional: {
            select: {
              fullname: true,
              email: true,
              lastActive: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });
    }

    if (!userType || userType === 'RECRUITER') {
      recKycs = await prisma.recruiterKyc.findMany({
        where: status ? { status: status as any } : {}, // eslint-disable-line @typescript-eslint/no-explicit-any
        include: {
          recruiter: {
            select: {
              organizationName: true,
              email: true,
              lastActive: true,
              website: true,
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
        name: k.professional.fullname,
        email: k.professional.email,
        lastActive: k.professional.lastActive,
        status: k.status,
        updatedAt: k.updatedAt,
      })),
      ...recKycs.map((k) => ({
        id: k.id,
        userId: k.recruiterId,
        userType: 'RECRUITER',
        name: k.recruiter.organizationName || k.recruiter.email,
        email: k.recruiter.email,
        lastActive: k.recruiter.lastActive,
        website: k.recruiter.website,
        status: k.status,
        updatedAt: k.updatedAt,
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
 * @desc    Get KYC stats for dashboard
 * @route   GET /api/admin/kyc/stats
 * @access  Private (Admin)
 */
export const getKYCStats = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const [
      proPending,
      proApproved,
      proUnderReview,
      recPending,
      recApproved,
      recUnderReview,
    ] = await Promise.all([
      prisma.professionalKyc.count({ where: { status: 'PENDING' } }),
      prisma.professionalKyc.count({ where: { status: 'APPROVED' } }),
      prisma.professionalKyc.count({
        where: { status: 'UNDER_REVIEW' as any },
      }), // eslint-disable-line @typescript-eslint/no-explicit-any
      prisma.recruiterKyc.count({ where: { status: 'PENDING' } }),
      prisma.recruiterKyc.count({ where: { status: 'APPROVED' } }),
      prisma.recruiterKyc.count({ where: { status: 'UNDER_REVIEW' as any } }), // eslint-disable-line @typescript-eslint/no-explicit-any
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        totalSubmissions:
          proPending +
          proApproved +
          proUnderReview +
          recPending +
          recApproved +
          recUnderReview,
        documentsPending: proPending + recPending,
        kycApproved: proApproved + recApproved,
        underReview: proUnderReview + recUnderReview,
      },
    });
  },
);
