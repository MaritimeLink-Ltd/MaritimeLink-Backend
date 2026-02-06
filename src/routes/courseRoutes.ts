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
 *     summary: Create a new maritime course
 *     description: Recruiters and Training Agents can create new course offerings. Admins can also create courses.
 *     tags: [Courses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, location, category, contractType, description, price, currency, courseType]
 *             properties:
 *               title:
 *                 type: string
 *                 example: "STCW Basic Safety Training"
 *               location:
 *                 type: string
 *                 example: "Southampton, UK"
 *               category:
 *                 type: string
 *                 example: "STCW_CERTIFICATES"
 *               contractType:
 *                 type: string
 *                 example: "Full-time"
 *               description:
 *                 type: string
 *                 example: "A comprehensive course covering emergency procedures and sea survival."
 *               price:
 *                 type: number
 *                 example: 500
 *               currency:
 *                 type: string
 *                 example: "GBP"
 *               courseType:
 *                 type: string
 *                 enum: [INTERNAL, EXTERNAL]
 *                 example: "INTERNAL"
 *     responses:
 *       201:
 *         description: Course created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     course: { $ref: '#/components/schemas/Course' }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/', protectAdminOrRecruiter, courseController.createCourse);

/**
 * @swagger
 * /api/courses:
 *   get:
 *     summary: Browse all course offerings
 *     description: Retrieve a paginated list of all active maritime courses available on the platform.
 *     tags: [Courses]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *         description: Number of items per page
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: Filter courses by category
 *     responses:
 *       200:
 *         description: A paginated list of courses
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer }
 *                 total: { type: integer }
 *                 data:
 *                   type: object
 *                   properties:
 *                     courses:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Course' }
 */
router.get('/', courseController.getCourses);

/**
 * @swagger
 * /api/courses/{id}:
 *   get:
 *     summary: Get detailed course information
 *     description: Retrieve full details for a specific course, including its sessions and recruiter information.
 *     tags: [Courses]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Unique UUID of the course
 *     responses:
 *       200:
 *         description: Full course details retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     course: { $ref: '#/components/schemas/Course' }
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/:id', courseController.getCourse);

/**
 * @swagger
 * /api/courses/my:
 *   get:
 *     summary: Get my created courses
 *     description: Recruiters can view all courses they have posted to the platform.
 *     tags: [Courses]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of recruiter-owned courses
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
 *                     courses:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Course' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/my', protectAdminOrRecruiter, courseController.getMyCourses);

/**
 * @swagger
 * /api/courses/{id}:
 *   patch:
 *     summary: Update an existing course
 *     description: Modify details of a course. Only the creator or an admin can perform this action.
 *     tags: [Courses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Course'
 *     responses:
 *       200:
 *         description: Course updated successfully
 *       403:
 *         description: Forbidden - Not the owner
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.patch('/:id', protectAdminOrRecruiter, courseController.updateCourse);

/**
 * @swagger
 * /api/courses/{id}:
 *   delete:
 *     summary: Remove a course offering
 *     description: Delete a course from the platform. Only the creator or an admin can perform this action.
 *     tags: [Courses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: Course deleted successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Forbidden - Not the owner
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.delete('/:id', protectAdminOrRecruiter, courseController.deleteCourse);

export default router;
