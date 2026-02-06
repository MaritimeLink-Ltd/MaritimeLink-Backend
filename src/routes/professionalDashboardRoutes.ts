import { Router } from 'express';
import * as dashboardController from '../controllers/professionalDashboardController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = Router();

// All dashboard routes are protected
router.use(protect);

/**
 * @swagger
 * /api/professional/dashboard/overview:
 *   get:
 *     summary: Get professional dashboard overview
 *     description: Retrieve key metrics for the professional dashboard, including compliance, expiring certs, and job matches.
 *     tags: [Professional Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard overview data retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     overview:
 *                       type: object
 *                       properties:
 *                         complianceStatus: { type: string, example: "Amber" }
 *                         expiringCertificates:
 *                           type: object
 *                           properties:
 *                             count: { type: integer, example: 5 }
 *                             timeframe: { type: string, example: "90 days" }
 *                         resumeCompletionPercentage: { type: integer, example: 75 }
 *                         documentWalletStatus: { type: string, example: "Review Required" }
 *                         jobMatchesCount: { type: integer, example: 12 }
 *                         recommendedCoursesCount: { type: integer, example: 3 }
 *             example:
 *               status: "success"
 *               data:
 *                 overview:
 *                   complianceStatus: "Amber"
 *                   expiringCertificates:
 *                     count: 5
 *                     timeframe: "90 days"
 *                   resumeCompletionPercentage: 75
 *                   documentWalletStatus: "Review Required"
 *                   jobMatchesCount: 12
 *                   recommendedCoursesCount: 3
 */
router.get('/overview', dashboardController.getDashboardOverview);

/**
 * @swagger
 * /api/professional/dashboard/alerts:
 *   get:
 *     summary: Get recent alerts
 *     description: Retrieve the latest notifications and alerts for the professional.
 *     tags: [Professional Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of alerts retrieved successfully.
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
 *                     alerts:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Alert' }
 *             example:
 *               status: "success"
 *               results: 2
 *               data:
 *                 alerts:
 *                   - id: "a1b2c3d4-e5f6-7g8h-9i0j-k1l2m3n4o5p6"
 *                     type: "CERTIFICATE_EXPIRY"
 *                     title: "Document Expiring"
 *                     message: "Your Passport is expiring in 45 days. Please update it."
 *                     isRead: false
 *                     createdAt: "2026-02-06T10:00:00Z"
 *                   - id: "b2c3d4e5-f6g7-8h9i-0j1k-l2m3n4o5p6q7"
 *                     type: "JOB_APPLICATION"
 *                     title: "Application Status Update"
 *                     message: "Your application for 'Chief Engineer' has been moved to 'Shortlisted'."
 *                     isRead: true
 *                     createdAt: "2026-02-05T14:30:00Z"
 */
router.get('/alerts', dashboardController.getAlerts);

/**
 * @swagger
 * /api/professional/dashboard/activity:
 *   get:
 *     summary: Get recent activity
 *     description: Retrieve a log of the professional's recent actions on the platform.
 *     tags: [Professional Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of activity logs retrieved successfully.
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
 *                     activity:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/ActivityLog' }
 *             example:
 *               status: "success"
 *               results: 3
 *               data:
 *                 activity:
 *                   - id: "z1y2x3w4-v5u6-t7s8-r9q0-p1o2n3m4l5k6"
 *                     action: "DOCUMENT_UPLOAD"
 *                     actorType: "PROFESSIONAL"
 *                     status: "SUCCESS"
 *                     createdAt: "2026-02-06T09:15:00Z"
 *                   - id: "y2x3w4v5-u6t7-s8r9-q0p1-o2n3m4l5k6j7"
 *                     action: "JOB_APPLICATION_SUBMITTED"
 *                     actorType: "PROFESSIONAL"
 *                     status: "SUCCESS"
 *                     createdAt: "2026-02-05T16:45:00Z"
 */
router.get('/activity', dashboardController.getRecentActivity);

/**
 * @swagger
 * /api/professional/dashboard/alerts/{id}/read:
 *   patch:
 *     summary: Mark alert as read
 *     description: Update an alert's status to read.
 *     tags: [Professional Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Alert marked as read successfully.
 *         content:
 *           application/json:
 *             example:
 *               status: "success"
 *               message: "Alert marked as read"
 */
router.patch('/alerts/:id/read', dashboardController.markAlertAsRead);

export default router;
