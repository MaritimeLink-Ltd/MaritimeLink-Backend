import { Router } from 'express';
import * as recruiterDashboardController from '../controllers/recruiterDashboardController.js';
import { protectRecruiter } from '../middlewares/recruiterAuthMiddleware.js';

const router = Router();

// All recruiter dashboard routes are protected
router.use(protectRecruiter);

/**
 * @swagger
 * tags:
 *   name: Recruiter Dashboard
 *   description: Endpoints for the recruiter dashboard metrics and management
 */

/**
 * @swagger
 * /api/recruiter/dashboard/stats:
 *   get:
 *     summary: Get recruiter dashboard statistics
 *     description: Retrieve key metrics like active jobs, new applications, and matched professionals.
 *     tags: [Recruiter Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [today, 7d, 1m]
 *           default: 7d
 *     responses:
 *       200:
 *         description: Recruiter statistics retrieved successfully.
 *         content:
 *           application/json:
 *             example:
 *               status: "success"
 *               data:
 *                 stats:
 *                   activeJobsCount: 7
 *                   newApplicationsCount: 26
 *                   matchedProfessionalsCount: 84
 *                   jobsNeedingAttentionCount: 3
 */
router.get('/stats', recruiterDashboardController.getRecruiterDashboardStats);

/**
 * @swagger
 * /api/recruiter/dashboard/action-items:
 *   get:
 *     summary: Get recruiter action required items
 *     description: Fetches alerts and tasks needing immediate attention.
 *     tags: [Recruiter Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Action items retrieved successfully.
 *         content:
 *           application/json:
 *             example:
 *               status: "success"
 *               results: 4
 *               data:
 *                 actionItems:
 *                   - type: "NEW_APPLICANTS"
 *                     message: "5 new applicants awaiting review for Chief Engineer"
 *                     action: "VIEW_APPLICANTS"
 *                     jobId: "j1"
 *                   - type: "MATCHED_PROFESSIONALS"
 *                     message: "13 matched professionals ready to invite for Deck Officer"
 *                     action: "VIEW_MATCHES"
 *                     category: "OFFICER"
 */
router.get(
  '/action-items',
  recruiterDashboardController.getActionRequiredItems,
);

/**
 * @swagger
 * /api/recruiter/dashboard/jobs:
 *   get:
 *     summary: Get recruiter's job overview
 *     description: Lists all jobs with their status and key metrics.
 *     tags: [Recruiter Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Jobs list retrieved successfully.
 *         content:
 *           application/json:
 *             example:
 *               status: "success"
 *               results: 3
 *               data:
 *                 jobs:
 *                   - id: "j1"
 *                     title: "Chief Engineer"
 *                     status: "ACTIVE"
 *                     applicantCount: 15
 *                     matchedCount: 12
 *                     contractType: "PERMANENT"
 */
router.get('/jobs', recruiterDashboardController.getRecruiterJobs);

/**
 * @swagger
 * /api/recruiter/dashboard/popular-searches:
 *   get:
 *     summary: Get trending job searches
 *     description: Returns a list of the most frequent job search terms.
 *     tags: [Recruiter Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Popular searches retrieved successfully.
 *         content:
 *           application/json:
 *             example:
 *               status: "success"
 *               data:
 *                 popularSearches:
 *                   - term: "Chief Engineer"
 *                     count: 156
 *                   - term: "3rd Officer"
 *                     count: 98
 */
router.get(
  '/popular-searches',
  recruiterDashboardController.getPopularSearches,
);

export default router;
