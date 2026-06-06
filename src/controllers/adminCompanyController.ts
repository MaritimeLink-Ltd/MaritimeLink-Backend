import { Response } from 'express';
import { Prisma, RecruiterRole } from '../generated/client/index.js';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';
import { normalizeDomain } from '../services/companyService.js';
import {
  buildCompanyGroups,
  buildDomainGroupId,
  extractRecruiterDomain,
  filterGroupedCompanies,
  parseDomainGroupId,
} from '../utils/adminCompanyGrouping.js';

const GEMINI_VERIFICATION_SOURCE = 'GEMINI_GOOGLE_SEARCH';

const COMPANY_MEMBER_ACTIONS = [
  'COMPANY_MEMBER_REMOVED',
  'COMPANY_MEMBER_ADDED',
] as const;

const recruiterOrgSelect = {
  id: true,
  organizationName: true,
  role: true,
  website: true,
  email: true,
  orgEmail: true,
  companyCountry: true,
  organizationVerificationSource: true,
  tier: true,
  createdAt: true,
  updatedAt: true,
  lastActive: true,
  companyId: true,
  firstName: true,
  lastName: true,
  status: true,
} satisfies Prisma.RecruiterSelect;

const isGeminiVerifiedSource = (source: string | null | undefined) =>
  source === GEMINI_VERIFICATION_SOURCE;

const resolveGeminiVerified = (
  sources: Array<string | null | undefined>,
): boolean => sources.some(isGeminiVerifiedSource);

const recruiterWhereForOverview = (
  type?: RecruiterRole,
): Prisma.RecruiterWhereInput => ({
  organizationName: { not: null },
  NOT: { organizationName: '' },
  ...(type ? { role: type } : {}),
});

const mapStaffMember = (recruiter: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  organizationName: string | null;
  role: RecruiterRole;
  status: string;
  website: string | null;
  companyCountry: string | null;
  organizationVerificationSource: string | null;
  createdAt: Date;
  lastActive: Date;
  companyId: string | null;
}) => ({
  id: recruiter.id,
  firstName: recruiter.firstName,
  lastName: recruiter.lastName,
  email: recruiter.email,
  organizationName: recruiter.organizationName,
  role: recruiter.role,
  status: recruiter.status,
  website: recruiter.website,
  country: recruiter.companyCountry,
  isVerified: isGeminiVerifiedSource(recruiter.organizationVerificationSource),
  createdAt: recruiter.createdAt,
  lastActive: recruiter.lastActive,
  isLinked: Boolean(recruiter.companyId),
});

const loadOverviewGroups = async (typeFilter?: RecruiterRole) => {
  const [companies, recruiters] = await Promise.all([
    prisma.company.findMany({
      where: typeFilter ? { type: typeFilter } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        recruiters: {
          select: { organizationVerificationSource: true },
        },
      },
    }),
    prisma.recruiter.findMany({
      where: recruiterWhereForOverview(typeFilter),
      orderBy: { createdAt: 'desc' },
      select: recruiterOrgSelect,
    }),
  ]);

  return buildCompanyGroups(companies, recruiters);
};

const resolveStaffForCompanyId = async (companyId: string) => {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return null;

  const domain =
    normalizeDomain(company.domain) || normalizeDomain(company.website);

  const staffWhere: Prisma.RecruiterWhereInput = domain
    ? {
        role: company.type,
        OR: [
          { companyId: company.id },
          {
            companyId: null,
            OR: [
              { website: { contains: domain, mode: 'insensitive' } },
              { email: { endsWith: `@${domain}`, mode: 'insensitive' } },
              { orgEmail: { endsWith: `@${domain}`, mode: 'insensitive' } },
            ],
          },
        ],
      }
    : { companyId: company.id };

  const staff = await prisma.recruiter.findMany({
    where: staffWhere,
    select: recruiterOrgSelect,
    orderBy: { createdAt: 'asc' },
  });

  return { company, staff };
};

