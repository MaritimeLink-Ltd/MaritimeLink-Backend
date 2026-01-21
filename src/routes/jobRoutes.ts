import { Router } from 'express';
import * as jobController from '../controllers/jobController.js';
import * as professionalJobController from '../controllers/professionalJobController.js';
import { protectAdminOrRecruiter } from '../middlewares/adminOrRecruiterAuthMiddleware.js';
import { protect } from '../middlewares/authMiddleware.js';

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
 *               category: { type: string, enum: [OFFICER, RATINGS_AND_CREW, CATERING_AND_MEDICAL] }
 *               contractType: { type: string, enum: [TEMPORARY, CONTRACT, PERMANENT] }
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
 *     summary: Get all job posts (with filtering)
 *     tags: [Jobs]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: category
 *         schema: { type: string, enum: [OFFICER, RATINGS_AND_CREW, CATERING_AND_MEDICAL] }
 *       - in: query
 *         name: jobType
 *         schema: { type: string, enum: [TEMPORARY, CONTRACT, PERMANENT] }
 *       - in: query
 *         name: datePosted
 *         schema: { type: string, enum: [24h, 7d, 30d] }
 *     responses:
 *       200:
 *         description: List of jobs
 */
router.get('/', jobController.getJobs);

/**
 * @swagger
 * /api/jobs/my:
 *   get:
 *     summary: Get jobs created by current user
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of user's jobs
 */
router.get('/my', protectAdminOrRecruiter, jobController.getMyJobs);

/**
 * @swagger
 * /api/jobs/saved:
 *   get:
 *     summary: Get all saved jobs for current professional
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of saved jobs
 */
router.get('/saved', protect, professionalJobController.getSavedJobs);

/**
 * @swagger
 * /api/jobs/{id}:
 *   get:
 *     summary: Get job details by ID
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Job details
 */
router.get('/:id', jobController.getJobById);

/**
 * @swagger
 * /api/jobs/{id}:
 *   patch:
 *     summary: Update a job post
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               location: { type: string }
 *               category: { type: string, enum: [OFFICER, RATINGS_AND_CREW, CATERING_AND_MEDICAL] }
 *               contractType: { type: string, enum: [TEMPORARY, CONTRACT, PERMANENT] }
 *               salary: { type: string }
 *               description: { type: string }
 *     responses:
 *       200:
 *         description: Job updated successfully
 */
router.patch('/:id', protectAdminOrRecruiter, jobController.updateJob);

/**
 * @swagger
 * /api/jobs/{id}:
 *   delete:
 *     summary: Delete a job post
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Job deleted successfully
 */
router.delete('/:id', protectAdminOrRecruiter, jobController.deleteJob);

/**
 * @swagger
 * /api/jobs/{id}/save:
 *   post:
 *     summary: Toggle Save/Unsave a job
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Job saved/unsaved status toggled
 */
router.post('/:id/save', protect, professionalJobController.toggleSaveJob);

export default router;
