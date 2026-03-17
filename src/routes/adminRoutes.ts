import { Router } from 'express';
import * as adminAuthController from '../controllers/adminAuthController.js';
import * as adminRecruiterController from '../controllers/adminRecruiterController.js';
import * as adminProfessionalController from '../controllers/adminProfessionalController.js';
import * as adminCompanyController from '../controllers/adminCompanyController.js';
import * as adminMarketplaceController from '../controllers/adminMarketplaceController.js';
import * as adminTrainerPayoutController from '../controllers/adminTrainerPayoutController.js';
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
 *     summary: Step 1 - Admin Login
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer, example: 1 }
 *                 total: { type: integer, example: 1 }
 *                 data:
 *                   type: object
 *                   properties:
 *                     recruiters:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           email: { type: string, format: email }
 *                           role: { type: string }
 *                           organizationName: { type: string }
 *                           status: { type: string, enum: [PENDING, APPROVED, REJECTED] }
 *                           isVerified: { type: boolean }
 *                           createdAt: { type: string, format: date-time }
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     total: { type: integer, example: 100 }
 *                     pending: { type: integer, example: 10 }
 *                     approved: { type: integer, example: 80 }
 *                     rejected: { type: integer, example: 10 }
 *                     verified: { type: integer, example: 90 }
 */
router.get('/recruiters/stats', adminRecruiterController.getRecruiterStats);

/**
 * @swagger
 * /api/admin/professionals:
 *   get:
 *     summary: Get all professionals
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of professionals
 */
router.get('/professionals', adminProfessionalController.getProfessionals);

/**
 * @swagger
 * /api/admin/professionals/stats:
 *   get:
 *     summary: Get professional stats
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Professional statistics
 */
router.get(
  '/professionals/stats',
  adminProfessionalController.getProfessionalStats,
);

/**
 * @swagger
 * /api/admin/kyc-submissions:
 *   get:
 *     summary: Get all KYC submissions across the platform (Compliance)
 *     tags: [Admin Compliance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *       - in: query
 *         name: userType
 *         schema: { enum: [PROFESSIONAL, RECRUITER, TRAINING_PROVIDER] }
 *       - in: query
 *         name: riskLevel
 *         schema: { enum: [LOW, MEDIUM, HIGH] }
 *     responses:
 *       200:
 *         description: List of KYC submissions
 */
import * as adminKycController from '../controllers/adminKycController.js';
router.get('/kyc-submissions', adminKycController.getAllKYCSubmissions);

/**
 * @swagger
 * /api/admin/kyc-submissions/{id}:
 *   get:
 *     summary: Get detailed KYC information (Timeline, OCR, Notes)
 *     tags: [Admin Compliance]
 */
router.get('/kyc-submissions/:id', adminKycController.getKycDetails);

/**
 * @swagger
 * /api/admin/kyc-submissions/{id}/status:
 *   patch:
 *     summary: Update KYC Verification Status (Approve/Reject)
 *     tags: [Admin Compliance]
 */
router.patch(
  '/kyc-submissions/:id/status',
  adminKycController.updateKycVerification,
);

/**
 * @swagger
 * /api/admin/kyc-submissions/{id}/notes:
 *   post:
 *     summary: Add an internal admin note to a KYC record
 *     tags: [Admin Compliance]
 */
router.post('/kyc-submissions/:id/notes', adminKycController.addKycNote);

/**
 * @swagger
 * /api/admin/kyc/stats:
 *   get:
 *     summary: Get consolidated KYC stats (Pending, High Risk, Verified)
 *     tags: [Admin Compliance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: KYC statistics
 */
router.get('/kyc/stats', adminKycController.getKYCStats);

// --- MARKETPLACE MANAGEMENT ROUTES ---

/**
 * @swagger
 * /api/admin/marketplace/stats:
 *   get:
 *     summary: Get Marketplace dashboard statistics (Jobs & Courses)
 *     tags: [Admin Marketplace]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/marketplace/stats',
  adminMarketplaceController.getMarketplaceStats,
);

/**
 * @swagger
 * /api/admin/marketplace/oversight:
 *   get:
 *     summary: Get marketplace oversight (Counts per company/provider)
 *     tags: [Admin Marketplace]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { enum: [JOBS, COURSES] }
 */
router.get(
  '/marketplace/oversight',
  adminMarketplaceController.getMarketplaceOversight,
);

/**
 * @swagger
 * /api/admin/marketplace/listings:
 *   get:
 *     summary: Get official MaritimeLink Listings (Internal)
 *     tags: [Admin Marketplace]
 */
router.get(
  '/marketplace/listings',
  adminMarketplaceController.getMaritimeLinkListings,
);

