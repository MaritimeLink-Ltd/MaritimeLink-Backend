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

/**
 * @swagger
 * /api/courses/{id}:
 *   get:
 *     summary: Get a single course by ID
 *     tags: [Courses]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Course details
 *       404:
 *         description: Course not found
 */
router.get('/:id', courseController.getCourse);

/**
 * @swagger
 * /api/courses/my:
 *   get:
 *     summary: Get courses created by current user
 *     tags: [Courses]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of user's courses
 */
router.get('/my', protectAdminOrRecruiter, courseController.getMyCourses);

/**
 * @swagger
 * /api/courses/{id}:
 *   patch:
 *     summary: Update a course post
 *     tags: [Courses]
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
 *               category: { type: string }
 *               contractType: { type: string }
 *               description: { type: string }
 *     responses:
 *       200:
 *         description: Course updated successfully
 */
router.patch('/:id', protectAdminOrRecruiter, courseController.updateCourse);

/**
 * @swagger
 * /api/courses/{id}:
 *   delete:
 *     summary: Delete a course post
 *     tags: [Courses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Course deleted successfully
 */
router.delete('/:id', protectAdminOrRecruiter, courseController.deleteCourse);

export default router;
