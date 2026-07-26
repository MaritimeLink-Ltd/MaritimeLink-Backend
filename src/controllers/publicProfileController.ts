import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';

/**
 * Public, search-engine indexable professional profiles ("LinkedIn-style").
 *
 * Strictly opt-in: nothing is exposed unless the professional has switched
 * `publicProfileEnabled` on. The payload is deliberately conservative — it carries
 * no contact details, no documents, no licence/certificate numbers, no vessel or
 * employer names, and no exact dates. Everything else stays behind the login wall.
 */

/** Number of trailing id characters appended to the slug to keep it unique. */
const SLUG_ID_LENGTH = 8;

const slugifyName = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/** `firstname-lastname-a1b2c3d4` — readable, and unique via the id suffix. */
export const buildProfileSlug = (professional: {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  fullname?: string | null;
}) => {
  const name =
    [professional.firstName, professional.lastName].filter(Boolean).join(' ') ||
    professional.fullname ||
    'maritime professional';
  const namePart = slugifyName(name) || 'maritime-professional';
  return `${namePart}-${professional.id.replace(/-/g, '').slice(0, SLUG_ID_LENGTH)}`;
};

/**
 * The slug's trailing segment is the first 8 chars of the (de-hyphenated) uuid.
 * A uuid's first 8 chars are its first block, so we can match on `id startsWith`.
 */
const idPrefixFromSlug = (slug: string): string | null => {
  const segments = String(slug || '').split('-');
  const candidate = segments[segments.length - 1]?.toLowerCase() ?? '';
  return /^[0-9a-f]{8}$/.test(candidate) ? candidate : null;
};

/** Whole years/months of sea time — deliberately coarse, no vessel or employer names. */
const summariseSeaService = (
  logs: {
    joiningDate: Date | null;
    tillDate: Date | null;
    vesselType: string | null;
  }[],
) => {
  const MS_PER_DAY = 86_400_000;
  let totalDays = 0;
  const vesselTypes = new Set<string>();

  logs.forEach((log) => {
    const type = String(log.vesselType || '').trim();
    if (type) vesselTypes.add(type);

    if (!log.joiningDate || !log.tillDate) return;
    const days =
      (new Date(log.tillDate).getTime() - new Date(log.joiningDate).getTime()) /
      MS_PER_DAY;
    if (days > 0) totalDays += days;
  });

  const years = Math.floor(totalDays / 365.25);
  const months = Math.floor((totalDays - years * 365.25) / 30.44);

  return {
    vesselTypes: [...vesselTypes],
    seaTimeYears: years,
    seaTimeMonths: months,
    seaTimeLabel:
      totalDays <= 0
        ? null
        : [
            years > 0 ? `${years} year${years === 1 ? '' : 's'}` : '',
            months > 0 ? `${months} month${months === 1 ? '' : 's'}` : '',
          ]
            .filter(Boolean)
            .join(' ') || 'Less than a month',
  };
};

/**
 * GET /api/public/professionals/:slug  (public, no auth)
 */
export const getPublicProfile = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const idPrefix = idPrefixFromSlug(req.params.slug);
    if (!idPrefix) {
      return next(new AppError('Profile not found', 404));
    }

    const professional = await prisma.professional.findFirst({
      where: {
        id: { startsWith: idPrefix },
        publicProfileEnabled: true,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        fullname: true,
        profession: true,
        subcategory: true,
        profilePhotoUrl: true,
        availableForWork: true,
        isVerified: true,
        updatedAt: true,
        kyc: { select: { status: true } },
        resume: {
          select: {
            country: true,
            skills: { select: { skillName: true, rating: true } },
            seaService: {
              select: {
                joiningDate: true,
                tillDate: true,
                vesselType: true,
              },
            },
          },
        },
      },
    });

    if (!professional) {
      return next(new AppError('Profile not found', 404));
    }

    const sea = summariseSeaService(professional.resume?.seaService || []);
    const name =
      professional.fullname ||
      [professional.firstName, professional.lastName]
        .filter(Boolean)
        .join(' ') ||
      'Maritime Professional';

    res.status(200).json({
      status: 'success',
      data: {
        profile: {
          slug: buildProfileSlug(professional),
          name,
          rank: professional.profession || professional.subcategory || null,
          profilePhotoUrl: professional.profilePhotoUrl,
          country: professional.resume?.country || null,
          availableForWork: professional.availableForWork,
          compliant:
            professional.isVerified || professional.kyc?.status === 'APPROVED',
          vesselTypes: sea.vesselTypes,
          seaTimeLabel: sea.seaTimeLabel,
          seaTimeYears: sea.seaTimeYears,
          skills: (professional.resume?.skills || []).map((skill) => ({
            skillName: skill.skillName,
            rating: skill.rating,
          })),
          updatedAt: professional.updatedAt,
        },
      },
    });
  },
);

/**
 * GET /api/public/professionals  (public, no auth)
 * Slug feed used to build the profile sitemap.
 */
export const listPublicProfiles = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 5000, 20000);

    const professionals = await prisma.professional.findMany({
      where: { publicProfileEnabled: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        fullname: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    res.status(200).json({
      status: 'success',
      results: professionals.length,
      data: {
        profiles: professionals.map((professional) => ({
          slug: buildProfileSlug(professional),
          updatedAt: professional.updatedAt,
        })),
      },
    });
  },
);

/**
 * GET /api/professional/public-profile  (protected)
 * Current visibility plus the canonical public URL, for the Career Summary toggle.
 */
export const getMyPublicProfileSettings = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    if (!professionalId) {
      return next(new AppError('User not authenticated', 401));
    }

    const professional = await prisma.professional.findUnique({
      where: { id: professionalId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        fullname: true,
        publicProfileEnabled: true,
      },
    });

    if (!professional) {
      return next(new AppError('Professional not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: {
        publicProfileEnabled: professional.publicProfileEnabled,
        slug: buildProfileSlug(professional),
      },
    });
  },
);

/**
 * PATCH /api/professional/public-profile  (protected)
 * Body: { publicProfileEnabled: boolean }
 */
export const updateMyPublicProfileSettings = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    if (!professionalId) {
      return next(new AppError('User not authenticated', 401));
    }

    const { publicProfileEnabled } = req.body;
    if (typeof publicProfileEnabled !== 'boolean') {
      return next(
        new AppError('publicProfileEnabled must be true or false', 400),
      );
    }

    const professional = await prisma.professional.update({
      where: { id: professionalId },
      data: { publicProfileEnabled },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        fullname: true,
        publicProfileEnabled: true,
      },
    });

    res.status(200).json({
      status: 'success',
      message: publicProfileEnabled
        ? 'Your profile is now public and can appear in search engines.'
        : 'Your profile is no longer public.',
      data: {
        publicProfileEnabled: professional.publicProfileEnabled,
        slug: buildProfileSlug(professional),
      },
    });
  },
);
