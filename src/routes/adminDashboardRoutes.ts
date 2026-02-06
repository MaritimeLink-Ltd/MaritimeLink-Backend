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
 *     summary: Get main admin dashboard stats
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
 *                     timeframe: "48h"
 */
router.get('/stats', adminDashboardController.getAdminDashboardStats);

/**
 * @swagger
 * /api/admin/dashboard/activity:
 *   get:
 *     summary: Get platform activity overview
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

/**
 * @swagger
 * /api/admin/dashboard/revenue:
 *   get:
 *     summary: Get revenue and financial overview
 *     description: Retrieve all financial metrics including total revenue, growth, and user type breakdown.
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
 *                   activeSubscriptions: 1250
 *                   totalRevenue: 425000
 *                   growth: "+12.5%"
 *                 breakdown:
 *                   professionals:
 *                     amount: 125000
 *                     active: 1000
 *                     growth: "+8%"
 *                   recruiters:
 *                     amount: 300000
 *                     active: 50
 *                     growth: "+15%"
 *                 training:
 *                   totalThisMonth: 14250
 *                   growth: "+3.2%"
 *                   sources:
 *                     courseSales: 8450
 *                     pendingPayouts: 1200
 *                     refunds: 0
 */
router.get('/revenue', adminDashboardController.getRevenueOverview);

/**
 * @swagger
 * /api/admin/dashboard/queues:
 *   get:
 *     summary: Get admin action queues
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