const resolveStaffForDomainGroup = async (
  domain: string,
  type: RecruiterRole,
) => {
  const staff = await prisma.recruiter.findMany({
    where: {
      role: type,
      organizationName: { not: null },
      NOT: { organizationName: '' },
      OR: [
        { website: { contains: domain, mode: 'insensitive' } },
        { email: { endsWith: `@${domain}`, mode: 'insensitive' } },
        { orgEmail: { endsWith: `@${domain}`, mode: 'insensitive' } },
      ],
    },
    select: recruiterOrgSelect,
    orderBy: { createdAt: 'asc' },
  });

  const company = await prisma.company.findFirst({
    where: {
      type,
      OR: [{ domain }, { website: { contains: domain, mode: 'insensitive' } }],
    },
  });

  return { company, staff, domain, type };
};

const resolveStaffForRecruiterId = async (recruiterId: string) => {
  const recruiter = await prisma.recruiter.findUnique({
    where: { id: recruiterId },
    select: recruiterOrgSelect,
  });
  if (!recruiter) return null;

  if (recruiter.companyId) {
    return resolveStaffForCompanyId(recruiter.companyId);
  }

  const domain = extractRecruiterDomain(recruiter);
  if (domain) {
    return resolveStaffForDomainGroup(domain, recruiter.role);
  }

  return {
    company: null,
    staff: [recruiter],
    domain: null as string | null,
    type: recruiter.role,
  };
};

const buildVirtualCompany = (args: {
  id: string;
  company: {
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
    tier: string;
    claimDate: Date | null;
    createdAt: Date;
    updatedAt: Date;
    lastActive: Date;
  } | null;
  staff: Array<{
    organizationName: string | null;
    organizationVerificationSource: string | null;
    createdAt: Date;
    lastActive: Date;
    tier: string;
  }>;
  domain: string | null;
  type: RecruiterRole;
}) => {
  const { company, staff, domain, type, id } = args;
  const verificationSources = staff.map(
    (s) => s.organizationVerificationSource,
  );

  if (company) {
    return {
      ...company,
      isVerified: resolveGeminiVerified(verificationSources),
    };
  }

  const name =
    staff.find((s) => s.organizationName)?.organizationName ||
    'Unnamed organization';

  return {
    id,
    name,
    type,
    domain,
    logoUrl: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    country: null,
    website: domain ? `https://${domain}` : null,
    email: null,
    linkedIn: null,
    isClaimed: false,
    isVerified: resolveGeminiVerified(verificationSources),
    tier: staff[0]?.tier || 'FREE',
    claimDate: null,
    createdAt: staff.reduce(
      (min, s) => (s.createdAt < min ? s.createdAt : min),
      staff[0]?.createdAt || new Date(),
    ),
    updatedAt: staff.reduce(
      (max, s) => (s.lastActive > max ? s.lastActive : max),
      staff[0]?.lastActive || new Date(),
    ),
    lastActive: staff.reduce(
      (max, s) => (s.lastActive > max ? s.lastActive : max),
      staff[0]?.lastActive || new Date(),
    ),
  };
};

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
    const statusFilter =
      status === 'CLAIMED' || status === 'UNCLAIMED'
        ? (status as 'CLAIMED' | 'UNCLAIMED')
        : undefined;

    const allGroups = await loadOverviewGroups(typeFilter);
    const filtered = filterGroupedCompanies(allGroups, {
      type: typeFilter,
      status: statusFilter,
      country: countryFilter,
      search: searchText,
    });

    const total = filtered.length;
    const paged = filtered.slice(skip, skip + limit);

    const statsSource = filterGroupedCompanies(allGroups, {
      type: typeFilter,
    });
    const claimedCount = statsSource.filter((row) => row.isClaimed).length;
    const unclaimedCount = statsSource.length - claimedCount;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const joinedToday = statsSource.filter(
      (row) => row.createdAt >= todayStart,
    ).length;

    const companies = paged.map((row) => {
      const dto = {
        ...row,
        _count: { members: row.staffCount },
      };
      delete (dto as { groupKey?: string }).groupKey;
      delete (dto as { staffIds?: string[] }).staffIds;
      delete (dto as { canMerge?: boolean }).canMerge;
      delete (dto as { staffCount?: number }).staffCount;
      return dto;
    });

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
        companies,
        stats: {
          total: {
            count: statsSource.length,
            today: joinedToday,
          },
          claimed: claimedCount,
          unclaimed: unclaimedCount,
        },
      },
    });
  },
);

