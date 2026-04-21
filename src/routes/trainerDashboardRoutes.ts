import { Router } from 'express';
import * as trainerDashboardController from '../controllers/trainerDashboardController.js';
import { protectRecruiter } from '../middlewares/recruiterAuthMiddleware.js';

const router = Router();

// All trainer dashboard routes are protected
router.use(protectRecruiter);

/**
 * @swagger
 * tags:
 *   name: Trainer Dashboard
 *   description: Endpoints for the training provider dashboard metrics and management
 */

/**
 * @swagger
 * /api/trainer/dashboard/stats:
 *   get:
 *     summary: Step 1 - Get Trainer Dashboard Statistics
 *     description: Retrieve key metrics like active courses, new bookings, and demand signals.
 *     tags: [Trainer Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [today, 7d]
 *           default: 7d
 *     responses:
 *       200:
 *         description: Trainer statistics retrieved successfully.
 *         content:
 *           application/json:
 *             example:
 *               status: "success"
 *               data:
 *                 stats:
 *                   activeCoursesCount: 5
 *                   newBookingsCount: 18
 *                   demandSignalsCount: 4
 */
router.get('/stats', trainerDashboardController.getTrainingDashboardStats);

/**
 * @swagger
 * /api/trainer/dashboard/action-items:
 *   get:
 *     summary: Step 2 - Get Trainer Action Required Items
 *     description: Fetches alerts and tasks needing immediate attention for training providers.
 *     tags: [Trainer Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Training action items retrieved successfully.
 *         content:
 *           application/json:
 *             example:
 *               status: "success"
 *               results: 4
 *               data:
 *                 actionItems:
 *                   - type: "LEARNERS_WAITING"
 *                     message: "12 learners waiting for Advanced Engineering Courses"
 *                     action: "VIEW_BOOKINGS"
 *                   - type: "CAPACITY_ALERT"
 *                     message: "Energy Efficiency Program is 90% full"
 *                     action: "VIEW_BOOKINGS"
 *                     courseId: "c1"
 */
router.get('/action-items', trainerDashboardController.getTrainingActionItems);

/**
 * @swagger
 * /api/trainer/dashboard/courses:
 *   get:
 *     summary: Step 3 - Get Trainer's Course Overview
 *     description: Lists all active courses with their capacity status and booking numbers.
 *     tags: [Trainer Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Courses overview retrieved successfully.
 *         content:
 *           application/json:
 *             example:
 *               status: "success"
 *               results: 3
 *               data:
 *                 courses:
 *                   - id: "c1"
 *                     title: "STCW Basic Safety"
 *                     capacityStatus: "Nearly Full"
 *                     bookingsCount: 17
 *                     totalCapacity: 18
 *                     status: "ACTIVE"
 */
router.get('/courses', trainerDashboardController.getTrainingCoursesOverview);
router.get(
  '/notifications',
  trainerDashboardController.getTrainingNotifications,
);

export default router;
