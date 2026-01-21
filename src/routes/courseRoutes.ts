import { Router } from 'express';
import * as courseController from '../controllers/courseController.js';
import { protectAdminOrRecruiter } from '../middlewares/adminOrRecruiterAuthMiddleware.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Courses
 *   description: Course management APIs
 */

/**
 * @swagger
 * /api/courses:
 *   post:
 *     summary: Create a new course post
 *     tags: [Courses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, location, category, contractType, description]
 *             properties:
 *               title: { type: string }
 *               location: { type: string }
 *               category: { type: string }
 *               contractType: { type: string }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Course created successfully
 */
router.post('/', protectAdminOrRecruiter, courseController.createCourse);

/**
 * @swagger
 * /api/courses:
 *   get:
 *     summary: Get all course posts
 *     tags: [Courses]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: List of courses
 */
router.get('/', courseController.getCourses);

export default router;
