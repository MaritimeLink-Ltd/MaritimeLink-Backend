import Stripe from 'stripe';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { logActivity } from './activityLogger.js';
import { ActionStatus, ActorType } from '../generated/client/index.js';

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
      throw new Error("Product named 'Course' not found in Stripe dashboard.");
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

    await prisma.courseBooking.update({
      where: { id: bookingId },
      data: {
        paymentStatus: 'SUCCEEDED',
        bookingStatus: 'PENDING',
        stripePaymentIntentId: session.payment_intent as string,
        paidAt: new Date(),
      },
    });

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
      await prisma.courseBooking.update({
        where: { id: booking.id },
        data: {
          paymentStatus: 'SUCCEEDED',
          bookingStatus: 'PENDING',
          paidAt: new Date(),
        },
      });
    }
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
    }
  },

  /**
   * Retrieve a checkout session
   */
  async getCheckoutSession(sessionId: string) {
    return stripe.checkout.sessions.retrieve(sessionId);
  },

  /**
   * Refund a payment
   */
  async refundPayment(paymentIntentId: string) {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
      });
      return refund;
    } catch (error) {
      console.error('Stripe refund error:', error);
      throw new Error('Failed to process refund');
    }
  },
};
