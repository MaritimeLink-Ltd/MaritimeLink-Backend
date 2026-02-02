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
 *       401:
 *         description: Unauthorized
 */
router.post('/', resumeController.upsertResume);

/**
 * @swagger
 * /api/professional/resume:
 *   get:
 *     summary: Get current professional's resume
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Resume data
 *       404:
 *         description: Resume not found
 */
router.get('/', resumeController.getResume);

/**
 * @swagger
 * /api/professional/resume:
 *   put:
 *     summary: Update professional resume
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
 *       401:
 *         description: Unauthorized
 */
router.put('/', resumeController.upsertResume);

/**
 * @swagger
 * /api/professional/resume:
 *   delete:
 *     summary: Delete professional resume
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       204:
 *         description: Resume deleted successfully
 *       404:
 *         description: Resume not found
 *       401:
 *         description: Unauthorized
 */
router.delete('/', resumeController.deleteResume);

export default router;
