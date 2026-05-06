import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import {
  createConversationSchema,
  getMessagesSchema,
  sendMessageSchema,
} from '../validations/chatValidation.js';

export const getConversations = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const userId = req.user!.id;
    const userType = req.user!.userType;
    const whereClause =
      userType === 'PROFESSIONAL'
        ? { professionalId: userId }
        : userType === 'ADMIN'
          ? { adminId: userId }
          : { recruiterId: userId };

    const conversations = await prisma.conversation.findMany({
      where: whereClause,
      include: {
        professional: {
          select: { id: true, fullname: true, email: true },
        },
        recruiter: {
          select: { id: true, organizationName: true, email: true },
        },
        admin: {
          select: { id: true, email: true, role: true },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            messages: {
              where: {
                isRead: false,
                NOT: {
                  senderId: userId,
                },
              },
            },
          },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      results: conversations.length,
      data: { conversations },
    });
  },
);

export const createConversation = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const validated = createConversationSchema.parse(req.body);
    const userId = req.user!.id;
    const userType = req.user!.userType;
    const targetId = validated.recipientId;

    if (userId === targetId) {
      return next(
        new AppError('You cannot start a conversation with yourself.', 400),
      );
    }

    let professionalId: string | null = null;
    let recruiterId: string | null = null;
    let adminId: string | null = null;

    if (userType === 'PROFESSIONAL') {
      professionalId = userId;
      const recruiter = await prisma.recruiter.findUnique({
        where: { id: targetId },
      });
      if (recruiter) {
        recruiterId = targetId;
      } else {
        const admin = await prisma.admin.findUnique({
          where: { id: targetId },
        });
        if (!admin) {
          return next(new AppError('Recipient not found.', 404));
        }
        adminId = targetId;
      }
    } else if (userType === 'ADMIN') {
      adminId = userId;

      const professional = await prisma.professional.findUnique({
        where: { id: targetId },
      });
      if (professional) {
        professionalId = targetId;
      } else {
        const recruiter = await prisma.recruiter.findUnique({
          where: { id: targetId },
        });
        if (!recruiter) return next(new AppError('Recipient not found.', 404));
        recruiterId = targetId;
      }
    } else {
      recruiterId = userId;

      const professional = await prisma.professional.findUnique({
        where: { id: targetId },
      });
      if (professional) {
        professionalId = targetId;
      } else {
        const admin = await prisma.admin.findUnique({
          where: { id: targetId },
        });
        if (!admin) return next(new AppError('Recipient not found.', 404));
        adminId = targetId;
      }
    }

    const includeParticipants = {
      professional: { select: { id: true, fullname: true } },
      recruiter: { select: { id: true, organizationName: true } },
      admin: { select: { id: true, email: true, role: true } },
    } as const;

    // Prisma upsert is brittle here because the second participant can be nullable.
    // Use an explicit find-or-create so admin/professional conversations behave
    // predictably even after the schema evolution.
    const conversationWhere =
      professionalId && recruiterId
        ? { professionalId, recruiterId, adminId: null }
        : professionalId && adminId
          ? { professionalId, adminId, recruiterId: null }
          : recruiterId && adminId
            ? { professionalId: null, recruiterId, adminId }
            : null;

    if (!conversationWhere) {
      return next(new AppError('Invalid conversation participants.', 400));
    }

    let conversation = await prisma.conversation.findFirst({
      where: conversationWhere,
      include: includeParticipants,
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          professionalId,
          recruiterId,
          adminId,
        },
        include: includeParticipants,
      });
    }

    res.status(200).json({
      status: 'success',
      data: { conversation },
    });
  },
);

export const bootstrapSupportConversation = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const userId = req.user!.id;
    const userType = req.user!.userType;

    if (userType === 'ADMIN') {
      return next(
        new AppError(
          'Admins should open support chats from the admin panel.',
          403,
        ),
      );
    }

    const supportAdmin = await prisma.admin.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, role: true },
    });

    if (!supportAdmin) {
      return next(new AppError('Support admin not available.', 404));
    }

    const includeParticipants = {
      professional: { select: { id: true, fullname: true } },
      recruiter: { select: { id: true, organizationName: true } },
      admin: { select: { id: true, email: true, role: true } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      _count: {
        select: {
          messages: {
            where: {
              isRead: false,
              NOT: {
                senderId: userId,
              },
            },
          },
        },
      },
    } as const;

    const conversationWhere =
      userType === 'PROFESSIONAL'
        ? {
            professionalId: userId,
            adminId: supportAdmin.id,
            recruiterId: null,
          }
        : {
            professionalId: null,
            recruiterId: userId,
            adminId: supportAdmin.id,
          };

    let conversation = await prisma.conversation.findFirst({
      where: conversationWhere,
      include: includeParticipants,
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: conversationWhere,
        include: includeParticipants,
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        conversation,
        admin: supportAdmin,
      },
    });
  },
);

/**
 * Get messages for a specific conversation (paginated)
 */
export const getMessages = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id: conversationId } = req.params;
    const { cursor, limit } = getMessagesSchema.parse(req.query);
    const userId = req.user!.id;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation)
      return next(new AppError('Conversation not found.', 404));

    // Check authorization
    if (
      conversation.professionalId !== userId &&
      conversation.recruiterId !== userId &&
      conversation.adminId !== userId
    ) {
      return next(
        new AppError('Unauthorized access to this conversation.', 403),
      );
    }

    const messages = await prisma.message.findMany({
      where: { conversationId },
      take: limit,
      ...(cursor && {
        skip: 1,
        cursor: { id: cursor },
      }),
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      results: messages.length,
      data: { messages },
    });
  },
);

/**
 * Mark messages as read in a conversation
 */
export const markAsRead = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id: conversationId } = req.params;
    const userId = req.user!.id;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation)
      return next(new AppError('Conversation not found.', 404));

    if (
      conversation.professionalId !== userId &&
      conversation.recruiterId !== userId &&
      conversation.adminId !== userId
    ) {
      return next(new AppError('Unauthorized.', 403));
    }

    await prisma.message.updateMany({
      where: {
        conversationId,
        isRead: false,
        NOT: {
          senderId: userId,
        },
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Messages marked as read.',
    });
  },
);

/**
 * Send a message via REST (useful for initial implementation or fallback)
 */
export const sendMessage = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id: conversationId } = req.params;
    const { content } = sendMessageSchema.parse(req.body);
    const userId = req.user!.id;
    const userType = req.user!.userType;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation)
      return next(new AppError('Conversation not found.', 404));

    if (
      conversation.professionalId !== userId &&
      conversation.recruiterId !== userId &&
      conversation.adminId !== userId
    ) {
      return next(new AppError('Unauthorized.', 403));
    }

    const message = await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          conversationId,
          content,
          senderId: userId,
          senderType:
            userType === 'PROFESSIONAL'
              ? 'PROFESSIONAL'
              : userType === 'ADMIN'
                ? 'ADMIN'
                : 'RECRUITER',
        },
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      });

      return msg;
    });

    // Emit real-time notification
    const io = req.app.get('io');
    if (io) {
      io.to(conversationId).emit('new_message', {
        message,
        senderId: userId,
      });

      // Also notify recipient's private room for conversation list updates
      const recipientIds = [
        conversation.professionalId,
        conversation.recruiterId,
        conversation.adminId,
      ].filter((id): id is string => Boolean(id) && id !== userId);

      for (const recipientId of recipientIds) {
        io.to(recipientId).emit('update_conversation', {
          conversationId,
          lastMessage: message,
        });
      }
    }

    res.status(201).json({
      status: 'success',
      data: { message },
    });
  },
);
