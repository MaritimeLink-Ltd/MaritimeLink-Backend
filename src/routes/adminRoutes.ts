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
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
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
 *     responses:
 *       200:
 *         description: Reset email sent
 *       404:
 *         description: Admin not found
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

export default router;
