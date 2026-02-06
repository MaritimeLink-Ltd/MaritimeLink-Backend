import express from 'express';
import multer from 'multer';
import * as recruiterController from '../controllers/recruiterAuthController.js';
import * as kycController from '../controllers/kycController.js';
import * as sessionController from '../controllers/courseSessionController.js';
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
import { protectRecruiter } from '../middlewares/recruiterAuthMiddleware.js';

/**
 * @swagger
 * /api/recruiter/register:
 *   post:
 *     summary: Step 1 - Register Recruiter
 *     description: Initialize registration for a Recruitment Agent or Training Agent. This sends a 6-digit OTP to the provided email.
 *     tags: [Recruiter]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, role]
 *             properties:
 *               email: { type: string, format: email, example: "hr@maritime.com" }
 *               password: { type: string, format: password, example: "Secret123!" }
 *               role:
 *                 type: string
 *                 enum: [RECRUITMENT_AGENT, TRAINING_AGENT]
 *                 example: "TRAINING_AGENT"
 *     responses:
 *       201:
 *         description: Initial account created. Verification required.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: "success" }
 *                 message: { type: string, example: "Registration successful. OTP sent." }
 *                 data:
 *                   type: object
 *                   properties:
 *                     recruiterId: { type: string, format: uuid }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post('/register', recruiterController.register);

/**
 * @swagger
 * /api/recruiter/verify-otp:
 *   post:
 *     summary: Step 2 - Verify Email with OTP
 *     description: Validate the 6-digit code sent to the recruiter's email. Successful verification allows proceeding to ID upload.
 *     tags: [Recruiter]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recruiterId, code]
 *             properties:
 *               recruiterId: { type: string, format: uuid }
 *               code: { type: string, example: "123456" }
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Invalid or expired OTP
 */
router.post('/verify-otp', recruiterController.verifyOTP);

/**
 * @swagger
 * /api/recruiter/upload-id:
 *   post:
 *     summary: Step 3 - Upload Identity Documents
 *     description: Upload a scanned copy of an ID or Passport. File is securely stored in a private recruiter bucket.
 *     tags: [Recruiter]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [id_passport]
 *             properties:
 *               id_passport:
 *                 type: string
 *                 format: binary
 *                 description: "Image or PDF of the ID document"
 *     responses:
 *       200:
 *         description: ID uploaded. Returns the temporary URL.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     url: { type: string, format: url }
 */
router.post(
  '/upload-id',
  upload.single('id_passport'),
  recruiterController.uploadID,
);

/**
 * @swagger
 * /api/recruiter/complete-profile:
 *   post:
 *     summary: Step 4 - Submit Organizational Profile
 *     description: Provide full company details and link the uploaded ID. This moves the recruiter to PENDING status for admin review.
 *     tags: [Recruiter]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recruiterId, organizationName, address, website, orgEmail, idPassportUrl]
 *             properties:
 *               recruiterId: { type: string, format: uuid }
 *               organizationName: { type: string, example: "Global Shipping Ltd" }
 *               address: { type: string, example: "123 Port Side, London" }
 *               website: { type: string, format: url, example: "https://globalship.com" }
 *               orgEmail: { type: string, format: email, example: "contact@globalship.com" }
 *               idPassportUrl: { type: string, format: url }
 *     responses:
 *       200:
 *         description: Profile submitted. Awaiting admin approval.
 *       401:
 *         description: Verification incomplete
 */
router.post('/complete-profile', recruiterController.completeProfile);

/**
 * @swagger
 * /api/recruiter/login:
 *   post:
 *     summary: Recruiter Login
 *     description: Authenticate and receive a JWT. Only verified and APPROVED recruiters can login.
 *     tags: [Recruiter]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: "hr@maritime.com" }
 *               password: { type: string, format: password }
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
 *                 data:
 *                   type: object
 *                   properties:
 *                     recruiter: { $ref: '#/components/schemas/Recruiter' }
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Account PENDING or REJECTED
 */
router.post('/login', recruiterController.login);

