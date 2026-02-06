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
  priceId?: string;
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
    const { courseId, professionalId, amount, currency, courseTitle } = params;
    let { priceId } = params;

    // If no specific priceId provided, fetch the fixed one
    if (!priceId) {
      priceId = await this.getFixedPriceId();
    }

    // Create a pending booking in the database
    const booking = await prisma.courseBooking.create({
      data: {
        professionalId,
        courseId,
        amountPaid: amount,
        currency,
        bookingStatus: 'PENDING',
        paymentStatus: 'PENDING',
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