// --- TRAINER PAYOUT & STRIPE CONNECT ROUTES ---

/**
 * @swagger
 * /api/admin/trainers/{id}/initiate-stripe:
 *   post:
 *     summary: Initiate Stripe Connect onboarding for a trainer
 *     tags: [Admin Payouts]
 */
router.post(
  '/trainers/:id/initiate-stripe',
  adminTrainerPayoutController.initiateTrainerStripe,
);

/**
 * @swagger
 * /api/admin/trainers/payout-stats:
 *   get:
 *     summary: Get consolidated trainer payout statistics
 *     tags: [Admin Payouts]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/trainers/payout-stats',
  adminTrainerPayoutController.getTrainerPayoutStats,
);

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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     recruiter: { $ref: '#/components/schemas/Recruiter' }
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: "Recruiter login status updated to APPROVED" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     recruiter: { $ref: '#/components/schemas/Recruiter' }
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer, example: 5 }
 *                 data:
 *                   type: object
 *                   properties:
 *                     kycs:
 *                       type: array
 *                       items:
 *                         allOf:
 *                           - $ref: '#/components/schemas/RecruiterKyc'
 *                           - type: object
 *                             properties:
 *                               recruiter:
 *                                 type: object
 *                                 properties:
 *                                   email: { type: string }
 *                                   organizationName: { type: string }
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: "KYC status updated to APPROVED" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     kyc: { $ref: '#/components/schemas/RecruiterKyc' }
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer, example: 5 }
 *                 data:
 *                   type: object
 *                   properties:
 *                     kycs:
 *                       type: array
 *                       items:
 *                         allOf:
 *                           - $ref: '#/components/schemas/ProfessionalKyc'
 *                           - type: object
 *                             properties:
 *                               professional:
 *                                 type: object
 *                                 properties:
 *                                   email: { type: string }
 *                                   fullname: { type: string }
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: "KYC status updated to APPROVED" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     kyc: { $ref: '#/components/schemas/ProfessionalKyc' }
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
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [OPEN, IN_PROGRESS, RESOLVED, CLOSED] }
 *       - in: query
 *         name: priority
 *         schema: { type: string, enum: [HIGH, MEDIUM, LOW] }
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of support cases.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer, example: 10 }
 *                 data:
 *                   type: object
 *                   properties:
 *                     cases:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/SupportCase' }
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
 *             required: [subject, description, category]
 *             properties:
 *               subject: { type: string, example: "Suspicious Activity" }
 *               description: { type: string, example: "Flagging recruiter for possible scam..." }
 *               category: { type: string, example: "SECURITY" }
 *               priority: { type: string, enum: [HIGH, MEDIUM, LOW], default: MEDIUM }
 *               userId: { type: string, format: uuid }
 *               userType: { type: string, enum: [RECRUITER, PROFESSIONAL] }
 *     responses:
 *       201:
 *         description: Case created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     case: { $ref: '#/components/schemas/SupportCase' }
 */
router.post('/support/cases', adminOperationsController.createSupportCase);

/**
 * @swagger
 * /api/admin/support/cases/{id}:
 *   get:
 *     summary: Get case details
 *     description: Get full details of a specific case, including internal notes and conversation history.
 *     tags: [Admin Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Case details found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     case: { $ref: '#/components/schemas/SupportCase' }
 *                     notes:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/SupportNote' }
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
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
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [OPEN, IN_PROGRESS, RESOLVED, CLOSED] }
 *               priority: { type: string, enum: [HIGH, MEDIUM, LOW] }
 *               assignedToId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Case updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     case: { $ref: '#/components/schemas/SupportCase' }
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
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string, example: "Found evidence of TOS violation." }
 *               isInternal: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Note added successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     note: { $ref: '#/components/schemas/SupportNote' }
 */
router.post('/support/cases/:id/notes', adminOperationsController.addCaseNote);

// --- JOB MODERATION ROUTES ---
import * as jobController from '../controllers/jobController.js';

/**
 * @swagger
 * /api/admin/jobs:
 *   get:
 *     summary: Get all jobs
 *     description: Retrieve a paginated list of all job postings on the platform.
 *     tags: [Admin Jobs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of jobs.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer, example: 20 }
 *                 data:
 *                   type: object
 *                   properties:
 *                     jobs:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Job' }
 */
router.get('/jobs', jobController.getJobs); // Assuming admin wants filters too

/**
 * @swagger
 * /api/admin/jobs/flagged:
 *   get:
 *     summary: Get flagged jobs
 *     description: Retrieve all jobs that have been flagged for review.
 *     tags: [Admin Jobs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of flagged jobs.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     jobs:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Job' }
 */
router.get('/jobs/flagged', jobController.getFlaggedJobs);