/**
 * @swagger
 * /api/recruiter/resend-otp:
 *   post:
 *     summary: Resend OTP code for recruiter
 *     tags: [Recruiter]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, example: "hr@maritime.com" }
 *     responses:
 *       200:
 *         description: OTP resent successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: "OTP resent to your email." }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.post('/resend-otp', recruiterController.resendOTP);

/**
 * @swagger
 * /api/recruiter/forgot-password:
 *   post:
 *     summary: Request a password reset link for recruiter
 *     tags: [Recruiter]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, example: "hr@maritime.com" }
 *     responses:
 *       200:
 *         description: Reset link sent to email.
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
router.post('/forgot-password', recruiterController.forgotPassword);

/**
 * @swagger
 * /api/recruiter/reset-password/{token}:
 *   patch:
 *     summary: Reset recruiter password using token
 *     tags: [Recruiter]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: The reset token received via email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string, minLength: 6, example: "NewPassword123!" }
 *     responses:
 *       200:
 *         description: Password reset successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: "Your password has been reset successfully." }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.patch('/reset-password/:token', recruiterController.resetPassword);

/**
 * @swagger
 * /api/recruiter/update-password:
 *   patch:
 *     summary: Update password (authenticated)
 *     tags: [Recruiter]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [oldPassword, newPassword]
 *             properties:
 *               oldPassword: { type: string, example: "OldPassword123!" }
 *               newPassword: { type: string, minLength: 6, example: "NewPassword123!" }
 *     responses:
 *       200:
 *         description: Password updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: "Password updated successfully." }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.patch(
  '/update-password',
  protectRecruiter,
  recruiterController.updatePassword,
);

/**
 * @swagger
 * /api/recruiter/kyc/upload-document:
 *   post:
 *     summary: KYC Step 1 - Upload Identity Document
 *     tags: [Recruiter KYC]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [document]
 *             properties:
 *               document: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Document uploaded successfully.
 */
router.post(
  '/kyc/upload-document',
  upload.single('document'),
  kycController.uploadKYCDocument,
);

/**
 * @swagger
 * /api/recruiter/kyc/upload-selfie:
 *   post:
 *     summary: KYC Step 3 - Upload Selfie
 *     tags: [Recruiter KYC]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [recruiterId, selfie]
 *             properties:
 *               recruiterId: { type: string }
 *               selfie: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Selfie uploaded and linked successfully.
 */
router.post(
  '/kyc/upload-selfie',
  upload.single('selfie'),
  kycController.uploadKYCSelfie,
);

/**
 * @swagger
 * /api/recruiter/kyc/submit:
 *   post:
 *     summary: KYC Step 2 - Submit Personal Details & Document URL
 *     tags: [Recruiter KYC]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recruiterId, firstName, lastName, dateOfBirth, documentType, documentNumber, expiryDate, issueCountry, documentUrl]
 *             properties:
 *               recruiterId: { type: string }
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               dateOfBirth: { type: string, format: date }
 *               documentType: { type: string, enum: [PASSPORT, DRIVING_LICENSE, NATIONAL_ID, RESIDENCE_PERMIT] }
 *               documentNumber: { type: string }
 *               expiryDate: { type: string, format: date }
 *               issueCountry: { type: string }
 *               documentUrl: { type: string }
 *     responses:
 *       200:
 *         description: KYC details submitted. Please upload a selfie next.
 */
router.post('/kyc/submit', kycController.submitKYC);

/**
 * @swagger
 * /api/recruiter/courses/{courseId}/sessions:
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
router.post('/courses/:courseId/sessions', sessionController.createSession);

/**
 * @swagger
 * /api/recruiter/courses/{courseId}/sessions:
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
router.get('/courses/:courseId/sessions', sessionController.getCourseSessions);

/**
 * @swagger
 * /api/recruiter/sessions/{id}:
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
 * /api/recruiter/sessions/{id}:
 *   patch:
 *     summary: Update a session
 *     tags: [Course Sessions]
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
 */
router.patch('/sessions/:id', sessionController.updateSession);

/**
 * @swagger
 * /api/recruiter/sessions/{id}:
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
router.delete('/sessions/:id', sessionController.deleteSession);

// --- User Support Routes ---
import * as userSupportController from '../controllers/userSupportController.js';

/**
 * @swagger
 * /api/recruiter/support/cases:
 *   post:
 *     summary: Create a new support case
 *     tags: [Recruiter Support]
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
 *               subject:
 *                 type: string
 *                 example: "Account Verification Issue"
 *               description:
 *                 type: string
 *                 example: "I uploaded my ID but..."
 *               category:
 *                 type: string
 *                 example: "Account"
 *               priority:
 *                 type: string
 *                 enum: [HIGH, MEDIUM, LOW]
 *     responses:
 *       201:
 *         description: Support case created successfully.
 */
