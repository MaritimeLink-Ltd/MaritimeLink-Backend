import { Router } from 'express';
import * as resumeController from '../controllers/professionalResumeController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = Router();

// All resume routes are protected
router.use(protect);

/**
 * @swagger
 * tags:
 *   name: Resume
 *   description: Professional resume management
 */

/**
 * @swagger
 * /api/professional/resume:
 *   post:
 *     summary: Create or update professional resume
 *     description: Submit full resume details including skills, education, and experience.
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Resume'
 *     responses:
 *       200:
 *         description: Resume updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     resume: { $ref: '#/components/schemas/Resume' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/', resumeController.upsertResume);

/**
 * @swagger
 * /api/professional/resume:
 *   get:
 *     summary: Get current professional's resume
 *     description: Retrieve the full resume details for the logged-in professional.
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Resume data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     resume: { $ref: '#/components/schemas/Resume' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/', resumeController.getResume);

/**
 * @swagger
 * /api/professional/resume:
 *   put:
 *     summary: Update professional resume
 *     description: Update existing resume data.
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Resume'
 *     responses:
 *       200:
 *         description: Resume updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     resume: { $ref: '#/components/schemas/Resume' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.put('/', resumeController.upsertResume);

/**
 * @swagger
 * /api/professional/resume:
 *   delete:
 *     summary: Delete professional resume
 *     description: Remove the professional's resume from the system.
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       204:
 *         description: Resume deleted successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.delete('/', resumeController.deleteResume);

export default router;
