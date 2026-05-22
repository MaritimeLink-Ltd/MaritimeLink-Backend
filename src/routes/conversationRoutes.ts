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
 *     description: Retrieve a list of all active conversations, including the latest message and participant details.
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of conversations retrieved successfully.
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
 *                     conversations:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Conversation' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *   post:
 *     summary: Create or get an existing conversation
 *     description: Initialize a new chat or retrieve an existing one with a specific user.
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
 *               recipientId: { type: string, format: uuid, description: "ID of the Professional or Recruiter to chat with" }
 *     responses:
 *       200:
 *         description: Conversation found or created.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     conversation: { $ref: '#/components/schemas/Conversation' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router
  .route('/')
  .get(conversationController.getConversations)
  .post(conversationController.createConversation);

router.get('/support', conversationController.getSupportConversation);

/**
 * @swagger
 * /api/conversations/{id}/messages:
 *   get:
 *     summary: Get paginated messages for a conversation
 *     description: Retrieve message history for a specific conversation using cursor-based pagination.
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
 *         schema: { type: string, format: uuid, description: "ID of the last message received for pagination" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Messages retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     messages:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Message' }
 *                     nextCursor: { type: string, format: uuid, nullable: true }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *   post:
 *     summary: Send a message via REST
 *     description: Send a new text message to a conversation.
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
 *               content: { type: string, example: "Hello, I am interested in the position." }
 *     responses:
 *       201:
 *         description: Message sent successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     message: { $ref: '#/components/schemas/Message' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
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
 *     description: Set the 'isRead' status to true for all messages in the conversation received by the current user.
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: "Messages marked as read" }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.patch('/:id/read', conversationController.markAsRead);

export default router;