/**
 * @swagger
 * /api/admin/jobs/{id}:
 *   get:
 *     summary: Get job details
 *     description: Retrieve full details of a specific job posting.
 *     tags: [Admin Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Job details found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     job: { $ref: '#/components/schemas/Job' }
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/jobs/:id', jobController.getJobById);

/**
 * @swagger
 * /api/admin/jobs/{id}/flag:
 *   patch:
 *     summary: Toggle job flag
 *     description: Mark a job as flagged or remove the flag.
 *     tags: [Admin Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Job flag status toggled.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     job: { $ref: '#/components/schemas/Job' }
 */
router.patch('/jobs/:id/flag', jobController.toggleJobFlag);

/**
 * @swagger
 * /api/admin/jobs/{id}:
 *   delete:
 *     summary: Remove job
 *     description: Permanently delete a job posting from the system.
 *     tags: [Admin Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Job deleted successfully.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.delete('/jobs/:id', jobController.deleteJob);

// ==================== ADMIN COURSE MODERATION ====================

/**
 * @swagger
 * /api/admin/courses/flagged:
 *   get:
 *     summary: Get all flagged courses
 *     description: Retrieve all training courses that have been flagged for moderation.
 *     tags: [Admin Courses]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of flagged courses.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     courses:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Course' }
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
 *     description: Retrieve a global list of all course bookings across all trainers and professionals.
 *     tags: [Admin Courses]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all bookings.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer, example: 100 }
 *                 data:
 *                   type: object
 *                   properties:
 *                     bookings:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/CourseBooking' }
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
 *     description: Retrieve detailed information for a specific course booking.
 *     tags: [Admin Courses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Booking details found.
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
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/bookings/:bookingId', protectAdmin, async (req, res, next) => {
  const { getAdminBookingById } =
    await import('../controllers/adminCourseController.js');
  return getAdminBookingById(req, res, next);
});

// --- COMPANY MANAGEMENT ROUTES ---

/**
 * @swagger
 * /api/admin/companies:
 *   get:
 *     summary: Get all companies (overview)
 *     tags: [Admin Companies]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [RECRUITMENT_AGENT, TRAINING_AGENT] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [CLAIMED, UNCLAIMED] }
 *     responses:
 *       200:
 *         description: List of companies and stats.
 */
router.get('/companies', adminCompanyController.getCompaniesOverview);

/**
 * @swagger
 * /api/admin/companies/merge-requests:
 *   get:
 *     summary: Get all pending company merge requests
 *     tags: [Admin Companies]
 *     responses:
 *       200:
 *         description: List of merge requests.
 */
router.get(
  '/companies/merge-requests',
  adminCompanyController.getMergeRequests,
);

/**
 * @swagger
 * /api/admin/companies/{id}:
 *   get:
 *     summary: Get company details with team and activity
 *     tags: [Admin Companies]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *     responses:
 *       200:
 *         description: Company details.
 */
router.get('/companies/:id', adminCompanyController.getCompanyById);

/**
 * @swagger
 * /api/admin/companies/{id}:
 *   patch:
 *     summary: Update company (Verify/Claim/Tier)
 *     tags: [Admin Companies]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *     responses:
 *       200:
 *         description: Company updated.
 */
router.patch('/companies/:id', adminCompanyController.updateCompany);

/**
 * @swagger
 * /api/admin/companies/{id}/members/{memberId}:
 *   delete:
 *     summary: Remove a team member from a company
 *     tags: [Admin Companies]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *       - in: path
 *         name: memberId
 *         required: true
 *     responses:
 *       204:
 *         description: Member removed.
 */
router.delete(
  '/companies/:id/members/:memberId',
  adminCompanyController.removeTeamMember,
);

/**
 * @swagger
 * /api/admin/courses/{courseId}/bookings:
 *   get:
 *     summary: Get all bookings for any course
 *     description: Retrieve all bookings associated with a specific course ID.
 *     tags: [Admin Courses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of bookings for the course.
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
 *     description: Retrieve aggregated financial analytics including total revenue, platform fees, and payouts.
 *     tags: [Admin Revenue]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Revenue statistics retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalGross: { type: number, example: 50000.00 }
 *                     platformFees: { type: number, example: 5000.00 }
 *                     trainerPayouts: { type: number, example: 45000.00 }
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
 *     description: Manually trigger or record a payout to a trainer's connected Stripe account.
 *     tags: [Admin Revenue]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: providerId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Payout processed successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: "Payout initiated" }
 */
router.post('/payouts/:providerId', protectAdmin, async (req, res, next) => {
  const { processPayout } =
    await import('../controllers/adminCourseController.js');
  return processPayout(req, res, next);
});

export default router;
