import { Response } from 'express';
import { Prisma } from '../generated/client/index.js';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { ActorType } from '../generated/client/index.js';
import { logActivity } from '../services/activityLogger.js';
import { getClientIp } from '../utils/requestMetadata.js';

/**
 * Admin visibility and moderation over the scraped/external job pool
 * (SerpApi, JSearch, syndicated RSS feeds — see src/services/externalJobs).
 * These are surfaced to professionals as part of MaritimeLink's own job
 * listings, so admin needs the same review/removal control here that they
 * have over admin-created MaritimeLink Listings — the API/AI sourcing them
 * has no way to verify a posting is genuine, so a human backstop is the only
 * thing standing between a scam listing and a professional applying to it.
 */

/**
 * @desc    List scraped/external job listings for admin review
 * @route   GET /api/admin/external-jobs
 * @access  Private (Admin)
 */
export const getExternalJobListingsForAdmin = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search as string | undefined;
    const provider = req.query.provider as string | undefined;

    // Removed listings are gone from this view too — matches the "delete"
    // mental model even though the row survives (hiddenByAdmin) for audit
    // and to stop a daily re-fetch from resurrecting it.
    const where: Prisma.ExternalJobListingWhereInput = { hiddenByAdmin: false };

    if (provider) where.provider = provider;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [listings, total] = await Promise.all([
      prisma.externalJobListing.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fetchedAt: 'desc' },
      }),
      prisma.externalJobListing.count({ where }),
    ]);

    res.status(200).json({
      status: 'success',
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
      data: { listings, total },
    });
  },
);

/**
 * @desc    Remove a scraped/external job listing (bad, suspicious, or scam)
 * @route   DELETE /api/admin/external-jobs/:id
 * @access  Private (Admin)
 *
 * Soft-hide, not a hard delete: refresh.ts's daily upsert never touches
 * hiddenByAdmin, so if the same source id gets re-listed tomorrow it stays
 * hidden — a hard delete would let it silently reappear, defeating the
 * point of admin review. The row survives for audit (who removed it, when).
 */
export const deleteExternalJobListing = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { id } = req.params;
    const adminId = req.user!.id;

    const listing = await prisma.externalJobListing.findUnique({
      where: { id },
    });
    if (!listing) {
      throw new AppError('Listing not found', 404);
    }
    if (listing.hiddenByAdmin) {
      return res.status(200).json({
        status: 'success',
        message: 'Listing already removed',
      });
    }

    await prisma.externalJobListing.update({
      where: { id },
      data: {
        hiddenByAdmin: true,
        hiddenAt: new Date(),
        hiddenByAdminId: adminId,
      },
    });

    await logActivity({
      action: 'EXTERNAL_JOB_REMOVED',
      actorId: adminId,
      actorType: ActorType.ADMIN,
      targetId: id,
      targetType: 'ExternalJobListing',
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
      metadata: {
        title: listing.title,
        company: listing.company,
        provider: listing.provider,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Listing removed',
    });
  },
);
