import { Router } from 'express';
import * as bookingController from '../controllers/courseBookingController.js';
import { handleAppleWebhook } from '../controllers/appleWebhookController.js';
import express from 'express';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Webhooks
 *   description: Stripe webhook endpoints
 */

/**
 * @swagger
 * /api/webhooks/stripe:
 *   post:
 *     summary: Handle Stripe webhook events
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook received
 *       400:
 *         description: Invalid signature
 */
router.post(
  '/stripe',
  express.raw({ type: 'application/json' }), // Raw body needed for signature verification
  bookingController.handleStripeWebhook,
);

/**
 * @swagger
 * /api/webhooks/apple:
 *   post:
 *     summary: App Store Server Notifications V2 (iOS in-app purchase)
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Notification received
 *       400:
 *         description: Invalid signature
 */
router.post(
  '/apple',
  // Notification authenticity is verified by decoding the JWS itself
  // (see appleIapService.ts), not an HMAC over the raw body — unlike Stripe,
  // this only needs the body parsed as JSON, not the raw bytes.
  express.json(),
  handleAppleWebhook,
);

export default router;
