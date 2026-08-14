import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';
import { stripeService } from '../services/stripeService.js';

/**
 * Plan cards shown to recruiters. Flex/Premium pricing is fetched live from
 * Stripe (see `stripeService.getRecruiterPlanPricing`) so this never drifts
 * from what checkout actually charges — it previously hardcoded £99.90/£199.90
 * while the live Stripe prices were £49.99/£159.99.
 */
async function buildRecruiterPlans() {
  const pricing = await stripeService.getRecruiterPlanPricing();

  return [
    {
      id: 'FREE',
      planCode: 'FREE' as const,
      name: 'Free Recruiter',
      price: 0,
      currency: 'GBP',
      interval: 'month',
    },
    {
      id: 'FLEX',
      planCode: 'FLEX' as const,
      name: 'Flex Recruiter',
      description: 'Purchased per job listing from the job posting screen.',
      price: pricing.flex.price,
      currency: pricing.flex.currency,
      interval: pricing.flex.interval,
    },
    {
      id: 'PREMIUM',
      planCode: 'PREMIUM' as const,
      name: 'Premium Recruiter',
      price: pricing.premium.price,
      currency: pricing.premium.currency,
      interval: pricing.premium.interval,
    },
  ];
}

export const getRecruiterMembership = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) {
      return next(new AppError('Unauthorized', 401));
    }

    const recruiter = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
      select: { tier: true, membershipUpdatedAt: true },
    });

    if (!recruiter) {
      return next(new AppError('Recruiter account not found', 404));
    }

    // Flex is bought per listing, so it is not on `tier`. The client needs to know
    // whether any listing is still live to mirror the server's feature matrix.
    const activeFlexListing = await prisma.job.findFirst({
      where: {
        recruiterId,
        isPremiumListing: true,
        premiumListingExpiresAt: { gt: new Date() },
      },
      select: { premiumListingExpiresAt: true },
      orderBy: { premiumListingExpiresAt: 'asc' },
    });

    const plans = await buildRecruiterPlans();

    res.status(200).json({
      status: 'success',
      data: {
        membership: {
          tier: recruiter.tier,
          membershipUpdatedAt: recruiter.membershipUpdatedAt,
          hasActiveFlexListing: Boolean(activeFlexListing),
          flexListingExpiresAt:
            activeFlexListing?.premiumListingExpiresAt ?? null,
          plans,
        },
      },
    });
  },
);

export const createRecruiterMembershipCheckout = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) {
      return next(new AppError('Unauthorized', 401));
    }

    const recruiter = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
      select: { email: true, tier: true },
    });

    if (!recruiter?.email) {
      return next(new AppError('Recruiter account not found', 404));
    }

    if (recruiter.tier === 'PREMIUM') {
      return next(
        new AppError('You already have an active Premium Recruiter plan', 400),
      );
    }

    const checkout =
      await stripeService.createRecruiterMembershipCheckoutSession({
        recruiterId,
        email: recruiter.email,
      });

    res.status(200).json({
      status: 'success',
      message: 'Checkout session created.',
      data: checkout,
    });
  },
);

export const confirmRecruiterMembershipCheckout = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) {
      return next(new AppError('Unauthorized', 401));
    }

    const sessionId =
      (req.query.session_id as string) || (req.body.sessionId as string);
    if (!sessionId) {
      return next(new AppError('session_id is required', 400));
    }

    const session = await stripeService.getCheckoutSession(sessionId);
    const sessionRecruiterId =
      session.metadata?.recruiterId || session.client_reference_id;

    if (sessionRecruiterId !== recruiterId) {
      return next(
        new AppError('Checkout session does not belong to this account', 403),
      );
    }

    if (session.metadata?.type !== 'recruiter_membership') {
      return next(new AppError('Invalid checkout session type', 400));
    }

    const membership =
      await stripeService.activateRecruiterMembershipFromSession(session);

    if (!membership) {
      return next(
        new AppError(
          'Payment is not complete yet. Please wait a moment and refresh.',
          400,
        ),
      );
    }

    res.status(200).json({
      status: 'success',
      message: 'Membership activated successfully.',
      data: { membership },
    });
  },
);

export const updateRecruiterMembership = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const tier = req.body.tier;

    if (tier !== 'FREE') {
      return next(
        new AppError(
          'Paid plans require card checkout. Use membership checkout instead.',
          400,
        ),
      );
    }

    // A paid Flex listing runs for its full 30 days. While one is live the account
    // may only move up to Premium, never down to Free.
    const activeFlexListing = await prisma.job.findFirst({
      where: {
        recruiterId: req.user?.id,
        isPremiumListing: true,
        premiumListingExpiresAt: { gt: new Date() },
      },
      select: { premiumListingExpiresAt: true },
    });

    if (activeFlexListing) {
      return next(
        new AppError(
          `You have an active Flex listing until ${activeFlexListing.premiumListingExpiresAt?.toISOString().slice(0, 10)}. You can upgrade to Premium, but cannot switch to Free before it expires.`,
          400,
        ),
      );
    }

    const recruiter = await prisma.recruiter.update({
      where: { id: req.user?.id },
      data: {
        tier: 'FREE',
        membershipUpdatedAt: new Date(),
      },
      select: {
        tier: true,
        membershipUpdatedAt: true,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Membership updated successfully.',
      data: { membership: recruiter },
    });
  },
);

export const createFlexListingCheckout = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { id: jobId } = req.params;

    const recruiter = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
      select: { email: true },
    });

    if (!recruiter?.email) {
      return next(new AppError('Recruiter account not found', 404));
    }

    const checkout =
      await stripeService.createRecruiterFlexListingCheckoutSession({
        recruiterId,
        jobId,
        email: recruiter.email,
      });

    res.status(200).json({
      status: 'success',
      message: 'Checkout session created.',
      data: checkout,
    });
  },
);

export const confirmFlexListingCheckout = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) {
      return next(new AppError('Unauthorized', 401));
    }

    const sessionId =
      (req.query.session_id as string) || (req.body.sessionId as string);
    if (!sessionId) {
      return next(new AppError('session_id is required', 400));
    }

    const session = await stripeService.getCheckoutSession(sessionId);
    if (session.metadata?.recruiterId !== recruiterId) {
      return next(
        new AppError('Checkout session does not belong to this account', 403),
      );
    }

    if (session.metadata?.type !== 'recruiter_flex_listing') {
      return next(new AppError('Invalid checkout session type', 400));
    }

    const job = await stripeService.activateFlexListingFromSession(session);

    if (!job) {
      return next(
        new AppError(
          'Payment is not complete yet. Please wait a moment and refresh.',
          400,
        ),
      );
    }

    res.status(200).json({
      status: 'success',
      message: 'Flex listing activated successfully.',
      data: { job },
    });
  },
);
