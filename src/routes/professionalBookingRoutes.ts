import { Router } from 'express';
import * as bookingController from '../controllers/courseBookingController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Course Bookings
 *   description: Endpoints for professionals to browse Stripe products, initiate course checkouts, and manage their bookings.
 */

/**
 * @swagger
 * /api/professional/stripe-prices:
 *   get:
 *     summary: List active Stripe products and prices
 *     description: Retrieve all active products and their corresponding prices directly from the configured Stripe account. Use this to display accurate pricing to users.
 *     tags: [Course Bookings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: A list of products and their prices
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, description: "Stripe Product ID" }
 *                       name: { type: string }
 *                       prices:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             id: { type: string, description: "Stripe Price ID" }
 *                             amount: { type: number }
 *                             currency: { type: string }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/stripe-prices', protect, bookingController.getStripePrices);

/**
 * @swagger
 * /api/professional/course-bookings/checkout:
 *   post:
 *     summary: Initiate course checkout (Stripe Elements)
 *     tags: [Course Bookings]
 *     security:
 *       - bearerAuth: []
 */
router.post('/course-bookings/checkout', protect, bookingController.checkout);

/**
 * @swagger
 * /api/professional/course-bookings/{bookingId}/confirm:
 *   post:
 *     summary: Confirm booking payment fallback
 *     tags: [Course Bookings]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/course-bookings/:bookingId/confirm',
  protect,
  bookingController.confirmBooking,
);

/**
 * @swagger
 * /api/professional/bookings:
 *   get:
 *     summary: View my course bookings
 *     description: Returns a list of all course bookings made by the currently authenticated professional, including status and payment info.
 *     tags: [Course Bookings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of personal bookings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer }
 *                 data:
 *                   type: object
 *                   properties:
 *                     bookings:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/CourseBooking' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/bookings', protect, bookingController.getMyBookings);

/**
 * @swagger
 * /api/professional/bookings/{bookingId}:
 *   get:
 *     summary: Get detailed booking info
 *     description: Retrieve full details for a specific booking by its ID.
 *     tags: [Course Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Booking UUID
 *     responses:
 *       200:
 *         description: Booking details retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     booking: { $ref: '#/components/schemas/CourseBooking' }
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/bookings/:bookingId', protect, bookingController.getBookingById);

/**
 * @swagger
 * /api/professional/bookings/{bookingId}/cancel:
 *   post:
 *     summary: Cancel a course booking
 *     description: Request cancellation of a confirmed or pending booking. This may trigger a refund process depending on platform policy.
 *     tags: [Course Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 example: "Traveling on these dates"
 *     responses:
 *       200:
 *         description: Booking cancelled successfully
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.post('/bookings/:bookingId/cancel', protect, async (req, res, next) => {
  const { cancelBooking } =
    await import('../controllers/professionalCourseController.js');
  return cancelBooking(req, res, next);
});

/**
 * @swagger
 * /api/professional/recommended-courses:
 *   get:
 *     summary: Get AI-powered course recommendations
 *     description: Retrieve a curated list of courses based on your nearing expiration dates of certificates in your document wallet.
 *     tags: [Course Bookings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Recommended courses list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     recommendations:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Course' }
 */
router.get('/recommended-courses', protect, async (req, res, next) => {
  const { getRecommendedCourses } =
    await import('../controllers/professionalCourseController.js');
  return getRecommendedCourses(req, res, next);
});

/**
 * @swagger
 * /api/professional/courses/{id}/toggle-save:
 *   post:
 *     summary: Toggle save/unsave a course
 *     tags: [Course Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Toggle successful
 */
router.post('/courses/:id/toggle-save', protect, async (req, res, next) => {
  const { toggleSaveCourse } =
    await import('../controllers/professionalCourseController.js');
  return toggleSaveCourse(req, res, next);
});

/**
 * @swagger
 * /api/professional/saved-courses:
 *   get:
 *     summary: Get all saved courses
 *     tags: [Course Bookings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of saved courses
 */
router.get('/saved-courses', protect, async (req, res, next) => {
  const { getSavedCourses } =
    await import('../controllers/professionalCourseController.js');
  return getSavedCourses(req, res, next);
});

export default router;