router.post(
  '/support/cases',
  protectRecruiter,
  userSupportController.createCase,
);

/**
 * @swagger
 * /api/recruiter/support/cases:
 *   get:
 *     summary: Get my support cases
 *     tags: [Recruiter Support]
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
 *         description: List of support cases.
 */
router.get(
  '/support/cases',
  protectRecruiter,
  userSupportController.getMyCases,
);

/**
 * @swagger
 * /api/recruiter/support/cases/{id}:
 *   get:
 *     summary: Get case details and chat history
 *     tags: [Recruiter Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Case UUID or ID (e.g. SC-1234)
 *     responses:
 *       200:
 *         description: Detailed case information with notes.
 */
router.get(
  '/support/cases/:id',
  protectRecruiter,
  userSupportController.getCaseDetails,
);

/**
 * @swagger
 * /api/recruiter/support/cases/{id}/reply:
 *   post:
 *     summary: Reply to a support case
 *     tags: [Recruiter Support]
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
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 example: "Here is the additional info..."
 *     responses:
 *       201:
 *         description: Reply added successfully.
 */
router.post(
  '/support/cases/:id/reply',
  protectRecruiter,
  userSupportController.addReply,
);

// --- JOB FLOW ROUTES ---
import * as jobController from '../controllers/jobController.js';
import * as applicationController from '../controllers/applicationController.js';

/**
 * @swagger
 * /api/recruiter/jobs:
 *   post:
 *     summary: Create a job post
 *     description: Posted jobs are visible to maritime professionals.
 *     tags: [Recruiter Jobs]
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
 *               title: { type: string, example: "Second Officer" }
 *               location: { type: string, example: "Rotterdam, Netherlands" }
 *               category: { type: string, enum: [OFFICER, RATINGS_AND_CREW, CATERING_AND_MEDICAL], example: "OFFICER" }
 *               contractType: { type: string, enum: [TEMPORARY, CONTRACT, PERMANENT], example: "CONTRACT" }
 *               salary: { type: string, example: "$5000 / month" }
 *               description: { type: string, example: "Experience in tankers required..." }
 *     responses:
 *       201:
 *         description: Job created successfully
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
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/jobs', protectRecruiter, jobController.createJob);

/**
 * @swagger
 * /api/recruiter/jobs/my:
 *   get:
 *     summary: Get my job posts
 *     description: Retrieve all jobs posted by the logged-in recruiter.
 *     tags: [Recruiter Jobs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of jobs posted by recruiter
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
 *                     jobs:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Job' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/jobs/my', protectRecruiter, jobController.getMyJobs);

/**
 * @swagger
 * /api/recruiter/jobs/{id}:
 *   get:
 *     summary: View my job details
 *     tags: [Recruiter Jobs]
 */
router.get('/jobs/:id', protectRecruiter, jobController.getJobById);

/**
 * @swagger
 * /api/recruiter/jobs/{id}:
 *   patch:
 *     summary: Edit job post
 *     tags: [Recruiter Jobs]
 */
router.patch('/jobs/:id', protectRecruiter, jobController.updateJob);

/**
 * @swagger
 * /api/recruiter/jobs/{id}:
 *   delete:
 *     summary: Delete job post
 *     tags: [Recruiter Jobs]
 */
router.delete('/jobs/:id', protectRecruiter, jobController.deleteJob);

