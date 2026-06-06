import { RecruiterRole } from '../generated/client/index.js';
import { normalizeDomain } from '../services/companyService.js';

const DOMAIN_GROUP_PREFIX = 'domain:';

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'mail.com',
  'ymail.com',
]);

export type RecruiterGroupSource = {
  id: string;
  organizationName: string | null;
  role: RecruiterRole;
  website: string | null;
  email: string;
  orgEmail: string | null;
  companyCountry: string | null;
  organizationVerificationSource: string | null;
  tier: string;
  createdAt: Date;
  updatedAt: Date;
  lastActive: Date;
  companyId: string | null;
  firstName: string | null;
  lastName: string | null;
  status: string;
};

export type CompanyGroupSource = {
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
  recruiters: Array<{ organizationVerificationSource: string | null }>;
};

export type GroupedCompanyRow = {
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
  source: 'company' | 'group';
  groupKey: string;
  staffCount: number;
  staffIds: string[];
  canMerge: boolean;
};

type InternalGroup = {
  groupKey: string;
  company: CompanyGroupSource | null;
  recruiters: RecruiterGroupSource[];
};

export const buildDomainGroupId = (domain: string, type: RecruiterRole) =>
  `${DOMAIN_GROUP_PREFIX}${domain}:${type}`;

export const parseDomainGroupId = (
  id: string,
): { domain: string; type: RecruiterRole } | null => {
  if (!id.startsWith(DOMAIN_GROUP_PREFIX)) return null;
  const rest = id.slice(DOMAIN_GROUP_PREFIX.length);
  const splitAt = rest.lastIndexOf(':');
  if (splitAt <= 0) return null;
  const domain = rest.slice(0, splitAt);
  const type = rest.slice(splitAt + 1);
  if (type !== 'RECRUITMENT_AGENT' && type !== 'TRAINING_AGENT') return null;
  return { domain, type };
};

export const extractRecruiterDomain = (recruiter: {
  website?: string | null;
  email?: string | null;
  orgEmail?: string | null;
}) => {
  const fromWebsite = normalizeDomain(recruiter.website);
  if (fromWebsite) return fromWebsite;

  for (const email of [recruiter.orgEmail, recruiter.email]) {
    const raw = String(email || '')
      .trim()
      .toLowerCase();
    const at = raw.lastIndexOf('@');
    if (at === -1) continue;
    const domain = normalizeDomain(raw.slice(at + 1));
    if (domain && !FREE_EMAIL_DOMAINS.has(domain)) return domain;
  }

  return '';
};

const domainGroupKey = (domain: string, type: RecruiterRole) =>
  `domain:${domain}:${type}`;

const soloGroupKey = (recruiterId: string) => `solo:${recruiterId}`;

const companyGroupKey = (companyId: string) => `company:${companyId}`;

const resolveGeminiVerified = (
  sources: Array<string | null | undefined>,
): boolean => sources.some((s) => s === 'GEMINI_GOOGLE_SEARCH');

