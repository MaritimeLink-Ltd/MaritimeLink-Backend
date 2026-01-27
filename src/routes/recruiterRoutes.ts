import express from 'express';
import multer from 'multer';
import * as recruiterController from '../controllers/recruiterAuthController.js';
import * as kycController from '../controllers/kycController.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @swagger
 * /api/recruiter/register:
 *   post:
 *     summary: Step 1 - Register a new recruiter
 *     tags: [Recruiter]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, role]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *               role:
 *                 type: string
 *                 enum:
 *                   - RECRUITMENT_AGENT
 *                   - TRAINING_AGENT
 *                 description: "The role of the recruiter"
 *     responses:
 *       201:
 *         description: Registration successful, OTP sent.
 */
router.post('/register', recruiterController.register);
/**
 * @swagger
 * /api/recruiter/verify-otp:
 *   post:
 *     summary: Step 2 - Verify OTP for recruiter
 *     tags: [Recruiter]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recruiterId, code]
 *             properties:
 *               recruiterId: { type: string }
 *               code: { type: string }
 *     responses:
 *       200:
 *         description: OTP verified successfully.
 */
router.post('/verify-otp', recruiterController.verifyOTP);
/**
 * @swagger
 * /api/recruiter/upload-id:
 *   post:
 *     summary: Step 3 - Upload Recruiter ID/Passport
 *     tags: [Recruiter]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [id_passport]
 *             properties:
 *               id_passport: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: ID uploaded successfully.
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
 *     summary: Step 4 - Complete Recruiter profile (Organizational Details)
 *     tags: [Recruiter]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recruiterId, organizationName, address, website, orgEmail, idPassportUrl]
 *             properties:
 *               recruiterId: { type: string }
 *               organizationName: { type: string }
 *               address: { type: string }
 *               website: { type: string }
 *               orgEmail: { type: string }
 *               idPassportUrl: { type: string }
 *     responses:
 *       200:
 *         description: Profile submitted for approval.
 */
router.post('/complete-profile', recruiterController.completeProfile);
/**
 * @swagger
 * /api/recruiter/login:
 *   post:
 *     summary: Login for recruiters
 *     tags: [Recruiter]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login successful.
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
 *               email: { type: string, format: email }
 *     responses:
 *       200:
 *         description: OTP resent successfully.
 *       400:
 *         description: Invalid request or already verified.
 *       404:
 *         description: User not found.
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
 *               email: { type: string, format: email }
 *     responses:
 *       200:
 *         description: Reset link sent to email.
 *       404:
 *         description: Recruiter not found.
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
 *               password: { type: string, minLength: 6 }
 *     responses:
 *       200:
 *         description: Password reset successful.
 *       400:
 *         description: Token invalid or expired.
 */
router.patch('/reset-password/:token', recruiterController.resetPassword);

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

export default router;
