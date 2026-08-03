import { Router } from 'express';
import * as adminDashboardController from '../controllers/adminDashboardController.js';
import { protectAdmin } from '../middlewares/adminAuthMiddleware.js';

const router = Router();

// All admin dashboard routes are protected
router.use(protectAdmin);

/**
 * @swagger
 * tags:
 *   name: Admin Dashboard
 *   description: Endpoints for the overall platform administration dashboard
 */

/**
 * @swagger
 * /api/admin/dashboard/stats:
 *   get:
 *     summary: Step 2 - Get Main Admin Dashboard Stats
 *     description: Retrieve key metrics for the top cards, including pending approvals, flagged issues, and expiring compliance.
 *     tags: [Admin Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics retrieved successfully.
 *         content:
 *           application/json:
 *             example:
 *               status: "success"
 *               data:
 *                 stats:
 *                   pendingApprovals:
 *                     total: 12
 *                     today: 4
 *                   flaggedIssues: 5
 *                   expiringCompliance:
 *                     count: 8
 *                     timeframe: "30d"
 *                     expiredLookbackDays: 365
 */
router.get('/stats', adminDashboardController.getAdminDashboardStats);

/**
 * @swagger
 * /api/admin/dashboard/activity:
 *   get:
 *     summary: Step 3 - Get Platform Activity Overview
 *     description: Retrieve real-time overview of system events like jobs, courses, and user breakdown.
 *     tags: [Admin Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Platform activity retrieved successfully.
 *         content:
 *           application/json:
 *             example:
 *               status: "success"
 *               data:
 *                 activity:
 *                   jobsPosted: 24
 *                   coursesPosted: 12
 *                   applicationsSubmitted: 156
 *                   bookingsMade: 8
 *                   successRate: "85%"
 *                 userBreakdown:
 *                   providers: 10
 *                   recruiters: 8
 *                   professionals: 142
 */
router.get('/activity', adminDashboardController.getPlatformActivity);
router.get(
  '/activity-report',
  adminDashboardController.getPlatformActivityReport,
);
router.get('/transactions', adminDashboardController.getTransactionHistory);
router.get('/notifications', adminDashboardController.getAdminNotifications);

/**
 * @swagger
 * /api/admin/dashboard/revenue:
 *   get:
 *     summary: Step 4 - Get Revenue and Financial Overview
 *     description: >
 *       Subscription revenue (professionals + recruiters, monthly recurring, sourced
 *       from Stripe) plus the commission-based training-provider figures for the
 *       current month. `overview.source` is `unavailable` when Stripe could not be
 *       reached, in which case subscriber counts are still returned but revenue is 0.
 *     tags: [Admin Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Revenue overview retrieved successfully.
 *         content:
 *           application/json:
 *             example:
 *               status: "success"
 *               data:
 *                 overview:
 *                   totalRevenue: 4250
 *                   totalSubscribers: 1250
 *                   activeSubscriptions: 1250
 *                   currency: "GBP"
 *                   interval: "month"
 *                   source: "stripe"
 *                 subscriptions:
 *                   professionals:
 *                     subscribers: 1200
 *                     revenue: 1250
 *                   recruiters:
 *                     subscribers: 50
 *                     revenue: 3000
 *                 training:
 *                   period: "This Month"
 *                   commissionRevenue: 14250
 *                   growth: "+3.2%"
 *                   grossSales: 8450
 *                   costOfSales: 7350
 *                   pendingPayouts: 1200
 *                   refunds: 0
 */
router.get('/revenue', adminDashboardController.getRevenueOverview);

/**
 * @swagger
 * /api/admin/dashboard/queues:
 *   get:
 *     summary: Step 5 - Get Admin Action Queues
 *     description: Fetches review queues (recruiters, KYC) and system-wide alerts.
 *     tags: [Admin Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Admin queues retrieved successfully.
 *         content:
 *           application/json:
 *             example:
 *               status: "success"
 *               data:
 *                 reviewQueue:
 *                   - id: "r1"
 *                     type: "RECRUITER_VERIFICATION"
 *                     title: "Ocean Hire Agency"
 *                     reason: "Domain Mismatch"
 *                     severity: "yellow"
 *                     timestamp: "2026-02-06T10:00:00Z"
 *                 systemAlerts:
 *                   - type: "SECURITY"
 *                     message: "Multiple accounts flagged"
 *                     severity: "red"
 *                     timestamp: "2026-02-06T15:00:00Z"
 */
router.get('/queues', adminDashboardController.getAdminActionQueues);

export default router;
