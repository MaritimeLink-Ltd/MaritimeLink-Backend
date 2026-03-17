import express from 'express';
import multer from 'multer';
import * as recruiterController from '../controllers/recruiterAuthController.js';
import * as kycController from '../controllers/kycController.js';
import * as sessionController from '../controllers/courseSessionController.js';
import * as candidateController from '../controllers/recruiterCandidateController.js';
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
 *     description: Validate the 6-digit code sent to the recruiter's email.
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
 *         description: Email verified successfully. Proceed to personal info.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: "success" }
 *                 data: { type: object, properties: { registrationStep: { type: integer, example: 2 } } }
 *       400:
 *         description: Invalid or expired OTP
 */
router.post('/verify-otp', recruiterController.verifyOTP);

/**
 * @swagger
 * /api/recruiter/personal-info:
 *   patch:
 *     summary: Step 3 - Tell Us About Yourself
 *     description: Provide personal details and phone number. This triggers a phone OTP.
 *     tags: [Recruiter]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recruiterId, firstName, lastName, phoneCode, phoneNumber, personalRole]
 *             properties:
 *               recruiterId: { type: string, format: uuid }
 *               firstName: { type: string, example: "Asim" }
 *               middleName: { type: string, example: "Abbas" }
 *               lastName: { type: string, example: "Khan" }
 *               phoneCode: { type: string, example: "+92" }
 *               phoneNumber: { type: string, example: "3076517703" }
 *               personalRole: { type: string, example: "Crewing Coordinator" }
 *               otherRole: { type: string }
 *     responses:
 *       200:
 *         description: Personal info saved. Phone OTP sent.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: "success" }
 *                 data: { type: object, properties: { registrationStep: { type: integer, example: 3 } } }
 */
router.patch('/personal-info', recruiterController.setPersonalInfo);

/**
 * @swagger
 * /api/recruiter/verify-phone:
 *   post:
 *     summary: Step 4 - Verify Phone with OTP
 *     description: Validate the 6-digit code sent to the recruiter's phone.
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
 *         description: Phone verified successfully. Proceed to company details.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: "success" }
 *                 data: { type: object, properties: { registrationStep: { type: integer, example: 4 } } }
 */
router.post('/verify-phone', recruiterController.verifyPhone);

/**
 * @swagger
 * /api/recruiter/company-preview:
 *   get:
 *     summary: Step 5a - Get Company Preview
 *     description: Fetch company logo and name based on a website URL.
 *     tags: [Recruiter]
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema:
 *           type: string
 *         example: "google.com"
 *     responses:
 *       200:
 *         description: Company preview fetched successfully.
 *       400:
 *         description: Invalid URL
 *       444:
 *         description: Logo fetch failed
 */
router.get('/company-preview', recruiterController.getCompanyPreview);

/**
 * @swagger
 * /api/recruiter/company-details:
 *   patch:
 *     summary: Step 5 - Company Details
 *     description: Provide full organizational details.
 *     tags: [Recruiter]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recruiterId, organizationName, address, companyCity, companyState, companyZip, companyCountry]
 *             properties:
 *               recruiterId: { type: string, format: uuid }
 *               organizationName: { type: string, example: "Devsinc" }
 *               address: { type: string, example: "Sultan khel Isa khel Mainwali" }
 *               companyCity: { type: string, example: "Mianwali" }
 *               companyState: { type: string, example: "Punjab" }
 *               companyZip: { type: string, example: "42410" }
 *               companyCountry: { type: string, example: "Pakistan" }
 *               website: { type: string, format: url, example: "https://emedcrack.com/" }
 *               companyLinkedIn: { type: string, format: url, example: "https://emedcrack.com/" }
 *     responses:
 *       200:
 *         description: Company details saved. Proceed to compliance.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: "success" }
 *                 data: { type: object, properties: { registrationStep: { type: integer, example: 5 } } }
 */
router.patch('/company-details', recruiterController.setCompanyDetails);

/**
 * @swagger
 * /api/recruiter/compliance:
 *   patch:
 *     summary: Step 6 - Compliance & Trust Declaration
 *     description: Finalize registration with legal declarations and referral info.
 *     tags: [Recruiter]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recruiterId, isAuthorized, agreedToTerms, howDidYouHear]
 *             properties:
 *               recruiterId: { type: string, format: uuid }
 *               isAuthorized: { type: boolean, example: true }
 *               agreedToTerms: { type: boolean, example: true }
 *               howDidYouHear: { type: string, example: "Referral" }
 *     responses:
 *       200:
 *         description: Registration complete. Account under review.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: "success" }
 *                 token: { type: string }
 *                 data: { type: object, properties: { registrationStep: { type: integer, example: 6 } } }
 */
router.patch('/compliance', recruiterController.setCompliance);

/**
 * @swagger
 * /api/recruiter/upload-id:
 *   post:
 *     summary: Legacy Upload ID (Internal Use)
 *     tags: [Recruiter]
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
 *     summary: Legacy Complete Profile (Internal Use)
 *     tags: [Recruiter]
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
 *         description: Document uploaded successfully. Returns extraction results.
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
 *                     ocrData: { $ref: '#/components/schemas/OCRData' }
 *                     isTypeValidated: { type: boolean }
 */
router.post(
  '/kyc/upload-document',
  upload.single('document'),
  kycController.uploadKYCDocument,
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
 *     description: Retrieve a paginated list of all support cases submitted by the recruiter.
 *     tags: [Recruiter Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: List of support cases.
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
 *                     cases:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/SupportCase' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
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
 *     description: Retrieve full details for a specific support case, including all replies and internal notes.
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
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
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
 *     description: Add a new message/reply to an existing support case.
 *     tags: [Recruiter Support]
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
 *               content:
 *                 type: string
 *                 example: "Here is the additional info..."
 *     responses:
 *       201:
 *         description: Reply added successfully.
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
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
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
 * /api/recruiter/jobs/{id}/matches:
 *   get:
 *     summary: Get matching candidates for a job
 *     description: Retrieve ranked list of professionals whose profile and resume match the job requirements.
 *     tags: [Recruiter Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of matching candidates
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
 *                     candidates:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           fullname: { type: string }
 *                           rank: { type: string }
 *                           availability: { type: string }
 *                           compliance: { type: string }
 *                           matchPercentage: { type: integer }
 *                           matchCriteria: { type: array, items: { type: string } }
 */
router.get(
  '/jobs/:id/matches',
  protectRecruiter,
  candidateController.getMatchingCandidates,
);

/**
 * @swagger
 * /api/recruiter/jobs/{id}/invite/{professionalId}:
 *   post:
 *     summary: Invite a professional to apply
 *     description: Send an invitation to a matching professional. Creates an alert for the professional.
 *     tags: [Recruiter Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: professionalId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Invitation sent successfully
 */
router.post(
  '/jobs/:id/invite/:professionalId',
  protectRecruiter,
  candidateController.inviteProfessional,
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
