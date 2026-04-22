import express from 'express';
import multer from 'multer';
import * as recruiterAuthController from '../controllers/recruiterAuthController.js';
import * as kycController from '../controllers/kycController.js';
import * as stripeController from '../controllers/trainerStripeController.js';
import * as bookingController from '../controllers/trainerBookingController.js';
import {
  protectRecruiter,
  protectRecruiterKyc,
} from '../middlewares/recruiterAuthMiddleware.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @swagger
 * tags:
 *   - name: Trainer
 *     description: Trainer registration and authentication
 *   - name: Trainer KYC
 *     description: KYC verification for Trainers (Training Agents)
 */

/**
 * @swagger
 * /api/trainer/register:
 *   post:
 *     summary: Step 1 - Register Trainer
 *     description: Initialize registration for a Training Agent. Sends a 6-digit OTP to email.
 *     tags: [Trainer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: "trainer@example.com" }
 *               password: { type: string, format: password, example: "Secret123!" }
 *     responses:
 *       201:
 *         description: Initial account created. Verification required.
 */
router.post(
  '/register',
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    req.body.role = 'TRAINING_AGENT';
    return recruiterAuthController.register(req, res, next);
  },
);

/**
 * @swagger
 * /api/trainer/login:
 *   post:
 *     summary: Trainer Login
 *     description: Authenticate as a Trainer and receive a JWT.
 *     tags: [Trainer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: "trainer@example.com" }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Login successful
 */
router.post('/login', recruiterAuthController.login);

/**
 * @swagger
 * /api/trainer/verify-otp:
 *   post:
 *     summary: Step 2 - Verify Email with OTP
 *     tags: [Trainer]
 */
router.post('/verify-otp', recruiterAuthController.verifyOTP);

/**
 * @swagger
 * /api/trainer/personal-info:
 *   patch:
 *     summary: Step 3 - Personal Information
 *     tags: [Trainer]
 */
router.patch('/personal-info', recruiterAuthController.setPersonalInfo);

/**
 * @swagger
 * tags:
 *   name: Trainer KYC
 *   description: KYC verification for Trainers (Training Agents)
 */

/**
 * @swagger
 * /api/trainer/kyc/upload-document-front:
 *   post:
 *     summary: Trainer KYC Step 1a - Upload Document Front Side
 *     description: Upload the front side of the identity document for Trainers.
 *     tags: [Trainer KYC]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [recruiterId, documentFront]
 *             properties:
 *               recruiterId: { type: string }
 *               documentFront: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Front side uploaded successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     url: { type: string }
 *                     ocrData: { $ref: '#/components/schemas/OCRData' }
 */
router.post(
  '/kyc/upload-document-front',
  protectRecruiterKyc,
  upload.single('documentFront'),
  kycController.uploadKYCDocumentFront,
);

/**
 * @swagger
 * /api/trainer/kyc/upload-document-back:
 *   post:
 *     summary: Trainer KYC Step 1b - Upload Document Back Side
 *     description: Upload the back side of the identity document for Trainers.
 *     tags: [Trainer KYC]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [recruiterId, documentBack]
 *             properties:
 *               recruiterId: { type: string }
 *               documentBack: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Back side uploaded successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data: { type: object, properties: { url: { type: string } } }
 */
router.post(
  '/kyc/upload-document-back',
  protectRecruiterKyc,
  upload.single('documentBack'),
  kycController.uploadKYCDocumentBack,
);

/**
 * @swagger
 * /api/trainer/kyc/submit:
 *   post:
 *     summary: Trainer KYC Step 2 - Submit Personal Details & Document URL
 *     tags: [Trainer KYC]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recruiterId, firstName, lastName, dateOfBirth, documentType, documentNumber, expiryDate, issueCountry]
 *             properties:
 *               recruiterId: { type: string, description: "Mapped from Recruiter ID as Trainers share the same identifier" }
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               dateOfBirth: { type: string, format: date }
 *               documentType: { type: string, enum: [PASSPORT, DRIVING_LICENSE, NATIONAL_ID, RESIDENCE_PERMIT] }
 *               documentNumber: { type: string }
 *               expiryDate: { type: string, format: date }
 *               issueCountry: { type: string }
 *               documentUrl: { type: string, description: "Legacy combined URL" }
 *               documentFrontUrl: { type: string, description: "URL for the front side of the document" }
 *               documentBackUrl: { type: string, description: "URL for the back side of the document" }
 *     responses:
 *       200:
 *         description: KYC details submitted. Please upload a selfie next.
 */
router.post('/kyc/submit', protectRecruiterKyc, kycController.submitKYC);

/**
 * @swagger
 * /api/trainer/kyc/upload-selfie:
 *   post:
 *     summary: Trainer KYC Step 3 - Upload Selfie
 *     tags: [Trainer KYC]
 *     security:
 *       - bearerAuth: []
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
  protectRecruiterKyc,
  upload.single('selfie'),
  kycController.uploadKYCSelfie,
);

/**
 * @swagger
 * /api/trainer/stripe/status:
 *   get:
 *     summary: Get Stripe Connect onboarding status
 *     tags: [Trainer Stripe]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stripe onboarding status returned.
 */
