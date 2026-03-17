import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';
import { stripeService } from '../services/stripeService.js';
import { AppError } from '../utils/AppError.js';

/**
 * @desc    Initiate Stripe Connect onboarding for a trainer
 * @route   POST /api/admin/trainers/:id/initiate-stripe
 * @access  Private (Admin)
 */
export const initiateTrainerStripe = catchAsync(
  async (req: CustomRequest, res: Response, next) => {
    const { id } = req.params;

    const trainer = await prisma.recruiter.findUnique({
      where: { id },
    });

    if (!trainer) {
      return next(new AppError('Trainer not found', 404));
    }

    if (trainer.role !== 'TRAINING_AGENT') {
      return next(
        new AppError('Only trainers can be onboarded for payouts', 400),
      );
    }

    let stripeAccountId = trainer.stripeAccountId;

    // Create connected account if not already exists
    if (!stripeAccountId) {
      const account = await stripeService.createExpressAccount(
        trainer.email,
        trainer.id,
      );
      stripeAccountId = account.id;

      await prisma.recruiter.update({
        where: { id: trainer.id },
        data: { stripeAccountId },
      });
    }

    // Create account link for onboarding
    const accountLink = await stripeService.createAccountLink(stripeAccountId);

    res.status(200).json({
      status: 'success',
      data: {
        onboardingUrl: accountLink.url,
      },
    });
  },
);

/**
 * @desc    Get trainer payout stats (Revenue, Commission, Net)
 * @route   GET /api/admin/trainers/payout-stats
 * @access  Private (Admin)
 */
export const getTrainerPayoutStats = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const bookings = await prisma.courseBooking.findMany({
      where: { paymentStatus: 'SUCCEEDED' },
      include: {
        course: {
          select: {
            title: true,
            recruiter: {
              select: {
                organizationName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { paidAt: 'desc' },
    });

    const totalRevenue = bookings.reduce(
      (sum, b) => sum + Number(b.amountPaid),
      0,
    );
    const totalCommission = bookings.reduce(
      (sum, b) => sum + (Number(b.platformFee) || 0),
      0,
    );
    const totalPayouts = bookings.reduce(
      (sum, b) => sum + (Number(b.trainerPayout) || 0),
      0,
    );

    res.status(200).json({
      status: 'success',
      data: {
        stats: {
          totalRevenue,
          totalCommission,
          totalPayouts,
        },
        recentPayouts: bookings.map((b) => ({
          id: b.id,
          date: b.paidAt,
          trainer:
            b.course.recruiter?.organizationName || b.course.recruiter?.email,
          course: b.course.title,
          amount: b.amountPaid,
          commission: b.platformFee,
          net: b.trainerPayout,
        })),
      },
    });
  },
);
