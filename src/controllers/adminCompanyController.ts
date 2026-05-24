import { Response } from 'express';
import { Prisma, RecruiterRole } from '../generated/client/index.js';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';

type CompanyOverviewRow = {
  id: string;
  name: string;
  type: RecruiterRole;
  domain: string | null;
  logoUrl: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  website: string | null;
  email: string | null;
  linkedIn: string | null;
  isClaimed: boolean;
  isVerified: boolean;
  tier: string;
  claimDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastActive: Date;
  source: 'company' | 'recruiter';
  _count: { members: number };
};

const GEMINI_VERIFICATION_SOURCE = 'GEMINI_GOOGLE_SEARCH';

const COMPANY_MEMBER_ACTIONS = [
  'COMPANY_MEMBER_REMOVED',
  'COMPANY_MEMBER_ADDED',
] as const;

const isGeminiVerifiedSource = (source: string | null | undefined) =>
  source === GEMINI_VERIFICATION_SOURCE;

const resolveGeminiVerified = (
  sources: Array<string | null | undefined>,
): boolean => sources.some(isGeminiVerifiedSource);

const standaloneRecruiterWhere = (
  type?: RecruiterRole,
  country?: string,
  search?: string,
): Prisma.RecruiterWhereInput => {
  const where: Prisma.RecruiterWhereInput = {
    companyId: null,
    organizationName: { not: null },
    NOT: { organizationName: '' },
  };

  if (type === 'RECRUITMENT_AGENT' || type === 'TRAINING_AGENT') {
    where.role = type;
  }

  if (country) {
    where.companyCountry = country;
  }

  if (search) {
    where.OR = [
      { organizationName: { contains: search, mode: 'insensitive' } },
      { website: { contains: search, mode: 'insensitive' } },
      { companyCountry: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  return where;
};

const mapRecruiterToCompanyRow = (recruiter: {
  id: string;
  organizationName: string | null;
  role: RecruiterRole;
  website: string | null;
  companyCountry: string | null;
  organizationVerificationSource: string | null;
  tier: string;
  createdAt: Date;
  updatedAt: Date;
  lastActive: Date;
}): CompanyOverviewRow => ({
  id: recruiter.id,
  name: recruiter.organizationName || 'Unnamed organization',
  type: recruiter.role,
  domain: null,
  logoUrl: null,
  address: null,
  city: null,
  state: null,
  zip: null,
  country: recruiter.companyCountry,
  website: recruiter.website,
  email: null,
  linkedIn: null,
  isClaimed: false,
  isVerified: isGeminiVerifiedSource(recruiter.organizationVerificationSource),
  tier: recruiter.tier,
  claimDate: null,
  createdAt: recruiter.createdAt,
  updatedAt: recruiter.updatedAt,
  lastActive: recruiter.lastActive,
  source: 'recruiter',
  _count: { members: 1 },
});

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
    const typeFilter =
      type === 'RECRUITMENT_AGENT' || type === 'TRAINING_AGENT'
        ? (type as RecruiterRole)
        : undefined;
    const searchText =
      typeof search === 'string' && search.trim() ? search.trim() : undefined;
    const countryFilter =
      typeof country === 'string' && country.trim()
        ? country.trim()
        : undefined;

    const companyWhere: Prisma.CompanyWhereInput = {};

    if (typeFilter) companyWhere.type = typeFilter;

    if (status === 'CLAIMED') companyWhere.isClaimed = true;
    if (status === 'UNCLAIMED') companyWhere.isClaimed = false;

    if (countryFilter) companyWhere.country = countryFilter;

    if (searchText) {
      companyWhere.OR = [
        { name: { contains: searchText, mode: 'insensitive' } },
        { domain: { contains: searchText, mode: 'insensitive' } },
        { website: { contains: searchText, mode: 'insensitive' } },
        { country: { contains: searchText, mode: 'insensitive' } },
      ];
    }

    const includeStandaloneRecruiters = status !== 'CLAIMED';

    const [companies, standaloneRecruiters] = await Promise.all([
      prisma.company.findMany({
        where: companyWhere,
        orderBy: { createdAt: 'desc' },
        include: {
          recruiters: {
            select: { organizationVerificationSource: true },
          },
          _count: {
            select: { members: true },
          },
        },
      }),
      includeStandaloneRecruiters
        ? prisma.recruiter.findMany({
            where: standaloneRecruiterWhere(
              typeFilter,
              countryFilter,
              searchText,
            ),
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              organizationName: true,
              role: true,
              website: true,
              companyCountry: true,
              organizationVerificationSource: true,
              tier: true,
              createdAt: true,
              updatedAt: true,
              lastActive: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const merged: CompanyOverviewRow[] = [
      ...companies.map(({ recruiters, ...company }) => ({
        ...company,
        isVerified: resolveGeminiVerified(
          recruiters.map((r) => r.organizationVerificationSource),
        ),
        source: 'company' as const,
      })),
      ...standaloneRecruiters.map(mapRecruiterToCompanyRow),
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = merged.length;
    const paged = merged.slice(skip, skip + limit);

    const recruiterStandaloneBase: Prisma.RecruiterWhereInput = {
      companyId: null,
      organizationName: { not: null },
      NOT: { organizationName: '' },
    };

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      companyTotal,
      recruiterStandaloneTotal,
      claimedCompanies,
      joinedTodayCompanies,
      joinedTodayRecruiters,
    ] = await Promise.all([
      prisma.company.count(),
      prisma.recruiter.count({ where: recruiterStandaloneBase }),
      prisma.company.count({ where: { isClaimed: true } }),
      prisma.company.count({
        where: { createdAt: { gte: todayStart } },
      }),
      prisma.recruiter.count({
        where: {
          ...recruiterStandaloneBase,
          createdAt: { gte: todayStart },
        },
      }),
    ]);

    const totalCount = companyTotal + recruiterStandaloneTotal;
    const unclaimedCount =
      companyTotal - claimedCompanies + recruiterStandaloneTotal;

    res.status(200).json({
      status: 'success',
      results: paged.length,
      total,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
      data: {
        companies: paged,
        stats: {
          total: {
            count: totalCount,
            today: joinedTodayCompanies + joinedTodayRecruiters,
          },
          claimed: claimedCompanies,
          unclaimed: unclaimedCount,
        },
      },
    });
  },
);

/**
 * @desc    Get individual company details (info + activity)
 * @route   GET /api/admin/companies/:id
 * @access  Private (Admin)
 */
export const getCompanyById = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { id } = req.params;

    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        recruiters: {
          select: { organizationVerificationSource: true },
        },
      },
    });

    if (!company) {
      res.status(404).json({ status: 'error', message: 'Company not found' });
      return;
    }

    const { recruiters, ...companyFields } = company;
    const isVerified = resolveGeminiVerified(
      recruiters.map((r) => r.organizationVerificationSource),
    );

    const recentActivity = await prisma.activityLog.findMany({
      where: {
        targetId: id,
        targetType: 'COMPANY',
        NOT: {
          action: { in: [...COMPANY_MEMBER_ACTIONS] },
        },
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      data: {
        company: { ...companyFields, isVerified },
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
 * @desc    Update company status (Claim/Tier)
 * @route   PATCH /api/admin/companies/:id
 * @access  Private (Admin)
 */
export const updateCompany = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { id } = req.params;
    const { isClaimed, tier } = req.body;

    const data: Prisma.CompanyUpdateInput = {};
    if (typeof isClaimed === 'boolean') {
      data.isClaimed = isClaimed;
      if (isClaimed) data.claimDate = new Date();
    }
    if (tier) data.tier = tier;

    const auditMeta: Prisma.InputJsonValue = {
      ...(typeof isClaimed === 'boolean' ? { isClaimed } : {}),
      ...(tier ? { tier } : {}),
    };

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
        metadata: auditMeta,
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