const pickGroupName = (
  company: CompanyGroupSource | null,
  recruiters: RecruiterGroupSource[],
) => {
  if (company?.name) return company.name;
  const names = recruiters
    .map((r) => r.organizationName?.trim())
    .filter(Boolean) as string[];
  if (!names.length) return 'Unnamed organization';
  const counts = new Map<string, number>();
  for (const name of names) {
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
};

const pickGroupCountry = (
  company: CompanyGroupSource | null,
  recruiters: RecruiterGroupSource[],
) =>
  company?.country ||
  recruiters.find((r) => r.companyCountry)?.companyCountry ||
  null;

const pickGroupWebsite = (
  company: CompanyGroupSource | null,
  recruiters: RecruiterGroupSource[],
  domain: string | null,
) =>
  company?.website ||
  recruiters.find((r) => r.website)?.website ||
  domain ||
  null;

export const buildCompanyGroups = (
  companies: CompanyGroupSource[],
  recruiters: RecruiterGroupSource[],
): GroupedCompanyRow[] => {
  const groups = new Map<string, InternalGroup>();
  const companyIdToGroupKey = new Map<string, string>();
  const recruiterIdToGroupKey = new Map<string, string>();

  const ensureGroup = (
    groupKey: string,
    company: CompanyGroupSource | null,
  ) => {
    const existing = groups.get(groupKey);
    if (existing) {
      if (company && !existing.company) existing.company = company;
      return existing;
    }
    const created: InternalGroup = { groupKey, company, recruiters: [] };
    groups.set(groupKey, created);
    if (company) companyIdToGroupKey.set(company.id, groupKey);
    return created;
  };

  const addRecruiter = (groupKey: string, recruiter: RecruiterGroupSource) => {
    const group = groups.get(groupKey);
    if (!group) return;
    if (group.recruiters.some((r) => r.id === recruiter.id)) return;
    group.recruiters.push(recruiter);
    recruiterIdToGroupKey.set(recruiter.id, groupKey);
  };

  for (const company of companies) {
    const domain =
      normalizeDomain(company.domain) || normalizeDomain(company.website);
    const key = domain
      ? domainGroupKey(domain, company.type)
      : companyGroupKey(company.id);
    ensureGroup(key, company);
    companyIdToGroupKey.set(company.id, key);
  }

  for (const recruiter of recruiters) {
    if (recruiter.companyId) {
      const linkedKey =
        companyIdToGroupKey.get(recruiter.companyId) ||
        companyGroupKey(recruiter.companyId);
      ensureGroup(linkedKey, null);
      addRecruiter(linkedKey, recruiter);
      continue;
    }

    const domain = extractRecruiterDomain(recruiter);
    const key = domain
      ? domainGroupKey(domain, recruiter.role)
      : soloGroupKey(recruiter.id);
    ensureGroup(key, null);
    addRecruiter(key, recruiter);
  }

  const rows: GroupedCompanyRow[] = [];

  for (const group of groups.values()) {
    const domainFromKey = group.groupKey.startsWith('domain:')
      ? group.groupKey.slice('domain:'.length, group.groupKey.lastIndexOf(':'))
      : null;
    const domain =
      normalizeDomain(group.company?.domain) ||
      domainFromKey ||
      extractRecruiterDomain(group.recruiters[0] || {}) ||
      null;

    const company = group.company;
    const staffIds = group.recruiters.map((r) => r.id);
    const staffCount = staffIds.length;
    const type =
      company?.type || group.recruiters[0]?.role || 'RECRUITMENT_AGENT';
    const verificationSources = [
      ...(company?.recruiters.map((r) => r.organizationVerificationSource) ||
        []),
      ...group.recruiters.map((r) => r.organizationVerificationSource),
    ];

    const createdAt = [
      company?.createdAt,
      ...group.recruiters.map((r) => r.createdAt),
    ]
      .filter(Boolean)
      .sort((a, b) => a!.getTime() - b!.getTime())[0]!;

    const lastActive = [
      company?.lastActive,
      ...group.recruiters.map((r) => r.lastActive),
    ]
      .filter(Boolean)
      .sort((a, b) => b!.getTime() - a!.getTime())[0]!;

    const id =
      company?.id || (domain ? buildDomainGroupId(domain, type) : staffIds[0]);

    rows.push({
      id,
      name: pickGroupName(company, group.recruiters),
      type,
      domain,
      logoUrl: company?.logoUrl || null,
      address: company?.address || null,
      city: company?.city || null,
      state: company?.state || null,
      zip: company?.zip || null,
      country: pickGroupCountry(company, group.recruiters),
      website: pickGroupWebsite(company, group.recruiters, domain),
      email: company?.email || null,
      linkedIn: company?.linkedIn || null,
      isClaimed: Boolean(company?.isClaimed),
      isVerified: resolveGeminiVerified(verificationSources),
      tier: company?.tier || group.recruiters[0]?.tier || 'FREE',
      claimDate: company?.claimDate || null,
      createdAt,
      updatedAt: company?.updatedAt || lastActive,
      lastActive,
      source: company ? 'company' : 'group',
      groupKey: group.groupKey,
      staffCount,
      staffIds,
      canMerge: !company && staffCount > 0,
    });
  }

  return rows.sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());
};

export const filterGroupedCompanies = (
  rows: GroupedCompanyRow[],
  filters: {
    type?: RecruiterRole;
    status?: 'CLAIMED' | 'UNCLAIMED';
    country?: string;
    search?: string;
  },
) => {
  let result = rows;

  if (filters.type) {
    result = result.filter((row) => row.type === filters.type);
  }

  if (filters.status === 'CLAIMED') {
    result = result.filter((row) => row.isClaimed);
  } else if (filters.status === 'UNCLAIMED') {
    result = result.filter((row) => !row.isClaimed);
  }

  if (filters.country) {
    result = result.filter(
      (row) => row.country?.toLowerCase() === filters.country!.toLowerCase(),
    );
  }

  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        (row.domain || '').toLowerCase().includes(q) ||
        (row.website || '').toLowerCase().includes(q) ||
        (row.country || '').toLowerCase().includes(q),
    );
  }

  return result;
};
