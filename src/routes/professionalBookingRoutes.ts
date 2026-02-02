import { Router } from 'express';
import * as bookingController from '../controllers/courseBookingController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Course Bookings
 *   description: Professional course booking and payment management
 */

/**
 * @swagger
 * /api/professional/courses/{courseId}/checkout:
 *   post:
 *     summary: Create a Stripe checkout session for course booking
 *     tags: [Course Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *         description: Course ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: Optional specific course session ID
 *     responses:
 *       200:
 *         description: Checkout session created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     checkoutUrl:
 *                       type: string
 *                     bookingId:
 *                       type: string
 *       404:
 *         description: Course not found
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/courses/:courseId/checkout',
  protect,
  bookingController.createCheckoutSession,
);

/**
 * @swagger
 * /api/professional/bookings:
 *   get:
 *     summary: Get all bookings for the current professional
 *     tags: [Course Bookings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of bookings
 *       401:
 *         description: Unauthorized
 */
router.get('/bookings', protect, bookingController.getMyBookings);

/**
 * @swagger
 * /api/professional/bookings/{bookingId}:
 *   get:
 *     summary: Get a specific booking by ID
 *     tags: [Course Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Booking ID
 *     responses:
 *       200:
 *         description: Booking details
 *       404:
 *         description: Booking not found
 *       401:
 *         description: Unauthorized
 */
router.get('/bookings/:bookingId', protect, bookingController.getBookingById);

export default router;
