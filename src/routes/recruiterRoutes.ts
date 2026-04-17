import express from 'express';
import multer from 'multer';
import * as recruiterController from '../controllers/recruiterAuthController.js';
import * as kycController from '../controllers/kycController.js';
import * as candidateController from '../controllers/recruiterCandidateController.js';
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
import {
  protectRecruiter,
  protectRecruiterKyc,
} from '../middlewares/recruiterAuthMiddleware.js';

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
 * /api/recruiter/company-details/lookup:
 *   get:
 *     summary: Step 5b - Lookup Company Details
 *     description: Uses Gemini with Google Search grounding to fetch public company details.
 *     tags: [Recruiter]
 *     parameters:
 *       - in: query
 *         name: url
 *         schema:
 *           type: string
 *         example: "google.com"
 *       - in: query
 *         name: organizationName
 *         schema:
 *           type: string
 *         example: "Google"
 *     responses:
 *       200:
 *         description: Company details fetched successfully.
 *       400:
 *         description: Missing URL or organization name.
 *       404:
 *         description: Company details could not be fetched.
 */
router.get('/company-details/lookup', recruiterController.lookupCompanyDetails);

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
 * /api/recruiter/upload-photo:
 *   post:
 *     summary: Upload Profile Photo
 *     description: Upload a personal profile photo for the recruiter or training agent.
 *     tags: [Recruiter]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [recruiterId, photo]
 *             properties:
 *               recruiterId: { type: string, format: uuid }
 *               photo: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Profile photo uploaded successfully.
 */
router.post(
  '/upload-photo',
  upload.single('photo'),
  recruiterController.uploadProfilePhoto,
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
 *     description: Authenticate and receive a JWT. Verified recruiters can login while pending admin approval, but rejected or blocked accounts are denied.
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
 *         description: Account rejected or blocked
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
 * /api/recruiter/kyc/upload-document-front:
 *   post:
 *     summary: KYC Step 1a - Upload Document Front Side
 *     description: Upload the front side of the identity document.
 *     tags: [Recruiter KYC]
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
 * /api/recruiter/kyc/upload-document-back:
 *   post:
 *     summary: KYC Step 1b - Upload Document Back Side
 *     description: Upload the back side of the identity document.
 *     tags: [Recruiter KYC]
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
 * /api/recruiter/kyc/upload-document:
 *   post:
 *     summary: KYC Step 1 (Legacy) - Upload Identity Document
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
 *               recruiterId: { type: string }
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
 * /api/recruiter/kyc/upload-selfie:
 *   post:
 *     summary: KYC Step 3 - Upload Selfie
 *     tags: [Recruiter KYC]
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
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Job ID
 */
router.get('/jobs/:id', protectRecruiter, jobController.getJobById);

/**
 * @swagger
 * /api/recruiter/jobs/{id}:
 *   patch:
 *     summary: Edit job post
 *     tags: [Recruiter Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Job ID
 */
router.patch('/jobs/:id', protectRecruiter, jobController.updateJob);

/**
 * @swagger
 * /api/recruiter/jobs/{id}:
 *   delete:
 *     summary: Delete job post
 *     tags: [Recruiter Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Job ID
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
 *     description: Recruiter can change applicant status. Frontend aliases REVIEWING, INTERVIEWED, and ACCEPTED are accepted and saved as UNDER_REVIEW, INTERVIEW, and OFFER.
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
 *                 enum: [APPLIED, UNDER_REVIEW, REVIEWING, SHORTLISTED, INTERVIEW, INTERVIEWED, OFFER, ACCEPTED, HIRED, REJECTED, WITHDRAWN]
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

export default router;
