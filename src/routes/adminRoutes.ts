import { Router } from 'express';
import * as adminAuthController from '../controllers/adminAuthController.js';
import * as adminRecruiterController from '../controllers/adminRecruiterController.js';
import * as adminProfessionalController from '../controllers/adminProfessionalController.js';
import { protectAdmin } from '../middlewares/adminAuthMiddleware.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin authentication and management
 */

/**
 * @swagger
 * /api/admin/login:
 *   post:
 *     summary: Login for Admin
 *     description: Authenticate an administrator and receive a platform-wide JWT.
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "admin@maritime.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "AdminSecret123!"
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 token: { type: string }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/login', adminAuthController.login);

/**
 * @swagger
 * /api/admin/forgot-password:
 *   post:
 *     summary: Request password reset for Admin
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "admin@maritime.com"
 *     responses:
 *       200:
 *         description: Reset email sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: "Password reset link sent to your email." }
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.post('/forgot-password', adminAuthController.forgotPassword);

/**
 * @swagger
 * /api/admin/reset-password/{token}:
 *   post:
 *     summary: Reset password for Admin
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - password
 *             properties:
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Invalid or expired token
 */
router.post('/reset-password/:token', adminAuthController.resetPassword);

// Recruiter Management Routes
router.use(protectAdmin);

/**
 * @swagger
 * /api/admin/recruiters:
 *   get:
 *     summary: Get all recruiters (with pagination)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of recruiters
 */
router.get('/recruiters', adminRecruiterController.getRecruiters);

/**
 * @swagger
 * /api/admin/recruiters/stats:
 *   get:
 *     summary: Get recruiter statistics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stats data
 */
router.get('/recruiters/stats', adminRecruiterController.getRecruiterStats);

/**
 * @swagger
 * /api/admin/recruiters/{id}:
 *   get:
 *     summary: Get single recruiter details
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Recruiter data
 */
router.get('/recruiters/:id', adminRecruiterController.getRecruiterById);

/**
 * @swagger
 * /api/admin/recruiters/{id}/status:
 *   patch:
 *     summary: Update recruiter status (Approve/Reject)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [APPROVED, REJECTED]
 *     responses:
 *       200:
 *         description: Status updated
 */
router.patch(
  '/recruiters/:id/status',
  adminRecruiterController.updateRecruiterStatus,
);

/**
 * @swagger
 * /api/admin/kyc/pending:
 *   get:
 *     summary: Get all recruiters with pending KYC
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending KYCs
 */
router.get('/kyc/pending', adminRecruiterController.getPendingKYCs);

/**
 * @swagger
 * /api/admin/kyc/{id}/status:
 *   patch:
 *     summary: Update KYC status (Approve/Reject)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Recruiter ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [APPROVED, REJECTED]
 *     responses:
 *       200:
 *         description: KYC status updated
 */
router.patch('/kyc/:id/status', adminRecruiterController.updateKYCStatus);

/**
 * @swagger
 * /api/admin/professional-kyc/pending:
 *   get:
 *     summary: Get all professionals with pending KYC
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending professional KYCs
 */
router.get(
  '/professional-kyc/pending',
  adminProfessionalController.getPendingKYCs,
);

/**
 * @swagger
 * /api/admin/professional-kyc/{id}/status:
 *   patch:
 *     summary: Update Professional KYC status (Approve/Reject)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Professional ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [APPROVED, REJECTED]
 *     responses:
 *       200:
 *         description: Professional KYC status updated
 */
router.patch(
  '/professional-kyc/:id/status',
  adminProfessionalController.updateKYCStatus,
);

// --- Operations Dashboard Routes ---
import * as adminOperationsController from '../controllers/adminOperationsController.js';

/**
 * @swagger
 * /api/admin/operations/activity:
 *   get:
 *     summary: Get system activity logs
 *     description: Retrieve a paginated list of system activities. Filters can be applied for action type, actor, or status.
 *     tags: [Admin Operations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by action name (e.g., "LOGIN", "JOB_POSTED")
 *       - in: query
 *         name: actorType
 *         schema:
 *           type: string
 *           enum: [ADMIN, RECRUITER, PROFESSIONAL, SYSTEM]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [SUCCESS, FAILED, WARNING]
 *     responses:
 *       200:
 *         description: List of activity logs
 */
router.get('/operations/activity', adminOperationsController.getActivityLogs);

/**
 * @swagger
 * /api/admin/operations/stats:
 *   get:
 *     summary: Get dashboard statistics
 *     description: Returns aggregated real-time statistics for the Admin Dashboard widgets (Activities, Active Users, Failed Actions, Security Alerts).
 *     tags: [Admin Operations]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     activitiesToday:
 *                       type: integer
 *                       example: 142
 *                     activeUsers:
 *                       type: integer
 *                       example: 85
 *                     failedActions:
 *                       type: integer
 *                       example: 5
 *                     securityAlerts:
 *                       type: integer
 *                       example: 2
 */
router.get('/operations/stats', adminOperationsController.getSystemStats);

// --- Support Case Routes ---

/**
 * @swagger
 * /api/admin/support/cases:
 *   get:
 *     summary: List support cases
 *     description: Retrieve a paginated list of support cases. Can be filtered by status, priority, or user ID.
 *     tags: [Admin Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [OPEN, IN_PROGRESS, RESOLVED, CLOSED]
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [HIGH, MEDIUM, LOW]
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: ID of the user who opened the case
 *     responses:
 *       200:
 *         description: List of support cases
 */
router.get('/support/cases', adminOperationsController.getSupportCases);