/**
 * @swagger
 * /api/recruiter/jobs/{id}/applicants:
 *   get:
 *     summary: View applicants for a job
 *     description: Retrieve all professional applications for a specific job post.
 *     tags: [Recruiter Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Job UUID
 *     responses:
 *       200:
 *         description: List of applications for the job
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer, example: 12 }
 *                 data:
 *                   type: object
 *                   properties:
 *                     applicants:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/JobApplication' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get(
  '/jobs/:id/applicants',
  protectRecruiter,
  applicationController.getJobApplicants,
);

/**
 * @swagger
 * /api/recruiter/applicants/{id}:
 *   get:
 *     summary: View applicant details
 *     description: Retrieve detailed information for a specific job application, including professional profile.
 *     tags: [Recruiter Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Application UUID
 *     responses:
 *       200:
 *         description: Applicant details retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     application: { $ref: '#/components/schemas/JobApplication' }
 *                     professional: { $ref: '#/components/schemas/Professional' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get(
  '/applicants/:id',
  protectRecruiter,
  applicationController.getApplicationDetails,
);

/**
 * @swagger
 * /api/recruiter/applicants/{id}/status:
 *   patch:
 *     summary: Update application status
 *     description: Recruiter can change applicant status to REVIEWING, SHORTLISTED, ACCEPTED, or REJECTED.
 *     tags: [Recruiter Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [REVIEWING, SHORTLISTED, ACCEPTED, REJECTED]
 *     responses:
 *       200:
 *         description: Status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: "Application status updated to SHORTLISTED" }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.patch(
  '/applicants/:id/status',
  protectRecruiter,
  applicationController.updateApplicationStatus,
);

// ==================== TRAINER BOOKING MANAGEMENT ====================

/**
 * @swagger
 * /api/recruiter/courses/{courseId}/bookings:
 *   get:
 *     summary: Get all bookings for a specific course
 *     tags: [Trainer Bookings]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/courses/:courseId/bookings',
  protectRecruiter,
  async (req, res, next) => {
    const { getCourseBookings } =
      await import('../controllers/trainerBookingController.js');
    return getCourseBookings(req, res, next);
  },
);

/**
 * @swagger
 * /api/recruiter/trainer/bookings:
 *   get:
 *     summary: Get all bookings across all trainer courses
 *     tags: [Trainer Bookings]
 */
router.get('/trainer/bookings', protectRecruiter, async (req, res, next) => {
  const { getAllTrainerBookings } =
    await import('../controllers/trainerBookingController.js');
  return getAllTrainerBookings(req, res, next);
});

/**
 * @swagger
 * /api/recruiter/trainer/bookings/{bookingId}:
 *   get:
 *     summary: Get specific booking details
 *     tags: [Trainer Bookings]
 */
router.get(
  '/trainer/bookings/:bookingId',
  protectRecruiter,
  async (req, res, next) => {
    const { getTrainerBookingById } =
      await import('../controllers/trainerBookingController.js');
    return getTrainerBookingById(req, res, next);
  },
);

/**
 * @swagger
 * /api/recruiter/trainer/bookings/{bookingId}/status:
 *   patch:
 *     summary: Update booking status
 *     tags: [Trainer Bookings]
 */
router.patch(
  '/trainer/bookings/:bookingId/status',
  protectRecruiter,
  async (req, res, next) => {
    const { updateBookingStatus } =
      await import('../controllers/trainerBookingController.js');
    return updateBookingStatus(req, res, next);
  },
);

/**
 * @swagger
 * /api/recruiter/trainer/bookings/{bookingId}/message:
 *   post:
 *     summary: Send message to trainee
 *     tags: [Trainer Bookings]
 */
router.post(
  '/trainer/bookings/:bookingId/message',
  protectRecruiter,
  async (req, res, next) => {
    const { messageTrainee } =
      await import('../controllers/trainerBookingController.js');
    return messageTrainee(req, res, next);
  },
);

/**
 * @swagger
 * /api/recruiter/trainer/bookings/{bookingId}/certificate:
 *   post:
 *     summary: Issue course completion certificate
 *     tags: [Trainer Bookings]
 */
router.post(
  '/trainer/bookings/:bookingId/certificate',
  protectRecruiter,
  async (req, res, next) => {
    const { issueCertificate } =
      await import('../controllers/trainerBookingController.js');
    return issueCertificate(req, res, next);
  },
);

// ==================== TRAINER REVENUE & ANALYTICS ====================

/**
 * @swagger
 * /api/recruiter/trainer/revenue:
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
router.get('/trainer/revenue', protectRecruiter, async (req, res, next) => {
  const { getRevenue } =
    await import('../controllers/trainerRevenueController.js');
  return getRevenue(req, res, next);
});

/**
 * @swagger
 * /api/recruiter/trainer/analytics:
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
router.get('/trainer/analytics', protectRecruiter, async (req, res, next) => {
  const { getAnalytics } =
    await import('../controllers/trainerRevenueController.js');
  return getAnalytics(req, res, next);
});

export default router;
