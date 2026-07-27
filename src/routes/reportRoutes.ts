import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import * as userReportController from '../controllers/userReportController.js';
import { protectChat } from '../middlewares/chatAuthMiddleware.js';

/**
 * Member-to-member reporting, shared by professionals, recruiters and training
 * providers. `protectChat` is reused because it is the one middleware that
 * resolves any of the three account types from a token.
 */
const router = Router();

const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many reports submitted. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(protectChat);

/**
 * @swagger
 * tags:
 *   name: Reports
 *   description: Reporting another account for moderation review
 */

/**
 * @swagger
 * /api/reports/reasons:
 *   get:
 *     summary: List the selectable report reasons
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Reason values and display labels.
 */
router.get('/reasons', userReportController.getReportReasons);

/**
 * @swagger
 * /api/reports/mine:
 *   get:
 *     summary: Reports filed by the authenticated user
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: The user's own reports and their review status.
 */
router.get('/mine', userReportController.getMyReports);

/**
 * @swagger
 * /api/reports:
 *   post:
 *     summary: Report an account
 *     description: >
 *       Flags another account for admin review. The reporter must already have a
 *       relationship with the reported account (a conversation, job application,
 *       invitation, or course booking).
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reportedId, reason, details]
 *             properties:
 *               reportedId: { type: string, format: uuid }
 *               reason:
 *                 type: string
 *                 enum: [SCAM_OR_FRAUD, HARASSMENT_OR_ABUSE, FAKE_ACCOUNT, INAPPROPRIATE_CONTENT, SPAM, PAYMENT_ISSUE, OTHER]
 *               details: { type: string, minLength: 10 }
 *               conversationId: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Report submitted.
 *       403:
 *         description: No relationship with the reported account.
 *       409:
 *         description: An open report against this account already exists.
 */
router.post('/', reportLimiter, userReportController.createReport);

export default router;
