import { Router } from 'express';
import * as jobController from '../controllers/jobController.js';
import { protectAdminOrRecruiter } from '../middlewares/adminOrRecruiterAuthMiddleware.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Jobs
 *   description: Job management APIs
 */

/**
 * @swagger
 * /api/jobs:
 *   post:
 *     summary: Create a new job post
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, location, category, contractType, salary, description]
 *             properties:
 *               title: { type: string }
 *               location: { type: string }
 *               category: { type: string }
 *               contractType: { type: string }
 *               salary: { type: string }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Job created successfully
 */
router.post('/', protectAdminOrRecruiter, jobController.createJob);

/**
 * @swagger
 * /api/jobs:
 *   get:
 *     summary: Get all job posts
 *     tags: [Jobs]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: List of jobs
 */
router.get('/', jobController.getJobs);

export default router;
