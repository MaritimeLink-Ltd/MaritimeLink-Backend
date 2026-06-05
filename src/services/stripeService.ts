import Stripe from 'stripe';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { logActivity } from './activityLogger.js';
import { ActionStatus, ActorType } from '../generated/client/index.js';
import { AppError } from '../utils/AppError.js';
import {
  notifyCourseBookingPaymentSuccess,
  notifyPaymentOutcome,
  safeNotify,
} from './eventNotificationService.js';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-01-28.clover',
});

interface CreateCheckoutSessionParams {
  courseId: string;
  professionalId: string;
  amount: number;
  currency: string;
  courseTitle: string;
  priceId?: string;
  sessionIds?: string[];
  documentIds?: string[];
}

let cachedPriceId: string | null = null;

export type MembershipPlanCode = 'FREE' | 'BASIC' | 'PRO' | 'PREMIUM';

export interface MembershipPlanOption {
  /** Stripe Price id for paid plans, or `FREE` for the free tier */
  id: string;
  planCode: MembershipPlanCode;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  interval: string;
  stripePriceId: string | null;
  /** Tier stored on Professional after successful subscription */
  membershipTier: 'FREE' | 'PRO';
  popular: boolean;
}

const EXCLUDED_MEMBERSHIP_PRODUCT_NAMES = new Set(['course']);

function deriveMembershipPlanCode(productName: string): MembershipPlanCode {
  const name = productName.toLowerCase();
  if (name.includes('basic')) return 'BASIC';
  if (name.includes('plus')) return 'PREMIUM';
  if (name.includes('professional')) return 'PRO';
  if (name.includes('premium')) return 'PREMIUM';
  return 'PRO';
}

export function isBookingPaymentSucceeded(
  paymentStatus: string | null | undefined,
): boolean {
  const status = String(paymentStatus || '').toUpperCase();
  return status === 'SUCCEEDED' || status === 'PAID';
}

function normalizePaymentIntentId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id?: string }).id;
    return id ? String(id) : null;
  }
  return null;
}

