import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';

/**
 * @desc    Get companies overview (Stats + Paginated List)
 * @route   GET /api/admin/companies
 * @access  Private (Admin)
 */
export const getCompaniesOverview = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const { type, status, country, search } = req.query;

    const where: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any

    if (type) where.type = type as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    if (status) {
      if (status === 'CLAIMED') where.isClaimed = true;
      if (status === 'UNCLAIMED') where.isClaimed = false;
    }

    if (country) where.country = country;

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { domain: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { members: true },
          },
        },
      }),
      prisma.company.count({ where }),
    ]);

    // Aggregate stats for widgets
    const [totalCount, claimedCount, unclaimedCount, mergeRequestsCount] =
      await Promise.all([
        prisma.company.count(),
        prisma.company.count({ where: { isClaimed: true } }),
        prisma.company.count({ where: { isClaimed: false } }),
        prisma.companyMergeRequest.count({ where: { status: 'PENDING' } }),
      ]);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const joinedToday = await prisma.company.count({
      where: { createdAt: { gte: todayStart } },
    });

    res.status(200).json({
      status: 'success',
      results: companies.length,
      total,
      data: {
        companies,
        stats: {
          total: { count: totalCount, today: joinedToday },
          claimed: claimedCount,
          unclaimed: unclaimedCount,
          mergeRequests: mergeRequestsCount,
        },
      },
    });
  },
);

/**
 * @desc    Get individual company details (info + members + activity)
 * @route   GET /api/admin/companies/:id
 * @access  Private (Admin)
 */
export const getCompanyById = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { id } = req.params;

    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            recruiter: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                lastActive: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!company) {
      res.status(404).json({ status: 'error', message: 'Company not found' });
      return;
    }

    // Fetch recent activity logs involving this company
    const recentActivity = await prisma.activityLog.findMany({
      where: {
        OR: [
          { targetId: id, targetType: 'COMPANY' },
          {
            actorId: { in: company.members.map((m) => m.recruiterId) },
            actorType: 'RECRUITER',
          },
        ],
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      data: {
        company,
        recentActivity,
      },
    });
  },
);

/**
 * @desc    Get company merge requests
 * @route   GET /api/admin/companies/merge-requests
 * @access  Private (Admin)
 */
export const getMergeRequests = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const requests = await prisma.companyMergeRequest.findMany({
      include: {
        sourceCompany: { select: { id: true, name: true, domain: true } },
        targetCompany: { select: { id: true, name: true, domain: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      data: { requests },
    });
  },
);

/**
 * @desc    Update company status (Verify/Claim/Tier)
 * @route   PATCH /api/admin/companies/:id
 * @access  Private (Admin)
 */
export const updateCompany = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { id } = req.params;
    const { isVerified, isClaimed, tier } = req.body;

    const data: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (typeof isVerified === 'boolean') data.isVerified = isVerified;
    if (typeof isClaimed === 'boolean') {
      data.isClaimed = isClaimed;
      if (isClaimed) data.claimDate = new Date();
    }
    if (tier) data.tier = tier;

    const updated = await prisma.company.update({
      where: { id },
      data,
    });

    // Log the admin action
    await prisma.activityLog.create({
      data: {
        action: 'COMPANY_UPDATED',
        actorId: req.user?.id || 'SYSTEM',
        actorType: 'ADMIN',
        targetId: id,
        targetType: 'COMPANY',
        status: 'SUCCESS',
        metadata: data,
      },
    });

    res.status(200).json({
      status: 'success',
      data: { company: updated },
    });
  },
);

/**
 * @desc    Remove a member from a company
 * @route   DELETE /api/admin/companies/:id/members/:memberId
 * @access  Private (Admin)
 */
export const removeTeamMember = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { id, memberId } = req.params;

    // Remove the record from CompanyMember
    await prisma.companyMember.delete({
      where: { recruiterId: memberId }, // Since it is @unique
    });

    // Also clear companyId from the recruiter record
    await prisma.recruiter.update({
      where: { id: memberId },
      data: { companyId: null },
    });

    // Log the action
    await prisma.activityLog.create({
      data: {
        action: 'COMPANY_MEMBER_REMOVED',
        actorId: req.user?.id || 'SYSTEM',
        actorType: 'ADMIN',
        targetId: id,
        targetType: 'COMPANY',
        status: 'SUCCESS',
        metadata: { removedMemberId: memberId },
      },
    });

    res.status(204).json({
      status: 'success',
      data: null,
    });
  },
);
