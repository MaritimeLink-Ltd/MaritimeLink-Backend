import { Router } from 'express';
import * as bookingController from '../controllers/courseBookingController.js';
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

export default router;
