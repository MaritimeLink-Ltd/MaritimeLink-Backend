import express from 'express';
import multer from 'multer';
import * as recruiterController from '../controllers/recruiterAuthController.js';

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

export default router;
