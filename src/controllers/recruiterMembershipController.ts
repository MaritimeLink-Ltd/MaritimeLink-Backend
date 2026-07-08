import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';
import { stripeService } from '../services/stripeService.js';

const RECRUITER_PLANS = [
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
    price: 99.9,
    currency: 'GBP',
    interval: 'one_time',
  },
  {
    id: 'PREMIUM',
    planCode: 'PREMIUM' as const,
    name: 'Premium Recruiter',
    price: 199.9,
    currency: 'GBP',
    interval: 'month',
  },
];

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

    res.status(200).json({
      status: 'success',
      data: {
        membership: {
          tier: recruiter.tier,
          membershipUpdatedAt: recruiter.membershipUpdatedAt,
          plans: RECRUITER_PLANS,
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
