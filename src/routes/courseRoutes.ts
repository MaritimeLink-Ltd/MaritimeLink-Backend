import { Router } from 'express';
import * as courseController from '../controllers/courseController.js';
import * as sessionController from '../controllers/courseSessionController.js';
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
 * /api/courses/drafts:
 *   post:
 *     summary: Save a course as draft
 *     description: Create a course owned by the current admin or training agent without publishing it to professionals.
 *     tags: [Courses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, category, description, price]
 *             properties:
 *               title: { type: string, example: "STCW Basic Safety Training" }
 *               location: { type: string, example: "Southampton, UK" }
 *               category: { type: string, example: "STCW_CERTIFICATES" }
 *               contractType: { type: string, example: "Full-time" }
 *               description: { type: string, example: "A comprehensive course covering emergency procedures and sea survival." }
 *               price: { type: number, example: 500 }
 *               courseType: { type: string, enum: [INTERNAL, EXTERNAL], example: "INTERNAL" }
 *     responses:
 *       201:
 *         description: Course draft saved successfully
 */
router.post(
  '/drafts',
  protectAdminOrRecruiter,
  courseController.createCourseDraft,
);

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
 * /api/courses/{id}/publish:
 *   patch:
 *     summary: Publish a draft course
 *     description: Change an owned draft course from DRAFT to ACTIVE so professionals can discover and book it.
 *     tags: [Courses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Course published successfully
 *       400:
 *         description: Course is not a draft or is incomplete
 */
router.patch(
  '/:id/publish',
  protectAdminOrRecruiter,
  courseController.publishCourse,
);

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

/**
 * @swagger
 * /api/courses/{courseId}/sessions:
 *   post:
 *     summary: Create a new session for a course
 *     tags: [Course Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [startDate, endDate, startTime, endTime, location, instructor, totalSeats]
 *             properties:
 *               startDate: { type: string, format: date-time }
 *               endDate: { type: string, format: date-time }
 *               startTime: { type: string, example: "09:00" }
 *               endTime: { type: string, example: "17:00" }
 *               location: { type: string }
 *               instructor: { type: string }
 *               totalSeats: { type: integer }
 *     responses:
 *       201:
 *         description: Session created successfully.
 */
router.post(
  '/:courseId/sessions',
  protectAdminOrRecruiter,
  sessionController.createSession,
);

/**
 * @swagger
 * /api/courses/{courseId}/sessions:
 *   get:
 *     summary: Get all sessions for a specific course
 *     tags: [Course Sessions]
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of sessions for the course.
 */
router.get('/:courseId/sessions', sessionController.getCourseSessions);

/**
 * @swagger
 * /api/courses/sessions/{id}:
 *   get:
 *     summary: Get a single session by ID
 *     tags: [Course Sessions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session details.
 */
router.get('/sessions/:id', sessionController.getSession);

/**
 * @swagger
 * /api/courses/sessions/{id}:
 *   patch:
 *     summary: Update a session
 *     description: Modify session details such as dates, location, or available seats.
 *     tags: [Course Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               startDate: { type: string, format: date-time }
 *               endDate: { type: string, format: date-time }
 *               startTime: { type: string, example: "09:00" }
 *               endTime: { type: string, example: "17:00" }
 *               location: { type: string }
 *               instructor: { type: string }
 *               totalSeats: { type: integer }
 *     responses:
 *       200:
 *         description: Session updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     session: { $ref: '#/components/schemas/CourseSession' }
 */
router.patch(
  '/sessions/:id',
  protectAdminOrRecruiter,
  sessionController.updateSession,
);

/**
 * @swagger
 * /api/courses/sessions/{id}:
 *   delete:
 *     summary: Delete a session
 *     tags: [Course Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Session deleted successfully.
 */
router.delete(
  '/sessions/:id',
  protectAdminOrRecruiter,
  sessionController.deleteSession,
);

// ==================== TRAINER BOOKING MANAGEMENT ====================

/**
 * @swagger
 * /api/courses/{courseId}/bookings:
 *   get:
 *     summary: Get all bookings for a specific course
 *     description: Retrieve all professional bookings for a single training course that you own.
 *     tags: [Trainer Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of course bookings.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     bookings:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/CourseBooking' }
 */
router.get(
  '/:courseId/bookings',
  protectAdminOrRecruiter,
  async (req, res, next) => {
    const { getCourseBookings } =
      await import('../controllers/trainerBookingController.js');
    return getCourseBookings(req, res, next);
  },
);

/**
 * @swagger
 * /api/courses/trainer/bookings:
 *   get:
 *     summary: Get all bookings across all trainer courses
 *     description: Retrieve all bookings for all courses managed by the currently logged-in trainer.
 *     tags: [Trainer Bookings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of trainer bookings.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer, example: 50 }
 *                 data:
 *                   type: object
 *                   properties:
 *                     bookings:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/CourseBooking' }
 */
router.get(
  '/trainer/bookings',
  protectAdminOrRecruiter,
  async (req, res, next) => {
    const { getAllTrainerBookings } =
      await import('../controllers/trainerBookingController.js');
    return getAllTrainerBookings(req, res, next);
  },
);

/**
 * @swagger
 * /api/courses/trainer/bookings/{bookingId}:
 *   get:
 *     summary: Get specific booking details
 *     description: Retrieve detailed information for a specific course booking.
 *     tags: [Trainer Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Booking details retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     booking: { $ref: '#/components/schemas/CourseBooking' }
 */
router.get(
  '/trainer/bookings/:bookingId',
  protectAdminOrRecruiter,
  async (req, res, next) => {
    const { getTrainerBookingById } =
      await import('../controllers/trainerBookingController.js');
    return getTrainerBookingById(req, res, next);
  },
);

/**
 * @swagger
 * /api/courses/trainer/bookings/{bookingId}/status:
 *   patch:
 *     summary: Update booking status
 *     description: Confirm or cancel a student's course booking.
 *     tags: [Trainer Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [CONFIRMED, CANCELLED] }
 *     responses:
 *       200:
 *         description: Booking status updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     booking: { $ref: '#/components/schemas/CourseBooking' }
 */
router.patch(
  '/trainer/bookings/:bookingId/status',
  protectAdminOrRecruiter,
  async (req, res, next) => {
    const { updateBookingStatus } =
      await import('../controllers/trainerBookingController.js');
    return updateBookingStatus(req, res, next);
  },
);

/**
 * @swagger
 * /api/courses/trainer/bookings/{bookingId}/message:
 *   post:
 *     summary: Send message to trainee
 *     description: Send an automated or manual message notification to a professional who booked a course.
 *     tags: [Trainer Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, example: "Please bring your original ID for the class tomorrow." }
 *     responses:
 *       200:
 *         description: Message sent successfully.
 */
router.post(
  '/trainer/bookings/:bookingId/message',
  protectAdminOrRecruiter,
  async (req, res, next) => {
    const { messageTrainee } =
      await import('../controllers/trainerBookingController.js');
    return messageTrainee(req, res, next);
  },
);

/**
 * @swagger
 * /api/courses/trainer/bookings/{bookingId}/certificate:
 *   post:
 *     summary: Issue course completion certificate
 *     description: Mark a booking as COMPLETED and issue a certificate link or record.
 *     tags: [Trainer Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Certificate issued successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: "Certificate issued" }
 */
router.post(
  '/trainer/bookings/:bookingId/certificate',
  protectAdminOrRecruiter,
  async (req, res, next) => {
    const { issueCertificate } =
      await import('../controllers/trainerBookingController.js');
    return issueCertificate(req, res, next);
  },
);

// ==================== TRAINER REVENUE & ANALYTICS ====================

/**
 * @swagger
 * /api/courses/trainer/revenue:
 *   get:
 *     summary: Get trainer revenue breakdown
 *     description: Retrieve a detailed breakdown of total revenue, platform fees, and pending payouts across all your courses.
 *     tags: [Trainer Revenue]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Revenue summary and course-wise breakdown
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalRevenue: { type: number, example: 5000 }
 *                         platformFee: { type: number, example: 600 }
 *                         trainerPayout: { type: number, example: 4400 }
 *                         totalBookings: { type: integer, example: 10 }
 *                         pendingPayouts: { type: number, example: 0 }
 *                     byCourse:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           courseId: { type: string, format: uuid }
 *                           courseTitle: { type: string, example: "STCW Basic Safety" }
 *                           bookings: { type: integer, example: 5 }
 *                           revenue: { type: number, example: 2500 }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get(
  '/trainer/revenue',
  protectAdminOrRecruiter,
  async (req, res, next) => {
    const { getRevenue } =
      await import('../controllers/trainerRevenueController.js');
    return getRevenue(req, res, next);
  },
);

/**
 * @swagger
 * /api/courses/trainer/analytics:
 *   get:
 *     summary: Get course performance analytics
 *     description: Detailed performance metrics including enrollment counts, capacity utilization, and engagement stats for all posted courses.
 *     tags: [Trainer Revenue]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Aggregated and course-specific analytics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     overall:
 *                       type: object
 *                       properties:
 *                         totalCourses: { type: integer, example: 5 }
 *                         activeCourses: { type: integer, example: 3 }
 *                         totalBookings: { type: integer, example: 25 }
 *                         totalRevenue: { type: number, example: 12500 }
 *                         averageCapacityUtilization: { type: integer, example: 85 }
 *                     courses:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           courseId: { type: string, format: uuid }
 *                           title: { type: string, example: "Survival at Sea" }
 *                           status: { type: string, example: "ACTIVE" }
 *                           totalBookings: { type: integer, example: 12 }
 *                           confirmedBookings: { type: integer, example: 10 }
 *                           revenue: { type: number, example: 6000 }
 *                           capacityUtilization: { type: integer, example: 75 }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get(
  '/trainer/analytics',
  protectAdminOrRecruiter,
  async (req, res, next) => {
    const { getAnalytics } =
      await import('../controllers/trainerRevenueController.js');
    return getAnalytics(req, res, next);
  },
);

export default router;
