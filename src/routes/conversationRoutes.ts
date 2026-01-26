import { Router } from 'express';
import * as conversationController from '../controllers/conversationController.js';
import { protectChat } from '../middlewares/chatAuthMiddleware.js';
import { rateLimit } from 'express-rate-limit';

const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 requests per windowMs
  message:
    'Too many messages sent from this IP, please try again after a minute',
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

// All routes are protected and identified as PROFESSIONAL or RECRUITER
router.use(protectChat);
router.use(chatLimiter);

/**
 * @swagger
 * tags:
 *   name: Chat
 *   description: Real-time messaging between Professionals and Recruiters
 */

/**
 * @swagger
 * /api/conversations:
 *   get:
 *     summary: Get all conversations for the authenticated user
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of conversations retrieved successfully.
 *   post:
 *     summary: Create or get an existing conversation
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipientId]
 *             properties:
 *               recipientId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Conversation found or created.
 */
router
  .route('/')
  .get(conversationController.getConversations)
  .post(conversationController.createConversation);

/**
 * @swagger
 * /api/conversations/{id}/messages:
 *   get:
 *     summary: Get paginated messages for a conversation
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: cursor
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Messages retrieved successfully.
 *   post:
 *     summary: Send a message via REST
 *     tags: [Chat]
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
 *             required: [content]
 *             properties:
 *               content: { type: string }
 *     responses:
 *       201:
 *         description: Message sent successfully.
 */
router
  .route('/:id/messages')
  .get(conversationController.getMessages)
  .post(conversationController.sendMessage);

/**
 * @swagger
 * /api/conversations/{id}/read:
 *   patch:
 *     summary: Mark all messages in a conversation as read
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Messages marked as read.
 */
router.patch('/:id/read', conversationController.markAsRead);

export default router;