router.get(
  '/stripe/status',
  protectRecruiter,
  stripeController.getOnboardingStatus,
);

/**
 * @swagger
 * /api/trainer/stripe/onboarding:
 *   post:
 *     summary: Initiate Stripe Connect onboarding
 *     tags: [Trainer Stripe]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Onboarding URL generated successfully.
 */
router.post(
  '/stripe/onboarding',
  protectRecruiter,
  stripeController.initiateOnboarding,
);

/**
 * @swagger
 * /api/trainer/stripe/onboarding/refresh:
 *   post:
 *     summary: Refresh Stripe onboarding link
 *     tags: [Trainer Stripe]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: New onboarding URL generated.
 */
router.post(
  '/stripe/onboarding/refresh',
  protectRecruiter,
  stripeController.refreshOnboarding,
);

/**
 * @swagger
 * /api/trainer/sessions/{sessionId}/attendees:
 *   get:
 *     summary: Get attendees for a specific session
 *     tags: [Trainer Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Course session ID.
 *     responses:
 *       200:
 *         description: Session attendees returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 results:
 *                   type: integer
 *                   example: 1
 *                 data:
 *                   type: object
 *                   properties:
 *                     attendees:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           bookingId:
 *                             type: string
 *                             format: uuid
 *                           professionalId:
 *                             type: string
 *                             format: uuid
 *                           fullname:
 *                             type: string
 *                             example: John Doe
 *                           email:
 *                             type: string
 *                             format: email
 *                           photo:
 *                             type: string
 *                             nullable: true
 *                           profession:
 *                             type: string
 *                             nullable: true
 *                           subcategory:
 *                             type: string
 *                             nullable: true
 *                           status:
 *                             type: string
 *                             enum: [PENDING, CONFIRMED, CANCELLED, COMPLETED]
 *                           paymentStatus:
 *                             type: string
 *                             enum: [PENDING, SUCCEEDED, FAILED, REFUNDED]
 *                           attachedDocuments:
 *                             type: array
 *                             description: Documents selected/uploaded by the professional while booking this course.
 *                             items:
 *                               $ref: '#/components/schemas/ProfessionalDocument'
 *                           resume:
 *                             type: object
 *                             properties:
 *                               cvUrl:
 *                                 type: string
 *                                 nullable: true
 *                               summary:
 *                                 type: string
 *                                 nullable: true
 *                                 description: Experience Summary from the professional resume.
 *                               experienceSummary:
 *                                 type: array
 *                                 items:
 *                                   type: string
 *                                 example: ["2 years total sea service", "Current Rank: Deck Officer"]
 *                               totalSeaTime:
 *                                 type: object
 *                                 properties:
 *                                   years:
 *                                     type: integer
 *                                   months:
 *                                     type: integer
 *                                   totalMonths:
 *                                     type: integer
 *                               keySkillsAndCompetencies:
 *                                 type: array
 *                                 items:
 *                                   type: object
 *                                   properties:
 *                                     id:
 *                                       type: string
 *                                     skillName:
 *                                       type: string
 *                                     rating:
 *                                       type: integer
 *                                       nullable: true
 *                               seaService:
 *                                 type: array
 *                                 items:
 *                                   type: object
 *       401:
 *         description: Unauthorized.
 *       404:
 *         description: Session not found.
 */
router.get(
  '/sessions/:sessionId/attendees',
  protectRecruiter,
  bookingController.getSessionAttendees,
);

/**
 * @swagger
 * /api/trainer/sessions/{sessionId}/attendees/{bookingId}/approve:
 *   post:
 *     summary: Approve a candidate for a session (Triggers Payout)
 *     tags: [Trainer Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Course session ID.
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Course booking ID to approve.
 *     responses:
 *       200:
 *         description: Attendee approved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 message:
 *                   type: string
 *                   example: Attendee approved successfully. Payout triggered if applicable.
 *                 data:
 *                   type: object
 *                   properties:
 *                     booking:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                           format: uuid
 *                         bookingStatus:
 *                           type: string
 *                           example: COMPLETED
 *                         paymentStatus:
 *                           type: string
 *                           example: SUCCEEDED
 *       400:
 *         description: Attendee already approved and payout processed.
 *       401:
 *         description: Unauthorized.
 *       404:
 *         description: Booking not found.
 */
router.post(
  '/sessions/:sessionId/attendees/:bookingId/approve',
  protectRecruiter,
  bookingController.approveAttendee,
);

router.post(
  '/sessions/:sessionId/attendees/:bookingId/reject',
  protectRecruiter,
  bookingController.rejectAttendee,
);

router.get(
  '/bookings',
  protectRecruiter,
  bookingController.getAllTrainerBookings,
);

router.get(
  '/bookings/:bookingId',
  protectRecruiter,
  bookingController.getTrainerBookingById,
);

export default router;
