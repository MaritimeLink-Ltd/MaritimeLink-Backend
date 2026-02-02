import Stripe from 'stripe';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-01-28.clover',
});

interface CreateCheckoutSessionParams {
  courseId: string;
  professionalId: string;
  amount: number;
  currency: string;
  courseTitle: string;
  sessionId?: string;
}

export const stripeService = {
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
      sessionId,
    } = params;

    // Create a pending booking in the database
    const booking = await prisma.courseBooking.create({
      data: {
        professionalId,
        courseId,
        sessionId: sessionId || null,
        amountPaid: amount,
        currency,
        bookingStatus: 'PENDING',
        paymentStatus: 'PENDING',
      },
    });

    // Create Stripe Checkout Session
    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: courseTitle,
              description: `Course booking for ${courseTitle}`,
            },
            unit_amount: Math.round(amount * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
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

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return { received: true };
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

    await prisma.courseBooking.update({
      where: { id: bookingId },
      data: {
        paymentStatus: 'SUCCEEDED',
        bookingStatus: 'CONFIRMED',
        stripePaymentIntentId: session.payment_intent as string,
        paidAt: new Date(),
      },
    });

    // TODO: Send confirmation email to professional
    console.log(`Booking ${bookingId} confirmed`);
  },

  /**
   * Handle successful payment intent
   */
  async handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
    const booking = await prisma.courseBooking.findUnique({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (booking) {
      await prisma.courseBooking.update({
        where: { id: booking.id },
        data: {
          paymentStatus: 'SUCCEEDED',
          bookingStatus: 'CONFIRMED',
          paidAt: new Date(),
        },
      });
    }
  },

  /**
   * Handle failed payment intent
   */
  async handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
    const booking = await prisma.courseBooking.findUnique({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (booking) {
      await prisma.courseBooking.update({
        where: { id: booking.id },
        data: {
          paymentStatus: 'FAILED',
          bookingStatus: 'CANCELLED',
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
};
