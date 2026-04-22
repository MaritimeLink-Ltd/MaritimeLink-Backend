import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { stripeService } from '../services/stripeService.js';
import { CustomRequest } from '../types/index.js';

/**
 * Initiate Stripe Connect onboarding for a trainer
 */
export const initiateOnboarding = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;

    if (!recruiterId) {
      return next(new AppError('Unauthorized', 401));
    }

    const trainer = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
    });

    if (!trainer) {
      return next(new AppError('Trainer not found', 404));
    }

    // Step 1: Create or get Stripe Account ID
    let stripeAccountId = trainer.stripeAccountId;
    if (!stripeAccountId) {
      const account = await stripeService.createExpressAccount(
        trainer.email,
        trainer.id,
      );
      stripeAccountId = account.id;

      // Store in DB
      await prisma.recruiter.update({
        where: { id: recruiterId },
        data: { stripeAccountId },
      });
    }

    // Step 2: Create Account Link
    const accountLink = await stripeService.createAccountLink(stripeAccountId);

    res.status(200).json({
      status: 'success',
      data: {
        stripeAccountId,
        onboardingUrl: accountLink.url,
      },
    });
  },
);

/**
 * Get Stripe Connect onboarding status for a trainer
 */
export const getOnboardingStatus = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;

    if (!recruiterId) {
      return next(new AppError('Unauthorized', 401));
    }

    const trainer = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
      select: {
        id: true,
        role: true,
        stripeAccountId: true,
        stripeOnboardingComplete: true,
      },
    });

    if (!trainer) {
      return next(new AppError('Trainer not found', 404));
    }

    if (trainer.role !== 'TRAINING_AGENT') {
      return next(
        new AppError('Only trainers can access payout onboarding', 403),
      );
    }

    res.status(200).json({
      status: 'success',
      data: {
        stripeAccountId: trainer.stripeAccountId,
        onboardingComplete: trainer.stripeOnboardingComplete,
        onboardingRequired: !trainer.stripeOnboardingComplete,
      },
    });
  },
);

/**
 * Refresh Stripe onboarding link
 */
export const refreshOnboarding = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;

    if (!recruiterId) {
      return next(new AppError('Unauthorized', 401));
    }

    const trainer = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
    });

    if (!trainer || !trainer.stripeAccountId) {
      return next(
        new AppError('Stripe account not found for this trainer', 404),
      );
    }

    const accountLink = await stripeService.createAccountLink(
      trainer.stripeAccountId,
    );

    res.status(200).json({
      status: 'success',
      data: {
        onboardingUrl: accountLink.url,
      },
    });
  },
);