/**
 * @swagger
 * /api/admin/support/cases:
 *   post:
 *     summary: Create a support case (Internal/Admin)
 *     description: Manually create a support case from the admin panel.
 *     tags: [Admin Support]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - subject
 *               - description
 *               - category
 *             properties:
 *               subject:
 *                 type: string
 *               description:
 *                 type: string
 *               category:
 *                 type: string
 *               priority:
 *                 type: string
 *                 enum: [HIGH, MEDIUM, LOW]
 *               userId:
 *                 type: string
 *                 description: ID of the user this case is about (optional)
 *               userType:
 *                 type: string
 *                 enum: [RECRUITER, PROFESSIONAL]
 *     responses:
 *       201:
 *         description: Case created successfully
 */
router.post('/support/cases', adminOperationsController.createSupportCase);

/**
 * @swagger
 * /api/admin/support/cases/{id}:
 *   get:
 *     summary: Get case details
 *     description: Get full details of a specific case, including internal notes and assignee info.
 *     tags: [Admin Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The UUID or human-readable Case ID (SC-XXXX)
 *     responses:
 *       200:
 *         description: Case details found
 *       404:
 *         description: Case not found
 */
router.get('/support/cases/:id', adminOperationsController.getCaseById);

/**
 * @swagger
 * /api/admin/support/cases/{id}:
 *   patch:
 *     summary: Update case status or assignment
 *     description: Assign a case to an admin, change its status, or update priority.
 *     tags: [Admin Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [OPEN, IN_PROGRESS, RESOLVED, CLOSED]
 *               priority:
 *                 type: string
 *                 enum: [HIGH, MEDIUM, LOW]
 *               assignedToId:
 *                 type: string
 *                 description: Admin ID to assign this case to
 *     responses:
 *       200:
 *         description: Case updated
 */
router.patch('/support/cases/:id', adminOperationsController.updateCaseStatus);

/**
 * @swagger
 * /api/admin/support/cases/{id}/notes:
 *   post:
 *     summary: Add a note to a case
 *     description: Add an internal note or public comment to a support case.
 *     tags: [Admin Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *               isInternal:
 *                 type: boolean
 *                 default: true
 *                 description: If true, visible only to admins
 *     responses:
 *       201:
 *         description: Note added
 */
router.post('/support/cases/:id/notes', adminOperationsController.addCaseNote);

// --- JOB MODERATION ROUTES ---
import * as jobController from '../controllers/jobController.js';

/**
 * @swagger
 * /api/admin/jobs:
 *   get:
 *     summary: Get all jobs
 *     tags: [Admin Jobs]
 */
router.get('/jobs', jobController.getJobs); // Assuming admin wants filters too

/**
 * @swagger
 * /api/admin/jobs/flagged:
 *   get:
 *     summary: Get flagged jobs
 *     tags: [Admin Jobs]
 */
router.get('/jobs/flagged', jobController.getFlaggedJobs);

/**
 * @swagger
 * /api/admin/jobs/{id}:
 *   get:
 *     summary: Get job details
 *     tags: [Admin Jobs]
 */
router.get('/jobs/:id', jobController.getJobById);

/**
 * @swagger
 * /api/admin/jobs/{id}/flag:
 *   patch:
 *     summary: Toggle job flag
 *     tags: [Admin Jobs]
 */
router.patch('/jobs/:id/flag', jobController.toggleJobFlag);

/**
 * @swagger
 * /api/admin/jobs/{id}:
 *   delete:
 *     summary: Remove job
 *     tags: [Admin Jobs]
 */
router.delete('/jobs/:id', jobController.deleteJob);

// ==================== ADMIN COURSE MODERATION ====================

/**
 * @swagger
 * /api/admin/courses/flagged:
 *   get:
 *     summary: Get all flagged courses
 *     tags: [Admin Courses]
 */
router.get('/courses/flagged', protectAdmin, async (req, res, next) => {
  const { getFlaggedCourses } =
    await import('../controllers/adminCourseController.js');
  return getFlaggedCourses(req, res, next);
});

/**
 * @swagger
 * /api/admin/bookings:
 *   get:
 *     summary: Get all bookings on platform
 *     tags: [Admin Courses]
 */
router.get('/bookings', protectAdmin, async (req, res, next) => {
  const { getAllBookings } =
    await import('../controllers/adminCourseController.js');
  return getAllBookings(req, res, next);
});

/**
 * @swagger
 * /api/admin/bookings/{bookingId}:
 *   get:
 *     summary: Get specific booking details
 *     tags: [Admin Courses]
 */
router.get('/bookings/:bookingId', protectAdmin, async (req, res, next) => {
  const { getAdminBookingById } =
    await import('../controllers/adminCourseController.js');
  return getAdminBookingById(req, res, next);
});

/**
 * @swagger
 * /api/admin/courses/{courseId}/bookings:
 *   get:
 *     summary: Get all bookings for any course
 *     tags: [Admin Courses]
 */
router.get(
  '/courses/:courseId/bookings',
  protectAdmin,
  async (req, res, next) => {
    const { getAdminCourseBookings } =
      await import('../controllers/adminCourseController.js');
    return getAdminCourseBookings(req, res, next);
  },
);

/**
 * @swagger
 * /api/admin/revenue:
 *   get:
 *     summary: Get platform revenue overview
 *     tags: [Admin Revenue]
 */
router.get('/revenue', protectAdmin, async (req, res, next) => {
  const { getPlatformRevenue } =
    await import('../controllers/adminCourseController.js');
  return getPlatformRevenue(req, res, next);
});

/**
 * @swagger
 * /api/admin/payouts/{providerId}:
 *   post:
 *     summary: Process payout to training provider
 *     tags: [Admin Revenue]
 */
router.post('/payouts/:providerId', protectAdmin, async (req, res, next) => {
  const { processPayout } =
    await import('../controllers/adminCourseController.js');
  return processPayout(req, res, next);
});

export default router;