/**
 * @desc    Get individual company details (info + staff + activity)
 * @route   GET /api/admin/companies/:id
 * @access  Private (Admin)
 */
export const getCompanyById = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { id } = req.params;

    let resolved:
      | Awaited<ReturnType<typeof resolveStaffForCompanyId>>
      | Awaited<ReturnType<typeof resolveStaffForDomainGroup>>
      | Awaited<ReturnType<typeof resolveStaffForRecruiterId>>
      | null = null;
    let responseId = id;

    const domainGroup = parseDomainGroupId(id);
    if (domainGroup) {
      resolved = await resolveStaffForDomainGroup(
        domainGroup.domain,
        domainGroup.type,
      );
      responseId = resolved.company?.id || id;
    } else {
      const byCompany = await resolveStaffForCompanyId(id);
      if (byCompany) {
        resolved = byCompany;
      } else {
        resolved = await resolveStaffForRecruiterId(id);
      }
    }

    if (!resolved || resolved.staff.length === 0) {
      res.status(404).json({ status: 'error', message: 'Company not found' });
      return;
    }

    const domain =
      ('domain' in resolved && resolved.domain) ||
      normalizeDomain(resolved.company?.domain) ||
      normalizeDomain(resolved.company?.website) ||
      extractRecruiterDomain(resolved.staff[0]);
    const type =
      resolved.company?.type || resolved.staff[0]?.role || 'RECRUITMENT_AGENT';

    const companyView = buildVirtualCompany({
      id: responseId,
      company: resolved.company,
      staff: resolved.staff,
      domain,
      type,
    });

    const activityTargetId = resolved.company?.id || responseId;
    const recentActivity = await prisma.activityLog.findMany({
      where: {
        targetId: activityTargetId,
        targetType: 'COMPANY',
        NOT: {
          action: { in: [...COMPANY_MEMBER_ACTIONS] },
        },
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    const canMerge =
      !resolved.company &&
      resolved.staff.length > 0 &&
      (domain ? true : resolved.staff.length > 1);

    res.status(200).json({
      status: 'success',
      data: {
        company: companyView,
        staff: resolved.staff.map(mapStaffMember),
        canMerge,
        mergeGroupId: domain ? buildDomainGroupId(domain, type) : null,
        recentActivity,
      },
    });
  },
);

/**
 * @desc    Manually merge recruiters under one company profile
 * @route   POST /api/admin/companies/merge
 * @access  Private (Admin)
 */
export const mergeCompanies = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { recruiterIds, targetCompanyId, name } = req.body as {
      recruiterIds?: string[];
      targetCompanyId?: string;
      name?: string;
    };

    if (!Array.isArray(recruiterIds) || recruiterIds.length < 1) {
      res.status(400).json({
        status: 'error',
        message: 'At least one recruiter id is required',
      });
      return;
    }

    const uniqueIds = [...new Set(recruiterIds.map(String))];
    const recruiters = await prisma.recruiter.findMany({
      where: { id: { in: uniqueIds } },
      select: recruiterOrgSelect,
    });

    if (recruiters.length !== uniqueIds.length) {
      res.status(400).json({
        status: 'error',
        message: 'One or more recruiter ids were not found',
      });
      return;
    }

    const role = recruiters[0].role;
    if (!recruiters.every((r) => r.role === role)) {
      res.status(400).json({
        status: 'error',
        message: 'All recruiters must share the same organization type',
      });
      return;
    }

    const domain =
      recruiters.map((r) => extractRecruiterDomain(r)).find(Boolean) || null;

    let company = targetCompanyId
      ? await prisma.company.findUnique({ where: { id: targetCompanyId } })
      : domain
        ? await prisma.company.findFirst({
            where: {
              type: role,
              OR: [
                { domain },
                { website: { contains: domain, mode: 'insensitive' } },
              ],
            },
          })
        : null;

    if (targetCompanyId && !company) {
      res.status(404).json({
        status: 'error',
        message: 'Target company not found',
      });
      return;
    }

    const companyName =
      name?.trim() ||
      company?.name ||
      recruiters.find((r) => r.organizationName)?.organizationName ||
      (domain
        ? domain.split('.')[0].charAt(0).toUpperCase() +
          domain.split('.')[0].slice(1)
        : 'Merged organization');

    const result = await prisma.$transaction(async (tx) => {
      if (!company) {
        company = await tx.company.create({
          data: {
            name: companyName,
            type: role,
            domain,
            website: domain ? `https://${domain}` : recruiters[0].website,
            country: recruiters.find((r) => r.companyCountry)?.companyCountry,
          },
        });
      } else if (name?.trim() && name.trim() !== company.name) {
        company = await tx.company.update({
          where: { id: company.id },
          data: { name: name.trim() },
        });
      }

      for (const recruiter of recruiters) {
        await tx.recruiter.update({
          where: { id: recruiter.id },
          data: { companyId: company!.id },
        });

        await tx.companyMember.upsert({
          where: { recruiterId: recruiter.id },
          create: {
            companyId: company!.id,
            recruiterId: recruiter.id,
            status: 'ACTIVE',
          },
          update: {
            companyId: company!.id,
            status: 'ACTIVE',
          },
        });
      }

      await tx.activityLog.create({
        data: {
          action: 'COMPANY_MEMBER_ADDED',
          actorId: req.user?.id || 'SYSTEM',
          actorType: 'ADMIN',
          targetId: company!.id,
          targetType: 'COMPANY',
          status: 'SUCCESS',
          metadata: {
            mergedRecruiterIds: uniqueIds,
            manualMerge: true,
          },
        },
      });

      return company!;
    });

    const staff = await prisma.recruiter.findMany({
      where: { companyId: result.id },
      select: recruiterOrgSelect,
      orderBy: { createdAt: 'asc' },
    });

    res.status(200).json({
      status: 'success',
      data: {
        company: result,
        staff: staff.map(mapStaffMember),
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

    let companyId = id;
    const domainGroup = parseDomainGroupId(id);
    if (domainGroup) {
      const existing = await prisma.company.findFirst({
        where: {
          type: domainGroup.type,
          OR: [
            { domain: domainGroup.domain },
            {
              website: {
                contains: domainGroup.domain,
                mode: 'insensitive',
              },
            },
          ],
        },
      });
      if (existing) {
        companyId = existing.id;
      } else {
        const staff = await resolveStaffForDomainGroup(
          domainGroup.domain,
          domainGroup.type,
        );
        if (!staff.staff.length) {
          res
            .status(404)
            .json({ status: 'error', message: 'Company not found' });
          return;
        }
        const created = await prisma.company.create({
          data: {
            name:
              staff.staff.find((s) => s.organizationName)?.organizationName ||
              domainGroup.domain,
            type: domainGroup.type,
            domain: domainGroup.domain,
            website: `https://${domainGroup.domain}`,
            country: staff.staff.find((s) => s.companyCountry)?.companyCountry,
            isClaimed: typeof isClaimed === 'boolean' ? isClaimed : false,
            tier: tier || 'FREE',
            claimDate: isClaimed ? new Date() : null,
          },
        });
        for (const recruiter of staff.staff) {
          await prisma.recruiter.update({
            where: { id: recruiter.id },
            data: { companyId: created.id },
          });
          await prisma.companyMember.upsert({
            where: { recruiterId: recruiter.id },
            create: {
              companyId: created.id,
              recruiterId: recruiter.id,
              status: 'ACTIVE',
            },
            update: { companyId: created.id, status: 'ACTIVE' },
          });
        }
        res.status(200).json({
          status: 'success',
          data: { company: created },
        });
        return;
      }
    }

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
      where: { id: companyId },
      data,
    });

    await prisma.activityLog.create({
      data: {
        action: 'COMPANY_UPDATED',
        actorId: req.user?.id || 'SYSTEM',
        actorType: 'ADMIN',
        targetId: companyId,
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

    await prisma.companyMember.deleteMany({
      where: { recruiterId: memberId },
    });

    await prisma.recruiter.update({
      where: { id: memberId },
      data: { companyId: null },
    });

    await prisma.activityLog.create({
      data: {
        action: 'COMPANY_MEMBER_REMOVED',
        actorId: req.user?.id || 'SYSTEM',
        actorType: 'ADMIN',
        targetType: 'COMPANY',
        targetId: id,
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