export const stripeService = {
  /**
   * List all active products and their prices from Stripe
   */
  async listActivePrices() {
    const products = await stripe.products.list({ active: true });
    const prices = await stripe.prices.list({ active: true });

    return products.data.map((product) => {
      const productPrices = prices.data.filter(
        (price) => price.product === product.id,
      );
      return {
        id: product.id,
        name: product.name,
        description: product.description,
        prices: productPrices.map((price) => ({
          id: price.id,
          amount: price.unit_amount ? price.unit_amount / 100 : 0,
          currency: price.currency,
        })),
      };
    });
  },

  /**
   * Get the fixed Price ID for the product named 'Course'
   */
  async getFixedPriceId() {
    if (cachedPriceId) return cachedPriceId;

    const products = await stripe.products.list({ active: true });
    const courseProduct = products.data.find((p) => p.name === 'Course');

    if (!courseProduct) {
      throw new Error('Product named Course not found in Stripe dashboard.');
    }

    const prices = await stripe.prices.list({
      product: courseProduct.id,
      active: true,
      limit: 1,
    });

    if (prices.data.length === 0) {
      throw new Error(
        `No active price found for product '${courseProduct.name}'`,
      );
    }

    cachedPriceId = prices.data[0].id;
    return cachedPriceId;
  },

  /**
   * Create a Stripe Checkout Session for course payment
   */
  async createCheckoutSession(params: CreateCheckoutSessionParams) {
    const {
      courseId,
      professionalId,
      amount,
      currency,
      courseTitle,
      sessionIds,
      documentIds,
    } = params;
    let { priceId } = params;

    // If no specific priceId provided, fetch the fixed one
    if (!priceId) {
      priceId = await this.getFixedPriceId();
    }

    // Create a pending booking in the database with multiple sessions and docs
    const booking = await prisma.courseBooking.create({
      data: {
        professionalId,
        courseId,
        amountPaid: amount,
        currency,
        bookingStatus: 'PENDING',
        paymentStatus: 'PENDING',
        ...(sessionIds &&
          sessionIds.length > 0 && {
            sessions: {
              connect: sessionIds.map((id) => ({ id })),
            },
          }),
        ...(documentIds &&
          documentIds.length > 0 && {
            attachedDocuments: {
              connect: documentIds.map((id) => ({ id })),
            },
          }),
      },
    });

    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    if (priceId) {
      line_items.push({
        price: priceId,
        quantity: 1,
      });
    } else {
      line_items.push({
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: courseTitle,
            description: `Course booking for ${courseTitle}`,
          },
          unit_amount: Math.round(amount * 100), // Convert to cents
        },
        quantity: 1,
      });
    }

    // Create Stripe Checkout Session
    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: `${env.FRONTEND_URL}/bookings/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.FRONTEND_URL}/courses/${courseId}?canceled=true`,
      client_reference_id: booking.id, // Link to our booking
      metadata: {
        bookingId: booking.id,
        courseId,
        professionalId,
      },
    });

    // Store the Stripe session ID
    await prisma.courseBooking.update({
      where: { id: booking.id },
      data: { stripeSessionId: checkoutSession.id },
    });

    return {
      checkoutUrl: checkoutSession.url,
      sessionId: checkoutSession.id,
      bookingId: booking.id,
    };
  },

  /**
   * Create a Stripe Checkout Session for course payment with SPLIT PAYMENT (Connect)
   */
  async createConnectCheckoutSession(
    params: CreateCheckoutSessionParams & {
      trainerStripeId: string;
      commissionRate?: number;
    },
  ) {
    const {
      courseId,
      professionalId,
      amount,
      currency,
      courseTitle,
      trainerStripeId,
      commissionRate = 18, // Default to 18%
    } = params;

    const commissionAmount = Math.round(amount * (commissionRate / 100) * 100); // in cents

    const booking = await prisma.courseBooking.create({
      data: {
        professionalId,
        courseId,
        amountPaid: amount,
        currency,
        bookingStatus: 'PENDING',
        paymentStatus: 'PENDING',
        platformFee: amount * (commissionRate / 100),
        trainerPayout: amount * (1 - commissionRate / 100),
      },
    });

    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: courseTitle,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      payment_intent_data: {
        application_fee_amount: commissionAmount,
        transfer_data: {
          destination: trainerStripeId,
        },
      },
      success_url: `${env.FRONTEND_URL}/bookings/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.FRONTEND_URL}/courses/${courseId}?canceled=true`,
      client_reference_id: booking.id,
      metadata: {
        bookingId: booking.id,
      },
    });

    await prisma.courseBooking.update({
      where: { id: booking.id },
      data: { stripeSessionId: checkoutSession.id },
    });

    return {
      checkoutUrl: checkoutSession.url,
      sessionId: checkoutSession.id,
      bookingId: booking.id,
    };
  },

  /**
   * Create a Stripe Express account for a trainer
   */
  async createExpressAccount(email: string, recruiterId: string) {
    const account = await stripe.accounts.create({
      type: 'express',
      email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      settings: {
        payouts: {
          schedule: { interval: 'manual' },
        },
      },
      metadata: { recruiterId },
    });

    return account;
  },

  /**
   * Create a Payment Intent for custom UI flows (Stripe Elements)
   */
  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    description: string;
    metadata: Record<string, string>;
  }) {
    const { amount, currency, description, metadata } = params;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      description,
      metadata,
      automatic_payment_methods: {
        enabled: true,
      },
    });

    return paymentIntent;
  },

  /**
   * Transfer funds to a connected trainer account (82% payout)
   */
  async createTransfer(params: {
    amount: number;
    currency: string;
    destinationAccountId: string;
    bookingId: string;
  }) {
    const { amount, currency, destinationAccountId, bookingId } = params;

    const transfer = await stripe.transfers.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      destination: destinationAccountId,
      description: `Payout for booking ${bookingId}`,
      metadata: { bookingId },
    });

    return transfer;
  },

  /**
   * Create an account link for onboarding
   */
  async createAccountLink(stripeAccountId: string) {
    return stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${env.FRONTEND_URL}/trainingprovider/payouts/reauth`,
      return_url: `${env.FRONTEND_URL}/trainingprovider/payouts/success`,
      type: 'account_onboarding',
    });
  },

  /**
   * Retrieve a connected account directly from Stripe.
   */
  async retrieveAccount(stripeAccountId: string) {
    return stripe.accounts.retrieve(stripeAccountId);
  },

  /**
   * List active recurring membership products/prices from Stripe (no env price IDs).
   */
  async listMembershipPlans(): Promise<MembershipPlanOption[]> {
    const [products, prices] = await Promise.all([
      stripe.products.list({ active: true, limit: 100 }),
      stripe.prices.list({ active: true, type: 'recurring', limit: 100 }),
    ]);

    const plans: MembershipPlanOption[] = [];

    for (const product of products.data) {
      const productName = (product.name || '').trim();
      const nameLower = productName.toLowerCase();
      if (!productName || EXCLUDED_MEMBERSHIP_PRODUCT_NAMES.has(nameLower)) {
        continue;
      }

      const productPrices = prices.data.filter((p) => p.product === product.id);
      const price =
        productPrices.find((p) => p.recurring?.interval === 'month') ||
        productPrices.sort(
          (a, b) => (a.unit_amount ?? 0) - (b.unit_amount ?? 0),
        )[0];

      if (!price?.unit_amount) continue;

      const planCode = deriveMembershipPlanCode(productName);

      plans.push({
        id: price.id,
        planCode,
        name: productName,
        description: product.description ?? null,
        price: price.unit_amount / 100,
        currency: price.currency.toUpperCase(),
        interval: price.recurring?.interval || 'month',
        stripePriceId: price.id,
        membershipTier: 'PRO',
        popular: planCode === 'PRO',
      });
    }

    plans.sort((a, b) => a.price - b.price);
    return plans;
  },

  /**
   * Plans shown in the app: free tier + Stripe catalog.
   */
  async listMembershipPlansForApp(): Promise<MembershipPlanOption[]> {
    const paidPlans = await this.listMembershipPlans();
    return [
      {
        id: 'FREE',
        planCode: 'FREE',
        name: 'Free',
        description: 'Basic access with standard profile visibility.',
        price: 0,
        currency: paidPlans[0]?.currency || 'GBP',
        interval: 'month',
        stripePriceId: null,
        membershipTier: 'FREE',
        popular: false,
      },
      ...paidPlans,
    ];
  },

  async validateMembershipPriceId(
    stripePriceId: string,
  ): Promise<MembershipPlanOption> {
    const plans = await this.listMembershipPlans();
    const match = plans.find((p) => p.stripePriceId === stripePriceId);
    if (match) return match;

    const price = await stripe.prices.retrieve(stripePriceId);
    if (!price.active || price.type !== 'recurring') {
      throw new AppError(
        'Selected plan is not an active subscription price',
        400,
      );
    }

    const productId =
      typeof price.product === 'string' ? price.product : price.product.id;
    const product = await stripe.products.retrieve(productId);
    const nameLower = (product.name || '').toLowerCase();
    if (EXCLUDED_MEMBERSHIP_PRODUCT_NAMES.has(nameLower)) {
      throw new AppError(
        'This product cannot be used as a membership plan',
        400,
      );
    }

    if (!price.unit_amount) {
      throw new AppError('Selected plan has no price amount', 400);
    }

    const planCode = deriveMembershipPlanCode(product.name || '');
    return {
      id: price.id,
      planCode,
      name: product.name || 'Membership',
      description: product.description ?? null,
      price: price.unit_amount / 100,
      currency: price.currency.toUpperCase(),
      interval: price.recurring?.interval || 'month',
      stripePriceId: price.id,
      membershipTier: 'PRO',
      popular: planCode === 'PRO',
    };
  },

  /**
   * Stripe Checkout (subscription) for professional membership upgrade.
   */
  async createMembershipCheckoutSession(params: {
    professionalId: string;
    email: string;
    stripePriceId: string;
    planCode?: string;
  }) {
    const plan = await this.validateMembershipPriceId(params.stripePriceId);
    const planCode = params.planCode || plan.planCode;

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: params.stripePriceId, quantity: 1 }],
      success_url: `${env.FRONTEND_URL}/personal/profile?membership=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.FRONTEND_URL}/personal/profile?membership=canceled`,
      customer_email: params.email,
      client_reference_id: params.professionalId,
      metadata: {
        type: 'membership',
        professionalId: params.professionalId,
        plan: planCode,
        stripePriceId: params.stripePriceId,
      },
      subscription_data: {
        metadata: {
          type: 'membership',
          professionalId: params.professionalId,
          plan: planCode,
          stripePriceId: params.stripePriceId,
        },
      },
    });

    if (!checkoutSession.url) {
      throw new AppError('Stripe did not return a checkout URL', 502);
    }

    return {
      checkoutUrl: checkoutSession.url,
      sessionId: checkoutSession.id,
    };
  },

  /**
   * Activate PRO tier after successful membership checkout (webhook or success redirect).
   */
  async activateMembershipFromSession(session: Stripe.Checkout.Session) {
    if (session.metadata?.type !== 'membership') {
      return null;
    }

    const professionalId =
      session.metadata?.professionalId || session.client_reference_id;
    if (!professionalId) {
      console.error('Membership checkout missing professionalId');
      return null;
    }

    const isComplete =
      session.payment_status === 'paid' ||
      session.payment_status === 'no_payment_required' ||
      session.status === 'complete';
    if (!isComplete) {
      return null;
    }

    const professional = await prisma.professional.update({
      where: { id: professionalId },
      data: {
        tier: 'PRO',
        membershipUpdatedAt: new Date(),
      },
      select: {
        tier: true,
        membershipUpdatedAt: true,
      },
    });

    await logActivity({
      action: 'MEMBERSHIP_UPGRADED',
      actorId: professionalId,
      actorType: ActorType.PROFESSIONAL,
      targetId: professionalId,
      targetType: 'Professional',
      status: ActionStatus.SUCCESS,
      metadata: {
        plan: session.metadata?.plan || 'PRO',
        stripeSessionId: session.id,
        stripeSubscriptionId:
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id,
      },
    });

    const amountTotal = session.amount_total;
    safeNotify('membership-payment', () =>
      notifyPaymentOutcome({
        professionalId,
        success: true,
        description: `Your Maritime Link ${session.metadata?.plan || 'PRO'} membership payment was successful.`,
        amount: amountTotal != null ? amountTotal / 100 : undefined,
        currency: session.currency?.toUpperCase() || 'GBP',
      }),
    );

    return professional;
  },

  async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const professionalId = subscription.metadata?.professionalId;
    if (!professionalId || subscription.metadata?.type !== 'membership') {
      return;
    }

    await prisma.professional.update({
      where: { id: professionalId },
      data: {
        tier: 'FREE',
        membershipUpdatedAt: new Date(),
      },
    });
  },

  /**
   * Handle Stripe webhook events
   */
  async handleWebhook(signature: string, rawBody: Buffer) {
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET;

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      throw new Error(`Webhook signature verification failed: ${err}`);
    }

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutComplete(
          event.data.object as Stripe.Checkout.Session,
        );
        break;

      case 'account.updated':
        await this.handleAccountUpdate(event.data.object as Stripe.Account);
        break;

      case 'payment_intent.succeeded':
        await this.handlePaymentSuccess(
          event.data.object as Stripe.PaymentIntent,
        );
        break;

      case 'payment_intent.payment_failed':
        await this.handlePaymentFailed(
          event.data.object as Stripe.PaymentIntent,
        );
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return { received: true };
  },

  /**
   * Handle account updates (Onboarding completion)
   */
  async handleAccountUpdate(account: Stripe.Account) {
    if (account.details_submitted) {
      const recruiterId = account.metadata?.recruiterId;
      if (recruiterId) {
        await prisma.recruiter.update({
          where: { id: recruiterId },
          data: { stripeOnboardingComplete: true },
        });
      }
    }
  },

  /**
   * Handle successful checkout session
   */
  async handleCheckoutComplete(session: Stripe.Checkout.Session) {
    if (session.metadata?.type === 'membership') {
      await this.activateMembershipFromSession(session);
      return;
    }

    const bookingId = session.metadata?.bookingId;

    if (!bookingId) {
      console.error('No booking ID in session metadata');
      return;
    }

    const booking = await prisma.courseBooking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        courseId: true,
        amountPaid: true,
        currency: true,
        paymentStatus: true,
        course: {
          select: {
            title: true,
          },
        },
      },
    });

    if (!booking) {
      console.error(`Booking ${bookingId} not found`);
      return;
    }

    const wasPaid = booking.paymentStatus === 'SUCCEEDED';
    const paymentIntentId = normalizePaymentIntentId(session.payment_intent);

    await prisma.courseBooking.update({
      where: { id: bookingId },
      data: {
        paymentStatus: 'SUCCEEDED',
        bookingStatus: 'CONFIRMED',
        ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
        paidAt: new Date(),
      },
    });

    if (!wasPaid) {
      safeNotify('course-booking-paid', () =>
        notifyCourseBookingPaymentSuccess(bookingId),
      );
    }

    await logActivity({
      action: 'COURSE_PURCHASED',
      actorId: booking.professionalId,
      actorType: ActorType.PROFESSIONAL,
      targetId: booking.id,
      targetType: 'CourseBooking',
      status: ActionStatus.SUCCESS,
      metadata: {
        courseId: booking.courseId,
        courseTitle: booking.course?.title,
        amountPaid: booking.amountPaid,
        currency: booking.currency,
        stripeSessionId: session.id,
      },
    });

    console.log(`Booking ${bookingId} paid and awaiting trainer approval`);
  },

  /**
   * Handle successful payment intent
   */
  async handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
    const booking = await prisma.courseBooking.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (booking) {
      const wasPaid = booking.paymentStatus === 'SUCCEEDED';
      await prisma.courseBooking.update({
        where: { id: booking.id },
        data: {
          paymentStatus: 'SUCCEEDED',
          bookingStatus: 'CONFIRMED',
          paidAt: new Date(),
        },
      });
      if (!wasPaid) {
        safeNotify('course-booking-paid', () =>
          notifyCourseBookingPaymentSuccess(booking.id),
        );
      }
    }
  },

  /**
   * Resolve Stripe PaymentIntent id from a booking record.
   */
  async resolvePaymentIntentIdForBooking(booking: {
    id?: string;
    stripePaymentIntentId?: string | null;
    stripeSessionId?: string | null;
  }): Promise<string | null> {
    const fromBooking = normalizePaymentIntentId(booking.stripePaymentIntentId);
    if (fromBooking) return fromBooking;

    if (booking.stripeSessionId) {
      const session = await stripe.checkout.sessions.retrieve(
        booking.stripeSessionId,
        { expand: ['payment_intent'] },
      );
      const fromSession = normalizePaymentIntentId(session.payment_intent);
      if (fromSession) return fromSession;
    }

    if (!booking.id) return null;

    try {
      const search = await stripe.paymentIntents.search({
        query: `metadata['bookingId']:'${booking.id}'`,
        limit: 1,
      });
      const fromSearch = search.data[0]?.id;
      if (fromSearch) return fromSearch;
    } catch (error) {
      console.warn(
        `Stripe PaymentIntent search failed for booking ${booking.id}:`,
        error,
      );
    }

    return null;
  },

  async retrievePaymentIntent(paymentIntentId: string) {
    const id = normalizePaymentIntentId(paymentIntentId);
    if (!id) {
      throw new AppError('Invalid payment reference', 400);
    }
    return stripe.paymentIntents.retrieve(id);
  },

  /**
   * Handle failed payment intent
   */
  async handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
    const booking = await prisma.courseBooking.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
      include: {
        course: {
          select: {
            title: true,
          },
        },
        sessions: {
          select: { id: true },
        },
      },
    });

    if (booking) {
      await prisma.$transaction(async (tx) => {
        await tx.courseBooking.update({
          where: { id: booking.id },
          data: {
            paymentStatus: 'FAILED',
            bookingStatus: 'CANCELLED',
          },
        });

        await Promise.all(
          booking.sessions.map((session) =>
            tx.courseSession.update({
              where: { id: session.id },
              data: {
                availableSeats: {
                  increment: 1,
                },
              },
            }),
          ),
        );
      });

      await logActivity({
        action: 'COURSE_PURCHASE_FAILED',
        actorId: booking.professionalId,
        actorType: ActorType.PROFESSIONAL,
        targetId: booking.id,
        targetType: 'CourseBooking',
        status: ActionStatus.FAILED,
        metadata: {
          courseId: booking.courseId,
          courseTitle: booking.course?.title,
          stripePaymentIntentId: paymentIntent.id,
        },
      });

      safeNotify('payment-failed', () =>
        notifyPaymentOutcome({
          professionalId: booking.professionalId,
          success: false,
          description: `Payment for your course booking (${booking.course?.title || 'training'}) could not be completed.`,
          amount: Number(booking.amountPaid),
          currency: booking.currency || 'GBP',
        }),
      );
      return;
    }

    const professionalId = paymentIntent.metadata?.professionalId;
    if (professionalId) {
      safeNotify('payment-failed', () =>
        notifyPaymentOutcome({
          professionalId,
          success: false,
          description:
            'A payment on your Maritime Link account could not be completed.',
          amount:
            paymentIntent.amount != null
              ? paymentIntent.amount / 100
              : undefined,
          currency: paymentIntent.currency?.toUpperCase(),
        }),
      );
    }
  },

  /**
   * Retrieve a checkout session
   */
  async getCheckoutSession(sessionId: string) {
    return stripe.checkout.sessions.retrieve(sessionId);
  },

  /**
   * Refund a card payment back to the professional (full amount on the PaymentIntent).
   */
  async refundPayment(paymentIntentId: string) {
    const id = normalizePaymentIntentId(paymentIntentId);
    if (!id) {
      throw new AppError('Invalid payment reference for refund', 400);
    }

    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(id);
      const refundParams: Stripe.RefundCreateParams = {
        payment_intent: id,
      };

      // Connect destination charges need transfer reversal so funds return to the card.
      if (paymentIntent.transfer_data?.destination) {
        refundParams.reverse_transfer = true;
        refundParams.refund_application_fee = true;
      }

      const existingRefunds = await stripe.refunds.list({
        payment_intent: id,
        limit: 1,
      });
      if (existingRefunds.data.length > 0) {
        return existingRefunds.data[0];
      }

      return await stripe.refunds.create(refundParams);
    } catch (error) {
      console.error('Stripe refund error:', error);
      if (error instanceof AppError) throw error;
      const message =
        error instanceof Stripe.errors.StripeError
          ? error.message
          : 'Failed to process refund with Stripe';
      throw new AppError(message, 400);
    }
  },
};
